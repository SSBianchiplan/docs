"""Integração com o GPlanSiS|Drawings, o GPlanSiS|Writer e o GPlanSiS|Sheets.

* Entrada única (SSO) nos dois sentidos, com código assinado por HMAC, válido por 2 minutos e de uso único.
  Cada sistema tem o próprio segredo; o campo "de" do código diz qual chave confere a assinatura.
* Áreas "Drawings", "Writer" e "Sheets": listas separadas dos documentos que vieram de cada sistema (metadata.origem).
* Substituição dos arquivos enviados pelo sistema enquanto a revisão está EM_ELABORACAO.
* Conversão HTML → PDF (Chromium do Gotenberg) para o Writer e o Sheets gerarem o PDF da revisão.
As chamadas do servidor de cada sistema chegam autenticadas pela chave de integração "em nome de" um usuário
(core/security.py), então as regras de papel por projeto e a auditoria continuam valendo.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.api.auth import UserOut
from app.api.deps import Conn
from app.core.config import get_settings
from app.core.db import fetch_all, fetch_one, open_tx
from app.core.errors import DomainError
from app.core.security import CurrentUser, chave_integracao, issue_token
from app.services import access
from app.services.html_pdf import sanear_html

router = APIRouter(prefix="/integracao", tags=["integração"])
SSO_VALIDADE = 120
MARCA_ARQUIVO = ".drawings."     # arquivos enviados pelo Drawings levam isto no nome
MARCA_WRITER = ".writer."        # e os do Writer, isto
MARCA_SHEETS = ".sheets."        # e os do Sheets, isto
LIMITE_HTML_PDF = 60 * 1024 * 1024
SISTEMAS = {"drawings": "GPlanSiS|Drawings", "writer": "GPlanSiS|Writer", "sheets": "GPlanSiS|Sheets"}


def url_sistema(sistema: str) -> str:
    s = get_settings()
    return {"writer": s.writer_url, "sheets": s.sheets_url}.get(sistema, s.drawings_url).rstrip("/")


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def assina_sso(email: str, para: str = "", sistema: str = "drawings") -> str:
    chave = chave_integracao("sso", sistema)
    if not chave:
        raise DomainError(f"Integração com o {SISTEMAS.get(sistema, sistema)} não configurada", 503)
    corpo = _b64(json.dumps({"email": email, "exp": int(time.time()) + SSO_VALIDADE, "n": secrets.token_urlsafe(12),
                             "para": para, "de": "docs"}, separators=(",", ":")).encode())
    return corpo + "." + _b64(hmac.new(chave, corpo.encode(), hashlib.sha256).digest())


def confere_sso(token: str) -> dict[str, Any]:
    try:
        corpo, sig = token.split(".", 1)
        de = json.loads(_unb64(corpo)).get("de")   # só escolhe a chave; a assinatura é conferida logo abaixo
        chave = chave_integracao("sso", de) if de in SISTEMAS else None
        ok = chave and hmac.compare_digest(_unb64(sig), hmac.new(chave, corpo.encode(), hashlib.sha256).digest())
        dados = json.loads(_unb64(corpo)) if ok else None
    except (ValueError, TypeError, AttributeError):
        dados = None
    if not dados or dados.get("de") not in SISTEMAS:
        raise HTTPException(401, "Link de entrada inválido")
    if dados.get("exp", 0) < time.time():
        raise HTTPException(401, f"Link de entrada expirado — clique de novo no botão do {SISTEMAS[dados['de']]}")
    return dados


@router.get("/estado")
async def estado(user: CurrentUser) -> dict[str, Any]:
    s = get_settings()
    return {"ativa": bool(s.integracao_drawings_segredo), "drawings_url": s.drawings_url.rstrip("/"),
            "writer_ativa": bool(s.integracao_writer_segredo), "writer_url": s.writer_url.rstrip("/"),
            "sheets_ativa": bool(s.integracao_sheets_segredo), "sheets_url": s.sheets_url.rstrip("/")}


class SsoEmitir(BaseModel):
    para: str = Field(default="", max_length=300)
    sistema: str = Field(default="drawings", pattern="^(drawings|writer|sheets)$")


@router.post("/sso/emitir")
async def sso_emitir(body: SsoEmitir, conn: Conn, user: CurrentUser) -> dict[str, str]:
    """Docs → Drawings/Writer/Sheets: link de entrada já autenticado no sistema para o usuário atual."""
    url = url_sistema(body.sistema) + "/?sso=" + quote(assina_sso(user.email, body.para, body.sistema))
    return {"url": url}


class SsoTrocar(BaseModel):
    token: str = Field(max_length=2000)


@router.post("/sso/trocar")
async def sso_trocar(body: SsoTrocar) -> dict[str, Any]:
    """Drawings → Docs: troca o código assinado pelo Drawings por uma sessão do Docs."""
    dados = confere_sso(body.token)
    async for conn in open_tx():
        await fetch_one(conn, "DELETE FROM integracao_nonce WHERE expira_em < now() RETURNING nonce")
        novo = await fetch_one(conn, """INSERT INTO integracao_nonce (nonce, expira_em)
                                        VALUES (:n, now() + interval '5 minutes') ON CONFLICT DO NOTHING RETURNING nonce""",
                               n=dados["n"])
        if not novo:
            raise HTTPException(401, "Este link de entrada já foi usado")
        u = await fetch_one(conn, """SELECT id::text, email::text, name, is_admin, is_active, must_change_password
                                     FROM app_user WHERE email = :e""", e=str(dados["email"]).lower())
    if not u or not u["is_active"]:
        raise HTTPException(403, f"{dados['email']} não tem conta ativa no GPlanSiS|Docs — peça acesso ao administrador")
    scope = "pwd" if u["must_change_password"] else "api"
    token = issue_token(u, ttl_minutes=15 if scope == "pwd" else None, scope=scope)
    return {"token": token, "user": UserOut(**{k: u[k] for k in UserOut.model_fields}).model_dump(), "para": dados.get("para") or "",
            "de": dados["de"]}


@router.get("/desenhos")
async def desenhos(conn: Conn, user: CurrentUser, project_id: str | None = None, q: str | None = None) -> dict[str, Any]:
    """Área Drawings: só os documentos que vieram do GPlanSiS|Drawings, com o vínculo ao desenho de origem."""
    filtros = ["d.metadata->>'origem' = 'drawings'",
               "(:adm OR EXISTS (SELECT 1 FROM project_member m WHERE m.project_id = d.project_id AND m.user_id = CAST(:u AS uuid)))"]
    params: dict[str, Any] = {"u": user.id, "adm": user.is_admin}
    if project_id:
        filtros.append("d.project_id = CAST(:p AS uuid)")
        params["p"] = project_id
    if q:
        filtros.append("(d.code ILIKE :ql OR d.title ILIKE :ql)")
        params["ql"] = f"%{q}%"
    rows = await fetch_all(conn, f"""
        SELECT d.id::text, d.code, d.title, d.discipline_code, d.doc_type_code, p.id::text AS project_id,
               p.code AS project_code, p.name AS project_name, d.updated_at,
               d.metadata->>'drawing_id' AS drawing_id, d.metadata->>'drawing_versao' AS drawing_versao,
               d.metadata->>'enviado_por' AS enviado_por, d.metadata->>'enviado_em' AS enviado_em,
               d.metadata->>'folha' AS folha, d.metadata->>'escala' AS escala, d.metadata->>'formato' AS formato,
               r.id::text AS revision_id, r.label AS revision_label, r.status AS revision_status, r.purpose,
               (SELECT count(*) FROM revision_comment c WHERE c.revision_id = r.id AND c.status = 'ABERTO') AS open_comments,
               (SELECT f.id::text FROM revision_file f JOIN file_text t ON t.file_id = f.id
                 WHERE f.revision_id = r.id AND t.thumb_key IS NOT NULL ORDER BY f.created_at DESC LIMIT 1) AS thumb_file_id
          FROM document d JOIN project p ON p.id = d.project_id
          LEFT JOIN revision r ON r.document_id = d.id AND r.is_current
         WHERE {' AND '.join(filtros)}
         ORDER BY d.updated_at DESC LIMIT 1000""", **params)
    return {"items": rows, "drawings_url": get_settings().drawings_url.rstrip("/")}


@router.get("/textos")
async def textos(conn: Conn, user: CurrentUser, project_id: str | None = None, q: str | None = None) -> dict[str, Any]:
    """Área Writer: só os documentos que vieram do GPlanSiS|Writer, com o vínculo ao documento de origem."""
    filtros = ["d.metadata->>'origem' = 'writer'",
               "(:adm OR EXISTS (SELECT 1 FROM project_member m WHERE m.project_id = d.project_id AND m.user_id = CAST(:u AS uuid)))"]
    params: dict[str, Any] = {"u": user.id, "adm": user.is_admin}
    if project_id:
        filtros.append("d.project_id = CAST(:p AS uuid)")
        params["p"] = project_id
    if q:
        filtros.append("(d.code ILIKE :ql OR d.title ILIKE :ql)")
        params["ql"] = f"%{q}%"
    rows = await fetch_all(conn, f"""
        SELECT d.id::text, d.code, d.title, d.discipline_code, d.doc_type_code, p.id::text AS project_id,
               p.code AS project_code, p.name AS project_name, d.updated_at,
               d.metadata->>'writer_doc_id' AS writer_doc_id, d.metadata->>'writer_versao' AS writer_versao,
               d.metadata->>'enviado_por' AS enviado_por, d.metadata->>'enviado_em' AS enviado_em,
               d.metadata->>'paginas' AS paginas, d.metadata->>'palavras' AS palavras,
               r.id::text AS revision_id, r.label AS revision_label, r.status AS revision_status, r.purpose,
               (SELECT count(*) FROM revision_comment c WHERE c.revision_id = r.id AND c.status = 'ABERTO') AS open_comments,
               (SELECT f.id::text FROM revision_file f JOIN file_text t ON t.file_id = f.id
                 WHERE f.revision_id = r.id AND t.thumb_key IS NOT NULL ORDER BY f.created_at DESC LIMIT 1) AS thumb_file_id
          FROM document d JOIN project p ON p.id = d.project_id
          LEFT JOIN revision r ON r.document_id = d.id AND r.is_current
         WHERE {' AND '.join(filtros)}
         ORDER BY d.updated_at DESC LIMIT 1000""", **params)
    return {"items": rows, "writer_url": get_settings().writer_url.rstrip("/")}


@router.get("/planilhas")
async def planilhas(conn: Conn, user: CurrentUser, project_id: str | None = None, q: str | None = None) -> dict[str, Any]:
    """Área Sheets: só os documentos que vieram do GPlanSiS|Sheets, com o vínculo à pasta de origem."""
    filtros = ["d.metadata->>'origem' = 'sheets'",
               "(:adm OR EXISTS (SELECT 1 FROM project_member m WHERE m.project_id = d.project_id AND m.user_id = CAST(:u AS uuid)))"]
    params: dict[str, Any] = {"u": user.id, "adm": user.is_admin}
    if project_id:
        filtros.append("d.project_id = CAST(:p AS uuid)")
        params["p"] = project_id
    if q:
        filtros.append("(d.code ILIKE :ql OR d.title ILIKE :ql)")
        params["ql"] = f"%{q}%"
    rows = await fetch_all(conn, f"""
        SELECT d.id::text, d.code, d.title, d.discipline_code, d.doc_type_code, p.id::text AS project_id,
               p.code AS project_code, p.name AS project_name, d.updated_at,
               d.metadata->>'sheets_book_id' AS sheets_book_id, d.metadata->>'sheets_versao' AS sheets_versao,
               d.metadata->>'enviado_por' AS enviado_por, d.metadata->>'enviado_em' AS enviado_em,
               d.metadata->>'planilhas' AS planilhas, d.metadata->>'com_bi' AS com_bi,
               r.id::text AS revision_id, r.label AS revision_label, r.status AS revision_status, r.purpose,
               (SELECT count(*) FROM revision_comment c WHERE c.revision_id = r.id AND c.status = 'ABERTO') AS open_comments,
               (SELECT f.id::text FROM revision_file f JOIN file_text t ON t.file_id = f.id
                 WHERE f.revision_id = r.id AND t.thumb_key IS NOT NULL ORDER BY f.created_at DESC LIMIT 1) AS thumb_file_id
          FROM document d JOIN project p ON p.id = d.project_id
          LEFT JOIN revision r ON r.document_id = d.id AND r.is_current
         WHERE {' AND '.join(filtros)}
         ORDER BY d.updated_at DESC LIMIT 1000""", **params)
    return {"items": rows, "sheets_url": get_settings().sheets_url.rstrip("/")}


@router.get("/documentos/{document_id}/estado")
async def estado_documento(document_id: str, conn: Conn, user: CurrentUser) -> Any:
    """Mesmo conteúdo dos eventos enviados ao Drawings — usado para sincronizar sob demanda."""
    await access.require(conn, await access.project_of_document(conn, document_id), user)
    row = await fetch_one(conn, "SELECT fn_integracao_estado(CAST(:d AS uuid)) AS e", d=document_id)
    if not row or not row["e"]:
        raise DomainError("Documento não encontrado", 404)
    return row["e"]


@router.delete("/revisoes/{revision_id}/arquivos-drawings")
async def limpa_arquivos(revision_id: str, conn: Conn, user: CurrentUser) -> dict[str, int]:
    """Remove os arquivos que o próprio Drawings enviou antes nesta revisão, para o reenvio substituí-los.
    Só funciona com a revisão EM_ELABORACAO (o gatilho INV-REV-003 garante); anexos manuais ficam."""
    await access.require(conn, await access.project_of_revision(conn, revision_id), user, access.WRITE_ROLES)
    rows = await fetch_all(conn, """DELETE FROM revision_file WHERE revision_id = CAST(:r AS uuid)
                                    AND filename LIKE :m RETURNING id""", r=revision_id, m=f"%{MARCA_ARQUIVO}%")
    return {"removidos": len(rows)}


@router.delete("/revisoes/{revision_id}/arquivos-writer")
async def limpa_arquivos_writer(revision_id: str, conn: Conn, user: CurrentUser) -> dict[str, int]:
    """Como a rota do Drawings, para os arquivos que o Writer enviou antes nesta revisão (marca .writer.)."""
    await access.require(conn, await access.project_of_revision(conn, revision_id), user, access.WRITE_ROLES)
    rows = await fetch_all(conn, """DELETE FROM revision_file WHERE revision_id = CAST(:r AS uuid)
                                    AND filename LIKE :m RETURNING id""", r=revision_id, m=f"%{MARCA_WRITER}%")
    return {"removidos": len(rows)}


@router.delete("/revisoes/{revision_id}/arquivos-sheets")
async def limpa_arquivos_sheets(revision_id: str, conn: Conn, user: CurrentUser) -> dict[str, int]:
    """Como a rota do Drawings, para os arquivos que o Sheets enviou antes nesta revisão (marca .sheets.)."""
    await access.require(conn, await access.project_of_revision(conn, revision_id), user, access.WRITE_ROLES)
    rows = await fetch_all(conn, """DELETE FROM revision_file WHERE revision_id = CAST(:r AS uuid)
                                    AND filename LIKE :m RETURNING id""", r=revision_id, m=f"%{MARCA_SHEETS}%")
    return {"removidos": len(rows)}


SISTEMAS_PDF = ("writer", "sheets")     # quem gera PDF de revisão por esta rota


@router.post("/pdf")
async def html_para_pdf(conn: Conn, user: CurrentUser, arquivo: UploadFile = File(...)) -> Response:
    """HTML → PDF pelo Chromium do Gotenberg (mesmo motor da impressão do navegador): o Writer manda o HTML
    de impressão, com @page (tamanho, margens, cabeçalho, rodapé e "Página X de Y"), e recebe o PDF.
    Só o servidor do Writer/Sheets (chave de integração) chama esta rota; o HTML é saneado e montado num
    modelo fixo antes de ir ao Gotenberg, que roda sem JavaScript, com deny-list e sem saída de rede."""
    if user.integracao not in SISTEMAS_PDF:
        raise DomainError("Conversão HTML → PDF só pela integração do GPlanSiS|Writer ou do GPlanSiS|Sheets", 403)
    html = await arquivo.read(LIMITE_HTML_PDF + 1)
    if len(html) > LIMITE_HTML_PDF:
        raise DomainError("HTML grande demais para converter (máx. 60 MB)", 413)
    html = sanear_html(html)
    try:
        async with httpx.AsyncClient(timeout=180) as cli:
            r = await cli.post(f"{get_settings().gotenberg_url}/forms/chromium/convert/html",
                               files={"files": ("index.html", html, "text/html")},
                               data={"preferCssPageSize": "true", "printBackground": "true", "generateDocumentOutline": "true"})
    except httpx.HTTPError as e:
        raise DomainError(f"Conversor de PDF indisponível ({type(e).__name__})", 502) from e
    if r.status_code != 200 or not r.content.startswith(b"%PDF"):
        raise DomainError(f"O conversor não gerou o PDF ({r.status_code})", 502)
    return Response(r.content, media_type="application/pdf")
