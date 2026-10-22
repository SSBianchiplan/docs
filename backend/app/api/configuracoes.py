"""Módulo Configurações (menu do avatar).

Para todos: perfil (nome, empresa, foto), preferências e "sair de todos os aparelhos".
Para administradores: Assistente IA (chave da Anthropic cifrada, modelo, teste), integração com o
GPlanSiS|Drawings (fila de eventos) e painel do sistema (serviços, filas, armazenamento, parâmetros).
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import json
import re
import time
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from app.api.deps import Conn
from app.core import sysconfig
from app.core.config import get_settings
from app.core.db import fetch_all, fetch_one, scalar
from app.core.errors import DomainError
from app.core.security import CurrentUser, issue_token
from app.services import ia_cota

router = APIRouter(prefix="/config", tags=["configurações"])

MODELOS = [
    ("claude-opus-5-5", "Claude Opus 5.5 — o mais capaz para análise técnica"),
    ("claude-sonnet-5-5", "Claude Sonnet 5.5 — rápido e econômico"),
    ("claude-sonnet-5", "Claude Sonnet 5 — o validado na verificação de comentários"),
    ("claude-haiku-5-5", "Claude Haiku 5.5 — o mais barato, para volume"),
]


def _admin(user: CurrentUser) -> None:
    if not user.is_admin:
        raise DomainError("Somente administradores", 403)


# ---------------------------------------------------------------------------- perfil
async def _perfil(conn: Conn, user_id: str) -> dict[str, Any]:
    row = await fetch_one(conn, """
        SELECT u.id::text, u.email::text, u.name, u.company, u.is_admin, u.is_external, u.created_at, u.last_login_at,
               u.password_changed_at, coalesce(p.avatar_ver, 0) AS avatar_ver, p.avatar_mime IS NOT NULL AS has_avatar,
               coalesce(p.prefs, '{}'::jsonb) AS prefs,
               (SELECT json_agg(json_build_object('code', pr.code, 'name', pr.name, 'role', m.role) ORDER BY pr.code)
                  FROM project_member m JOIN project pr ON pr.id = m.project_id WHERE m.user_id = u.id) AS projects
          FROM app_user u LEFT JOIN user_profile p ON p.user_id = u.id WHERE u.id = CAST(:u AS uuid)""", u=user_id)
    if not row:
        raise DomainError("Usuário não encontrado", 404)
    return {**row, "projects": row["projects"] or []}


@router.get("/perfil")
async def perfil(conn: Conn, user: CurrentUser) -> dict[str, Any]:
    return await _perfil(conn, user.id)


class PerfilIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    company: str | None = Field(default=None, max_length=120)
    prefs: dict[str, Any] | None = None


@router.patch("/perfil")
async def altera_perfil(body: PerfilIn, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    if body.name is not None or body.company is not None:
        await fetch_one(conn, """UPDATE app_user SET name = coalesce(:n, name),
                                        company = CASE WHEN CAST(:setc AS boolean) THEN :c ELSE company END
                                  WHERE id = CAST(:u AS uuid) RETURNING id""",
                        n=body.name.strip() if body.name else None, setc=body.company is not None,
                        c=(body.company or "").strip() or None, u=user.id)
    if body.prefs is not None:
        if len(json.dumps(body.prefs)) > 20_000:
            raise DomainError("Preferências grandes demais", 413)
        await fetch_one(conn, """INSERT INTO user_profile (user_id, prefs) VALUES (CAST(:u AS uuid), CAST(:p AS jsonb))
                                 ON CONFLICT (user_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = now() RETURNING user_id""",
                        u=user.id, p=json.dumps(body.prefs))
    return await _perfil(conn, user.id)


class AvatarIn(BaseModel):
    data_url: str = Field(max_length=600_000)


@router.put("/perfil/avatar")
async def troca_avatar(body: AvatarIn, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    m = re.match(r"^data:(image/(?:webp|png|jpeg));base64,([A-Za-z0-9+/=]+)$", body.data_url)
    if not m:
        raise DomainError("Imagem inválida (use PNG, JPEG ou WebP)", 422)
    try:
        raw = base64.b64decode(m.group(2), validate=True)
    except binascii.Error as e:
        raise DomainError("Imagem inválida", 422) from e
    tipo = m.group(1)
    sig = {"image/png": raw.startswith(b"\x89PNG"), "image/jpeg": raw.startswith(b"\xff\xd8\xff"), "image/webp": raw[8:12] == b"WEBP"}
    if not sig[tipo]:
        raise DomainError("O conteúdo não corresponde ao tipo de imagem", 422)
    if len(raw) > 400_000:
        raise DomainError("Imagem grande demais (máx. 400 KB)", 413)
    await fetch_one(conn, """INSERT INTO user_profile (user_id, avatar, avatar_mime, avatar_ver) VALUES (CAST(:u AS uuid), :a, :m, 1)
                             ON CONFLICT (user_id) DO UPDATE SET avatar = EXCLUDED.avatar, avatar_mime = EXCLUDED.avatar_mime,
                                    avatar_ver = user_profile.avatar_ver + 1, updated_at = now() RETURNING user_id""",
                    u=user.id, a=raw, m=tipo)
    return await _perfil(conn, user.id)


@router.delete("/perfil/avatar")
async def remove_avatar(conn: Conn, user: CurrentUser) -> dict[str, Any]:
    await fetch_one(conn, """UPDATE user_profile SET avatar = NULL, avatar_mime = NULL, avatar_ver = avatar_ver + 1,
                             updated_at = now() WHERE user_id = CAST(:u AS uuid) RETURNING user_id""", u=user.id)
    return await _perfil(conn, user.id)


@router.get("/avatar/{user_id}")
async def avatar(user_id: str, conn: Conn, user: CurrentUser) -> Response:
    """Foto de qualquer usuário (para listas e cabeçalhos). Use com ?token= de escopo file e ?v= da versão."""
    row = await fetch_one(conn, "SELECT avatar, avatar_mime FROM user_profile WHERE user_id = CAST(:u AS uuid)", u=user_id)
    if not row or not row["avatar"]:
        raise DomainError("Sem foto", 404)
    return Response(bytes(row["avatar"]), media_type=row["avatar_mime"],
                    headers={"Cache-Control": "private, max-age=31536000, immutable"})


@router.post("/sessoes/encerrar")
async def encerra_sessoes(conn: Conn, user: CurrentUser) -> dict[str, Any]:
    """Sai de todos os aparelhos: invalida os tokens emitidos até agora e devolve um novo para esta sessão."""
    u = await fetch_one(conn, """UPDATE app_user SET password_changed_at = now() WHERE id = CAST(:u AS uuid)
                                 RETURNING id::text, email::text, name, is_admin""", u=user.id)
    await asyncio.sleep(1.05)   # o token novo precisa nascer depois do corte (precisão de segundos)
    return {"token": issue_token(u)}


# ---------------------------------------------------------------------------- assistente IA
def _ia_publica(c: dict[str, Any]) -> dict[str, Any]:
    _, cifragem = sysconfig.fernet()
    return {"configurada": bool(c["chave"]), "ativo": c["ativo"], "pronta": c["pronta"], "origem": c["origem"],
            "final": c["final"], "modelo": c["modelo"], "ilegivel": c["ilegivel"], "cifragem": cifragem,
            "modelos": [{"id": m, "nome": n} for m, n in MODELOS],
            "atualizado_em": c["atualizado_em"], "atualizado_por": c["atualizado_por"]}


@router.get("/ia")
async def ve_ia(conn: Conn, user: CurrentUser) -> dict[str, Any]:
    _admin(user)
    return _ia_publica(await sysconfig.ia_config(forcar=True))


class IAIn(BaseModel):
    chave: str | None = Field(default=None, max_length=300)     # vazio = manter a atual
    modelo: str = Field(pattern=r"^claude-[a-z0-9.\-]+$", max_length=80)
    ativo: bool = True


async def _grava_ia(conn: Conn, user: CurrentUser, valor: dict[str, Any]) -> dict[str, Any]:
    await fetch_one(conn, """INSERT INTO system_config (id, value, updated_by) VALUES ('ia', CAST(:v AS jsonb), CAST(:u AS uuid))
                             ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by
                             RETURNING id""", v=json.dumps(valor), u=user.id)
    sysconfig.invalida()
    return _ia_publica(sysconfig.ia_de_valor({**valor, "_atualizado_em": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                               "_atualizado_por": user.name}))


@router.put("/ia")
async def configura_ia(body: IAIn, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    _admin(user)
    atual = await sysconfig.le(conn, "ia")
    valor = {k: v for k, v in atual.items() if not k.startswith("_")}
    valor.update(modelo=body.modelo, ativo=body.ativo)
    if body.chave:
        k = body.chave.strip()
        if not re.match(r"^sk-ant-[A-Za-z0-9_\-]{20,}$", k):
            raise DomainError("Isto não parece uma chave da Anthropic (começa com sk-ant-)", 422)
        valor.update(chave_cifrada=sysconfig.cifra(k), final=k[-4:])
    return await _grava_ia(conn, user, valor)


@router.delete("/ia/chave")
async def remove_chave_ia(conn: Conn, user: CurrentUser) -> dict[str, Any]:
    _admin(user)
    valor = {k: v for k, v in (await sysconfig.le(conn, "ia")).items() if not k.startswith("_") and k not in ("chave_cifrada", "final")}
    return await _grava_ia(conn, user, valor)


class IATeste(BaseModel):
    chave: str | None = Field(default=None, max_length=300)
    modelo: str | None = Field(default=None, max_length=80)


@router.post("/ia/testar")
async def testa_ia(body: IATeste, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    """Valida a chave (lista os modelos que ela enxerga) e faz uma chamada curta ao modelo escolhido."""
    _admin(user)
    import anthropic
    cfg = await sysconfig.ia_config(forcar=True)
    chave = (body.chave or "").strip() or cfg["chave"]
    if not chave:
        raise DomainError("Cole uma chave para testar", 422)
    modelo = body.modelo or cfg["modelo"]
    cli = anthropic.AsyncAnthropic(api_key=chave, timeout=60.0, max_retries=1)
    t0 = time.time()
    try:
        disponiveis = [m.id async for m in cli.models.list() if m.id.startswith("claude-")]
        if modelo not in disponiveis:
            return {"ok": False, "erro": f"A chave é válida, mas não tem acesso a {modelo}", "modelos": disponiveis}
        msg = await cli.messages.create(model=modelo, max_tokens=256, messages=[{"role": "user", "content": "Responda apenas: OK"}])
        await ia_cota.registra(user.id, "teste_chave", msg.model, msg.usage, True, None, int((time.time() - t0) * 1000))
    except anthropic.AuthenticationError:
        return {"ok": False, "erro": "Chave da Anthropic recusada (inválida ou revogada)", "modelos": []}
    except anthropic.PermissionDeniedError:
        return {"ok": False, "erro": "A chave não tem permissão para este modelo", "modelos": []}
    except anthropic.RateLimitError:
        return {"ok": False, "erro": "Limite de uso da Anthropic atingido — tente em instantes", "modelos": []}
    except anthropic.APIStatusError as e:
        return {"ok": False, "erro": f"A Anthropic respondeu {e.status_code}", "modelos": []}
    except anthropic.APIConnectionError:
        return {"ok": False, "erro": "Sem conexão com a Anthropic a partir do servidor", "modelos": []}
    texto = "".join(b.text for b in msg.content if b.type == "text").strip()
    return {"ok": True, "modelo": msg.model, "resposta": texto[:60], "ms": int((time.time() - t0) * 1000), "modelos": disponiveis}


# ---------------------------------------------------------------------------- sistema
async def _servico(nome: str, coro: Any) -> dict[str, Any]:
    t0 = time.time()
    try:
        det = await coro
        return {"nome": nome, "ok": True, "ms": int((time.time() - t0) * 1000), "detalhe": det}
    except Exception as e:  # noqa: BLE001 — o painel mostra a falha em vez de quebrar
        return {"nome": nome, "ok": False, "ms": int((time.time() - t0) * 1000), "detalhe": f"{type(e).__name__}: {e}"[:200]}


@router.get("/sistema")
async def sistema(conn: Conn, user: CurrentUser) -> dict[str, Any]:
    _admin(user)
    s = get_settings()

    async def db() -> str:
        v = await scalar(conn, "SELECT split_part(version(), ' ', 2)")
        tam = await scalar(conn, "SELECT pg_size_pretty(pg_database_size(current_database()))")
        return f"PostgreSQL {v} · {tam}"

    async def redis_() -> str:
        from redis.asyncio import Redis
        r = Redis.from_url(s.redis_url)
        try:
            await r.ping()
            fila = await r.zcard("arq:queue")
            saude = await r.get("arq:queue:health-check")
            return f"fila de processamento: {fila} · worker: {saude.decode()[:120] if saude else 'sem batimento recente'}"
        finally:
            await r.aclose()

    async def http(url: str) -> str:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(url)
        if r.status_code >= 400:
            raise RuntimeError(f"HTTP {r.status_code}")
        return f"HTTP {r.status_code}"

    servicos = [await _servico("Banco de dados", db()), await _servico("Fila (Redis) e worker", redis_()),
                await _servico("Conversor Office → PDF (Gotenberg)", http(s.gotenberg_url.rstrip("/") + "/health"))]
    if s.integracao_drawings_segredo:
        servicos.append(await _servico("GPlanSiS|Drawings", http(s.drawings_url.rstrip("/") + "/api/saude")))
    if s.integracao_writer_segredo:
        servicos.append(await _servico("GPlanSiS|Writer", http(s.writer_url.rstrip("/") + "/api/saude")))
    if s.integracao_sheets_segredo:
        servicos.append(await _servico("GPlanSiS|Sheets", http(s.sheets_url.rstrip("/") + "/api/saude")))
    contagens = await fetch_one(conn, """
        SELECT (SELECT count(*) FROM app_user WHERE is_active) AS usuarios_ativos,
               (SELECT count(*) FROM app_user WHERE NOT is_active) AS usuarios_inativos,
               (SELECT count(*) FROM project WHERE active) AS projetos,
               (SELECT count(*) FROM document) AS documentos,
               (SELECT count(*) FROM revision) AS revisoes,
               (SELECT count(*) FROM revision_file) AS arquivos,
               (SELECT count(*) FROM blob) AS blobs,
               (SELECT coalesce(sum(size_bytes), 0) FROM blob) AS bytes,
               (SELECT count(*) FROM audit_log) AS eventos_auditoria""")
    ocr = await fetch_all(conn, "SELECT status, count(*) AS n FROM file_text GROUP BY status ORDER BY status")
    async def integ_de(sistema: str) -> dict[str, Any]:
        return await fetch_one(conn, """
            SELECT count(*) FILTER (WHERE entregue_em IS NOT NULL) AS entregues,
                   count(*) FILTER (WHERE entregue_em IS NULL AND tentativas < 30) AS pendentes,
                   count(*) FILTER (WHERE entregue_em IS NULL AND tentativas >= 30) AS desistidos,
                   max(entregue_em) AS ultimo_entregue,
                   (SELECT ultimo_erro FROM integracao_evento WHERE sistema = :s AND ultimo_erro IS NOT NULL ORDER BY id DESC LIMIT 1) AS ultimo_erro,
                   (SELECT count(*) FROM document WHERE metadata->>'origem' = :s) AS documentos
              FROM integracao_evento WHERE sistema = :s""", s=sistema) or {}
    integ = await integ_de("drawings")
    integ_w = await integ_de("writer")
    integ_s = await integ_de("sheets")
    _, cifragem = sysconfig.fernet()
    return {
        "servicos": servicos, "contagens": contagens, "ocr": ocr,
        "integracao": {**integ, "documentos_drawings": integ.get("documentos", 0), "ativa": bool(s.integracao_drawings_segredo), "drawings_url": s.drawings_url},
        "integracao_writer": {**integ_w, "ativa": bool(s.integracao_writer_segredo), "url": s.writer_url},
        "integracao_sheets": {**integ_s, "ativa": bool(s.integracao_sheets_segredo), "url": s.sheets_url},
        "parametros": [
            ["Armazenamento de arquivos", "volume local" if s.storage_backend == "fs" else f"S3 ({s.s3_endpoint})"],
            ["Limite de envio", f"{s.max_upload_mb} MB por arquivo"],
            ["OCR", f"{s.ocr_engine} · idiomas {s.ocr_languages} · {s.ocr_dpi} dpi · até {s.ocr_max_pages} páginas"],
            ["PDF/A pesquisável", "gerado" if s.ocr_archive_pdfa else "desligado"],
            ["Busca semântica (embeddings)", "ligada" if s.embeddings_enabled else "desligada"],
            ["Validade da sessão", f"{s.jwt_ttl_minutes // 60} h"],
            ["Cifragem de segredos do painel", cifragem],
            ["Administrador master", s.bootstrap_admin_email],
        ],
        "gerado_em": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


@router.post("/integracao/reenviar")
async def reenviar(conn: Conn, user: CurrentUser) -> dict[str, int]:
    """Reprograma para agora os eventos aos sistemas integrados que ainda não foram entregues (inclusive os que desistiram)."""
    _admin(user)
    rows = await fetch_all(conn, """UPDATE integracao_evento SET proxima_em = now(), tentativas = 0
                                     WHERE entregue_em IS NULL RETURNING id""")
    return {"reprogramados": len(rows)}


@router.get("/integracao/eventos")
async def eventos(conn: Conn, user: CurrentUser) -> list[dict[str, Any]]:
    _admin(user)
    return await fetch_all(conn, """
        SELECT e.id, e.sistema, e.tipo, d.code, e.criado_em, e.entregue_em, e.tentativas, e.ultimo_erro
          FROM integracao_evento e JOIN document d ON d.id = e.document_id ORDER BY e.id DESC LIMIT 50""")
