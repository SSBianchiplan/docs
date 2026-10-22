"""Correções da auditoria de out/2026 (A1, M14): cada teste tenta o ataque e espera a recusa.

* /integracao/pdf só para o servidor do Writer/Sheets, com HTML saneado num modelo fixo;
* a chave de integração só abre as rotas que os sistemas integrados usam (não vira admin);
* /suggestions e /audit respeitam projeto e confidencialidade;
* /files/{id}/content não serve HTML/SVG inline na origem do Docs;
* a API não sobe em produção com JWT_SECRET/BOOTSTRAP_ADMIN_PASSWORD padrão.
Os testes de API usam o banco de teste (TEST_DSN) e pulam se ele não estiver no ar.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import Iterator
from typing import Any

import asyncpg
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.services.html_pdf import sanear_css, sanear_html

DSN = os.environ.get("TEST_DSN", "postgresql://postgres@localhost:5432/edms_test")


# ----------------------------------------------------------------------------- configuração de produção
def _settings(**kw: Any) -> Settings:
    return Settings(_env_file=None, **kw)  # type: ignore[call-arg]


def test_producao_recusa_jwt_secret_padrao() -> None:
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        _settings(app_env="producao", jwt_secret="troque-este-segredo", bootstrap_admin_password="Senha-Forte-123")


def test_producao_recusa_jwt_secret_curto_ou_vazio() -> None:
    for seg in ("", "curto-demais"):
        with pytest.raises(ValidationError, match="JWT_SECRET"):
            _settings(app_env="producao", jwt_secret=seg, bootstrap_admin_password="Senha-Forte-123")


def test_producao_recusa_senha_inicial_padrao() -> None:
    with pytest.raises(ValidationError, match="BOOTSTRAP_ADMIN_PASSWORD"):
        _settings(app_env="producao", jwt_secret="a" * 64, bootstrap_admin_password="troque-no-primeiro-acesso")


def test_producao_aceita_segredos_definidos_e_dev_aceita_padrao() -> None:
    assert _settings(app_env="producao", jwt_secret="a" * 64, bootstrap_admin_password="Senha-Forte-123")
    assert _settings(app_env="dev", jwt_secret="troque-este-segredo")


def test_padrao_sem_app_env_e_producao(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("BOOTSTRAP_ADMIN_PASSWORD", raising=False)
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        _settings()


# ----------------------------------------------------------------------------- saneamento do HTML → PDF
HOSTIL = b"""<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Rel &amp; 1</title>
<base href="http://api:8000/"><meta http-equiv="refresh" content="0;url=http://redis:6379/">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans">
<style>@import url("http://169.254.169.254/latest/meta-data/");
@page{size:A4;margin:15mm;@bottom-right{content:"P\\e1gina " counter(page) " de " counter(pages)}}
body{background:url(http://api:8000/api/health)} .x{background-image:image-set("http://api:8000/a" 1x)}
.ok{background:url("data:image/png;base64,AAAA")} .esc{background:\\75rl(http://api:8000/esc)}</style></head>
<body><h1 onclick="alert(1)">T\xc3\xadtulo</h1><script>fetch('http://api:8000/')</script>
<iframe src="file:///etc/passwd"></iframe><object data="http://api:8000/"></object><embed src="file:///tmp/">
<svg><image href="http://api:8000/"/></svg><img src="http://api:8000/api/health"><img src="file:///tmp/x.png">
<img src="data:image/png;base64,iVBORw0KGgo=" alt="ok"><p style="color:red;background:url(http://api:8000/s)">texto</p>
<table><colgroup><col style="width:10px"></colgroup><tr><td colspan="2">c\xc3\xa9lula</td></tr></table>
<a href="javascript:alert(1)">js</a><a href="https://gplansis.com">ok</a></body></html>"""


def test_sanear_html_tira_tudo_que_busca_recurso_ou_roda_script() -> None:
    out = sanear_html(HOSTIL).decode()
    baixo = out.lower()
    for proibido in ("<script", "<iframe", "<object", "<embed", "<svg", "<link", "<base", "http-equiv", "onclick",
                     "javascript:", "@import", "api:8000", "169.254", "redis", "file:", "image-set", "\\75rl"):
        assert proibido not in baixo, proibido
    assert out.startswith('<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Rel &amp; 1</title>')
    assert "@page{size:A4" in out and "counter(pages)" in out                # cabeçalho/rodapé do Writer
    assert 'src="data:image/png;base64,iVBORw0KGgo="' in out                    # imagem embutida do Writer
    assert 'url("data:image/png;base64,AAAA")' in out
    assert 'colspan="2"' in out and "célula" in out and "Título" in out
    assert 'href="https://gplansis.com"' in out


def test_sanear_html_preserva_escape_css_legitimo() -> None:
    out = sanear_html(b'<style>@page{@bottom-right{content:"P\\e1gina " counter(page)}}</style><p>x</p>').decode()
    assert 'content:"P\\e1gina " counter(page)' in out


def test_sanear_css_desfaz_escape_que_disfarca_url() -> None:
    assert "api" not in sanear_css(r"a{background:\75 rl(http://api/x)}")
    assert sanear_css('a{content:"\\"ok\\""}') == 'a{content:"\\"ok\\""}'


def test_sanear_html_nao_fecha_o_style_do_modelo() -> None:
    out = sanear_html(b"<style>a{content:'</sty'}</style><p>x</p>").decode()
    assert out.count("</style>") == 1


# ----------------------------------------------------------------------------- lista de rotas da integração
def test_integracao_so_abre_as_rotas_dos_sistemas_integrados() -> None:
    from app.core.security import rota_integracao_permitida as ok
    for m, p in (("POST", "/api/integracao/pdf"), ("GET", "/api/projects"), ("GET", "/api/catalog"),
                 ("GET", "/api/projects/x/members"), ("POST", "/api/documents"), ("PATCH", "/api/documents/x"),
                 ("POST", "/api/documents/x/revisions"), ("POST", "/api/revisions/x/files"),
                 ("POST", "/api/revisions/x/workflow"), ("GET", "/api/integracao/documentos/x/estado"),
                 ("DELETE", "/api/integracao/revisoes/x/arquivos-writer")):
        assert ok(m, p), (m, p)
    for m, p in (("GET", "/api/config/usuarios"), ("PUT", "/api/config/ia"), ("POST", "/api/projects"),
                 ("PUT", "/api/projects/x/members"), ("DELETE", "/api/projects/x/members/y"), ("GET", "/api/audit"),
                 ("GET", "/api/suggestions"), ("GET", "/api/files/x/content"), ("GET", "/api/documents"),
                 ("GET", "/api/search"), ("POST", "/api/auth/login"), ("PATCH", "/api/documents/x/../../config"),
                 ("POST", "/api/integracao/pdf/x")):
        assert not ok(m, p), (m, p)


# ----------------------------------------------------------------------------- API (banco de teste)
async def _seed() -> dict[str, str]:
    conn = await asyncpg.connect(DSN)
    try:
        tag = uuid.uuid4().hex[:8]
        ids: dict[str, str] = {"tag": tag}
        for k in ("autor", "leitor", "fora"):
            ids[k] = str(await conn.fetchval(
                """INSERT INTO app_user (email, name, password_hash, must_change_password)
                   VALUES ($1, $2, 'x', false) RETURNING id""", f"{k}-{tag}@t", k))
        code = "S" + tag[:6].upper()
        ids["code"] = code
        ids["p"] = str(await conn.fetchval("INSERT INTO project (code, name) VALUES ($1, 'Seg') RETURNING id", code))
        await conn.execute("INSERT INTO project_member (project_id, user_id, role) VALUES ($1, $2, 'AUTOR'), ($1, $3, 'LEITOR')",
                           ids["p"], ids["autor"], ids["leitor"])
        for k, conf, n in (("restrito", "RESTRITO", 1), ("interno", "INTERNO", 2)):
            ids[k] = str(await conn.fetchval(
                """INSERT INTO document (project_id, code, title, discipline_code, doc_type_code, created_by, confidentiality)
                   VALUES ($1, $2, 'Doc', 'MEC', 'DE', $3, $4) RETURNING id""",
                ids["p"], f"{code}-MEC-DE-000{n}", ids["autor"], conf))
            ids["s_" + k] = str(await conn.fetchval(
                """INSERT INTO ai_suggestion (kind, target_type, target_id, payload, engine)
                   VALUES ('CLASSIFICACAO', 'document', $1, '{"evidence": "segredo"}', 'teste') RETURNING id""", ids[k]))
        return ids
    finally:
        await conn.close()


@pytest.fixture(scope="module")
def api() -> Iterator[tuple[Any, dict[str, str]]]:
    try:
        ids = asyncio.run(_seed())
    except (OSError, asyncpg.PostgresError) as e:
        pytest.skip(f"Postgres de teste indisponível: {e}")
    from fastapi.testclient import TestClient

    from app.main import app
    with TestClient(app) as cli:      # um só loop de eventos para o pool do SQLAlchemy (o lifespan cria o admin de teste)
        yield cli, ids


def _bearer(ids: dict[str, str], quem: str) -> dict[str, str]:
    from app.core.security import issue_token
    tok = issue_token({"id": ids[quem], "email": f"{quem}-{ids['tag']}@t", "name": quem, "is_admin": False})
    return {"Authorization": f"Bearer {tok}"}


def _integ(ids: dict[str, str], quem: str, sistema: str = "writer") -> dict[str, str]:
    from app.core.security import chave_integracao
    k = chave_integracao("api", sistema)
    assert k
    return {"x-integracao": k.hex(), "x-em-nome-de": f"{quem}-{ids['tag']}@t"}


def test_pdf_recusa_usuario_logado_comum(api: tuple[Any, dict[str, str]]) -> None:
    cli, ids = api
    r = cli.post("/api/integracao/pdf", headers=_bearer(ids, "autor"),
                 files={"arquivo": ("a.html", b"<iframe src='http://api:8000'>", "text/html")})
    assert r.status_code == 403, r.text


def test_pdf_recusa_sem_sessao_e_integracao_do_drawings(api: tuple[Any, dict[str, str]]) -> None:
    cli, ids = api
    f = {"arquivo": ("a.html", b"<p>x</p>", "text/html")}
    assert cli.post("/api/integracao/pdf", files=f).status_code == 401
    assert cli.post("/api/integracao/pdf", files=f, headers={"x-integracao": "00", "x-em-nome-de": "x@t"}).status_code == 401
    assert cli.post("/api/integracao/pdf", files=f, headers=_integ(ids, "autor", "drawings")).status_code == 403


def test_pdf_pela_integracao_do_writer_manda_html_saneado(api: tuple[Any, dict[str, str]],
                                                          monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx
    cli, ids = api
    enviado: dict[str, Any] = {}

    async def falso_post(self: Any, url: str, files: Any = None, data: Any = None, **kw: Any) -> httpx.Response:
        enviado.update(url=url, html=files["files"][1], data=data)
        return httpx.Response(200, content=b"%PDF-1.7 teste")

    monkeypatch.setattr(httpx.AsyncClient, "post", falso_post)
    r = cli.post("/api/integracao/pdf", headers=_integ(ids, "autor"), files={"arquivo": ("a.html", HOSTIL, "text/html")})
    assert r.status_code == 200 and r.content.startswith(b"%PDF"), r.text
    assert enviado["url"].endswith("/forms/chromium/convert/html")
    html = enviado["html"].decode().lower()
    assert "<script" not in html and "api:8000" not in html and "<iframe" not in html and "@page" in html


def test_integracao_nao_abre_rotas_de_admin(api: tuple[Any, dict[str, str]]) -> None:
    cli, ids = api
    h = _integ(ids, "autor")
    assert cli.get("/api/projects", headers=h).status_code == 200            # rota que o Writer usa continua
    for metodo, rota in (("GET", "/api/config/ia"), ("GET", "/api/config/perfil"), ("POST", "/api/config/sessoes/encerrar"), ("GET", f"/api/audit?entity_id={ids['interno']}"),
                         ("GET", "/api/suggestions"), ("POST", "/api/projects")):
        r = cli.request(metodo, rota, headers=h, json={})
        assert r.status_code == 403, (rota, r.status_code, r.text)


def test_sugestoes_respeitam_projeto_e_confidencialidade(api: tuple[Any, dict[str, str]]) -> None:
    cli, ids = api

    def vistas(quem: str) -> set[str]:
        r = cli.get("/api/suggestions", headers=_bearer(ids, quem))
        assert r.status_code == 200, r.text
        return {s["id"] for s in r.json()}

    minhas = {ids["s_restrito"], ids["s_interno"]}
    assert vistas("fora") & minhas == set()                                  # não é membro: nada
    assert vistas("leitor") & minhas == {ids["s_interno"]}                   # LEITOR não vê RESTRITO
    assert vistas("autor") & minhas == minhas


def test_auditoria_exige_acesso_ao_documento(api: tuple[Any, dict[str, str]]) -> None:
    cli, ids = api
    assert cli.get(f"/api/audit?entity_id={ids['interno']}", headers=_bearer(ids, "fora")).status_code == 403
    assert cli.get(f"/api/audit?entity_id={ids['interno']}", headers=_bearer(ids, "leitor")).status_code == 200
    assert cli.get(f"/api/audit?entity_id={ids['restrito']}", headers=_bearer(ids, "leitor")).status_code == 403
    assert cli.get(f"/api/audit?entity_id={ids['p']}", headers=_bearer(ids, "autor")).status_code == 403
    assert cli.get("/api/audit", headers=_bearer(ids, "autor")).status_code == 403


@pytest.mark.parametrize("mime,disp,tipo,sandbox", [
    ("text/html", "attachment", "application/octet-stream", True),
    ("image/svg+xml", "attachment", "application/octet-stream", True),
    ("image/png", "inline", "image/png", True),
    ("application/pdf", "inline", "application/pdf", False),
])
def test_arquivo_ativo_nao_abre_inline(api: tuple[Any, dict[str, str]], monkeypatch: pytest.MonkeyPatch,
                                      mime: str, disp: str, tipo: str, sandbox: bool) -> None:
    from app.api import documents
    cli, ids = api

    async def linha(conn: Any, file_id: str, user: Any) -> dict[str, Any]:
        return {"storage_key": "k", "mime": mime, "filename": "a.bin", "archive_sha256": None}

    async def dados(key: str) -> bytes:
        return b"<script>alert(document.cookie)</script>"

    monkeypatch.setattr(documents, "_file_row", linha)
    monkeypatch.setattr(documents.storage, "get_bytes", dados)
    r = cli.get(f"/api/files/{uuid.uuid4()}/content", headers=_bearer(ids, "autor"))
    assert r.status_code == 200
    assert r.headers["content-disposition"].startswith(disp)
    assert r.headers["content-type"].startswith(tipo)
    assert r.headers["x-content-type-options"] == "nosniff"
    assert ("sandbox" in r.headers.get("content-security-policy", "")) is sandbox


def test_openapi_fora_de_producao_apenas() -> None:
    from app.main import app
    assert app.openapi_url == "/api/openapi.json"          # APP_ENV=teste; em produção é None (ver main.py)
