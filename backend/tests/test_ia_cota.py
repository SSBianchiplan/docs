"""Cota mensal de IA (auditoria 2026-10, M5): 402 ao estourar, 429 por ritmo, 413 por tamanho, uso real gravado,
erros do provedor sem detalhe e só administrador altera cota. Nenhum teste chama a Anthropic de verdade.

Roda contra o Postgres de TEST_DSN já migrado (alembic upgrade head); a API e o worker usam DATABASE_URL.
"""
from __future__ import annotations

import json
import os
import uuid
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any, ClassVar

import anthropic
import asyncpg
import httpx
import pytest

DSN = os.environ.get("TEST_DSN", "postgresql://postgres@localhost:5432/edms_test")
os.environ.setdefault("DATABASE_URL", DSN.replace("postgresql://", "postgresql+asyncpg://", 1))

from app.core import db as core_db
from app.core import sysconfig
from app.core.config import get_settings
from app.core.security import issue_token
from app.services import comment_check, ia_cota

pytestmark = pytest.mark.asyncio
SEGREDO = "detalhe-interno-do-provedor-XYZ"
CHAVE_FALSA = "sk-ant-teste-" + "a" * 30


async def _conecta() -> asyncpg.Connection:
    try:
        return await asyncpg.connect(DSN)
    except (OSError, asyncpg.PostgresError) as e:
        pytest.skip(f"Postgres de teste indisponível: {e}")


@pytest.fixture(autouse=True)
def _isola(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Engine novo por teste (cada teste tem o próprio event loop) e chave de IA controlada pelo teste."""
    core_db._engine = None
    sysconfig.invalida()
    monkeypatch.setattr(get_settings(), "anthropic_api_key", None)
    yield
    core_db._engine = None
    sysconfig.invalida()


def _liga_ia(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "anthropic_api_key", CHAVE_FALSA)
    sysconfig.invalida()


@pytest.fixture
async def mundo() -> Any:
    """Projeto com revisão A (aprovada, com comentário aberto) e revisão B (nova), ambas com texto extraído."""
    c = await _conecta()
    sfx = uuid.uuid4().hex[:6].upper()
    try:
        await c.execute("DELETE FROM system_config WHERE id = 'ia'")
        membro = await c.fetchval("INSERT INTO app_user (email, name, password_hash) VALUES ($1, 'Membro', 'x') RETURNING id::text",
                                  f"m{sfx}@t")
        admin = await c.fetchval("INSERT INTO app_user (email, name, password_hash, is_admin) VALUES ($1, 'Admin', 'x', true) "
                                 "RETURNING id::text", f"a{sfx}@t")
        p = await c.fetchval("INSERT INTO project (code, name) VALUES ($1, 'Projeto IA') RETURNING id", f"P{sfx[:5]}")
        await c.execute("INSERT INTO project_member (project_id, user_id, role) VALUES ($1, $2, 'AUTOR')", p, uuid.UUID(membro))
        d = await c.fetchval("""INSERT INTO document (project_id, code, title, discipline_code, doc_type_code, created_by)
                                VALUES ($1, $2, 'Arranjo', 'MEC', 'DE', $3) RETURNING id""",
                             p, f"P{sfx[:5]}-MEC-DE-0001", uuid.UUID(membro))
        sha_a, sha_b = (uuid.uuid4().hex * 2)[:64], (uuid.uuid4().hex * 2)[:64]
        for sha in (sha_a, sha_b):
            await c.execute("INSERT INTO blob (sha256, size_bytes, mime, storage_key) VALUES ($1, 10, 'application/pdf', $2)", sha, sha)
        ra = await c.fetchval("INSERT INTO revision (document_id, label, created_by) VALUES ($1, 'A', $2) RETURNING id",
                              d, uuid.UUID(membro))
        fa = await c.fetchval("""INSERT INTO revision_file (revision_id, blob_sha256, role, filename, created_by)
                                 VALUES ($1, $2, 'PDF', 'a.pdf', $3) RETURNING id""", ra, sha_a, uuid.UUID(membro))
        await c.execute("""INSERT INTO file_text (file_id, status, engine, content, processed_at)
                           VALUES ($1, 'CONCLUIDO', 't', 'Bomba centrifuga vazao 10 m3/h', now())""", fa)
        cm = await c.fetchval("""INSERT INTO revision_comment (revision_id, author_id, body)
                                 VALUES ($1, $2, 'Corrigir a vazao da bomba para 12 m3/h') RETURNING id::text""",
                              ra, uuid.UUID(membro))
        wi = await c.fetchval("""INSERT INTO workflow_instance (revision_id, template_id, started_by)
                                 VALUES ($1, '00000000-0000-0000-0000-00000000f001', $2) RETURNING id""", ra, uuid.UUID(membro))
        await c.execute("UPDATE revision SET status = 'EM_VERIFICACAO' WHERE id = $1", ra)
        await c.execute("UPDATE workflow_instance SET status = 'CONCLUIDO', finished_at = now() WHERE id = $1", wi)
        await c.execute("UPDATE revision SET status = 'APROVADA_INTERNA' WHERE id = $1", ra)
        await c.execute("UPDATE revision SET status = 'EMITIDA', issued_at = now(), purpose = 'PA' WHERE id = $1", ra)
        rb = await c.fetchval("INSERT INTO revision (document_id, label, created_by, is_current) VALUES ($1, 'B', $2, false) RETURNING id::text",
                              d, uuid.UUID(membro))
        fb = await c.fetchval("""INSERT INTO revision_file (revision_id, blob_sha256, role, filename, created_by)
                                 VALUES ($1, $2, 'PDF', 'b.pdf', $3) RETURNING id""", uuid.UUID(rb), sha_b, uuid.UUID(membro))
        await c.execute("""INSERT INTO file_text (file_id, status, engine, content, processed_at)
                           VALUES ($1, 'CONCLUIDO', 't', 'Bomba centrifuga vazao 12 m3/h', now())""", fb)
        yield SimpleNamespace(membro=membro, admin=admin, rev_b=rb, comentario=cm, conn=c)
    finally:
        await c.execute("DELETE FROM system_config WHERE id = 'ia'")
        await c.close()


def _token(uid: str, admin: bool = False) -> dict[str, str]:
    t = issue_token({"id": uid, "email": f"{uid}@t", "name": "Teste", "is_admin": admin})
    return {"authorization": f"Bearer {t}"}


_CLIENTES: list[Any] = []


def _cliente() -> Any:
    """Um TestClient por teste, aberto (um só event loop para o engine do SQLAlchemy)."""
    if not _CLIENTES:
        from fastapi.testclient import TestClient

        from app.main import app
        cli = TestClient(app)
        cli.__enter__()
        _CLIENTES.append(cli)
    return _CLIENTES[0]


@pytest.fixture(autouse=True)
def _fecha_cliente() -> Any:
    yield
    while _CLIENTES:
        _CLIENTES.pop().__exit__(None, None, None)
    core_db._engine = None


async def _gasta(c: asyncpg.Connection, uid: str, usd: float, n: int = 1, ok: bool | None = True) -> None:
    for _ in range(n):
        await c.execute("INSERT INTO ia_uso (user_id, recurso, custo_usd, ok) VALUES ($1, 'teste', $2, $3)",
                        uuid.UUID(uid), Decimal(str(usd)), ok)


class _AnthropicFalso:
    """Substitui anthropic.Anthropic: devolve uma resposta com usage conhecido ou levanta o erro pedido."""
    chamadas = 0
    erro: Exception | None = None
    prompts: ClassVar[list[str]] = []

    def __init__(self, **_: Any) -> None:
        self.messages = self

    def create(self, **kw: Any) -> Any:
        type(self).chamadas += 1
        type(self).prompts.append(kw["messages"][0]["content"])
        if type(self).erro:
            raise type(self).erro
        ids = [c["id"] for c in json.loads(kw["messages"][0]["content"].split("COMENTÁRIOS:\n", 1)[1].split("\n\n", 1)[0])]
        txt = json.dumps([{"id": i, "attended": True, "confidence": 0.9, "evidence": "vazao 12 m3/h"} for i in ids])
        return SimpleNamespace(model="claude-sonnet-5", content=[SimpleNamespace(type="text", text=txt)],
                               usage=SimpleNamespace(input_tokens=1000, output_tokens=500,
                                                     cache_read_input_tokens=0, cache_creation_input_tokens=0))


@pytest.fixture
def falso(monkeypatch: pytest.MonkeyPatch) -> type[_AnthropicFalso]:
    _AnthropicFalso.chamadas, _AnthropicFalso.erro, _AnthropicFalso.prompts = 0, None, []
    monkeypatch.setattr(anthropic, "Anthropic", _AnthropicFalso)
    return _AnthropicFalso


def _erro_500() -> anthropic.APIStatusError:
    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return anthropic.InternalServerError(SEGREDO, response=httpx.Response(500, request=req), body={"erro": SEGREDO})


# ---------------------------------------------------------------------------- migração
async def test_migracao_idempotente() -> None:
    c = await _conecta()
    try:
        sql = (Path(__file__).resolve().parents[1] / "app" / "sql" / "0009_ia_cota.sql").read_text(encoding="utf-8")
        await c.execute(sql)
        await c.execute(sql)
        assert await c.fetchval("SELECT count(*) FROM information_schema.columns WHERE table_name = 'app_user' "
                                "AND column_name = 'ia_cota_usd'") == 1
    finally:
        await c.close()


# ---------------------------------------------------------------------------- API
async def test_cota_estourada_402_sem_enfileirar(mundo: Any, monkeypatch: pytest.MonkeyPatch, falso: Any) -> None:
    _liga_ia(monkeypatch)
    fila: list[Any] = []
    monkeypatch.setattr("app.api.comments.enqueue_comment_check", lambda *a: fila.append(a))
    await _gasta(mundo.conn, mundo.membro, 25.0)
    r = _cliente().post(f"/api/revisions/{mundo.rev_b}/check-comments", headers=_token(mundo.membro))
    assert r.status_code == 402, r.text
    assert "Cota de IA do mês atingida" in r.json()["detail"]
    assert fila == [] and falso.chamadas == 0


async def test_cota_individual_sobrepoe_padrao(mundo: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    _liga_ia(monkeypatch)
    monkeypatch.setattr("app.api.comments.enqueue_comment_check", lambda *a: None)
    await _gasta(mundo.conn, mundo.membro, 1.0)
    cli = _cliente()
    assert cli.post(f"/api/revisions/{mundo.rev_b}/check-comments", headers=_token(mundo.membro)).status_code == 202
    r = cli.put(f"/api/config/ia/cota/usuarios/{mundo.membro}", json={"cota_usd": 0.5}, headers=_token(mundo.admin, True))
    assert r.status_code == 200 and r.json()["cota_usd"] == 0.5
    assert cli.post(f"/api/revisions/{mundo.rev_b}/check-comments", headers=_token(mundo.membro)).status_code == 402
    assert cli.put(f"/api/config/ia/cota/usuarios/{mundo.membro}", json={"cota_usd": None},
                   headers=_token(mundo.admin, True)).json()["cota_usd"] is None


async def test_ritmo_429(mundo: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    _liga_ia(monkeypatch)
    monkeypatch.setattr("app.api.comments.enqueue_comment_check", lambda *a: None)
    await _gasta(mundo.conn, mundo.membro, 0.0, n=30)
    r = _cliente().post(f"/api/revisions/{mundo.rev_b}/check-comments", headers=_token(mundo.membro))
    assert r.status_code == 429


async def test_sem_chave_gracioso(mundo: Any, monkeypatch: pytest.MonkeyPatch, falso: Any) -> None:
    fila: list[Any] = []
    monkeypatch.setattr("app.api.comments.enqueue_comment_check", lambda *a: fila.append(a))
    await _gasta(mundo.conn, mundo.membro, 99.0)       # sem chave não há custo: a heurística segue valendo
    r = _cliente().post(f"/api/revisions/{mundo.rev_b}/check-comments", headers=_token(mundo.membro))
    assert r.status_code == 202 and fila == [(mundo.rev_b, mundo.membro)]
    from app import worker
    core_db._engine = None
    n = await worker.check_comments({}, mundo.rev_b, mundo.membro)
    assert n == 1 and falso.chamadas == 0
    eng = await mundo.conn.fetchval("SELECT engine FROM ai_suggestion WHERE target_id = $1", uuid.UUID(mundo.comentario))
    assert eng == "heuristica-diff-v1"
    assert await mundo.conn.fetchval("SELECT count(*) FROM ia_uso WHERE user_id = $1 AND recurso <> 'teste'",
                                     uuid.UUID(mundo.membro)) == 0


async def test_corpo_grande_413(mundo: Any) -> None:
    cli = _cliente()
    grande = '{"cota_usd": 1, "x": "' + "a" * 100_000 + '"}'
    r = cli.put("/api/config/ia/cota", content=grande, headers={**_token(mundo.admin, True), "content-type": "application/json"})
    assert r.status_code == 413
    r = cli.post(f"/api/revisions/{mundo.rev_b}/check-comments", content="a" * 100_000, headers=_token(mundo.membro))
    assert r.status_code == 413


async def test_so_admin_altera_cota(mundo: Any) -> None:
    cli = _cliente()
    assert cli.put("/api/config/ia/cota", json={"cota_usd": 5}, headers=_token(mundo.membro)).status_code == 403
    assert cli.put(f"/api/config/ia/cota/usuarios/{mundo.membro}", json={"cota_usd": 100},
                   headers=_token(mundo.membro)).status_code == 403
    r = cli.put("/api/config/ia/cota", json={"cota_usd": 7.5}, headers=_token(mundo.admin, True))
    assert r.status_code == 200 and r.json()["cota_padrao_usd"] == 7.5
    assert cli.put("/api/config/ia/cota", json={"cota_usd": -1}, headers=_token(mundo.admin, True)).status_code == 422
    eu = cli.get("/api/config/ia/uso", headers=_token(mundo.membro)).json()
    assert eu["cota_usd"] == 7.5 and "por_usuario" not in eu
    assert "por_usuario" in cli.get("/api/config/ia/uso", headers=_token(mundo.admin, True)).json()
    # a chave e o modelo continuam onde estavam: salvar a configuração da IA preserva a cota
    r = cli.put("/api/config/ia", json={"modelo": "claude-sonnet-5", "ativo": True}, headers=_token(mundo.admin, True))
    assert r.status_code == 200
    assert cli.get("/api/config/ia/uso", headers=_token(mundo.membro)).json()["cota_padrao_usd"] == 7.5


async def test_teste_da_chave_nao_vaza_detalhe(mundo: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    class _Async:
        def __init__(self, **_: Any) -> None:
            self.models = self

        def list(self) -> Any:
            raise _erro_500()

    monkeypatch.setattr(anthropic, "AsyncAnthropic", _Async)
    r = _cliente().post("/api/config/ia/testar", json={"chave": CHAVE_FALSA}, headers=_token(mundo.admin, True))
    assert r.status_code == 200 and r.json()["ok"] is False
    assert SEGREDO not in r.text


# ---------------------------------------------------------------------------- worker
async def test_uso_real_gravado_com_custo(mundo: Any, monkeypatch: pytest.MonkeyPatch, falso: Any) -> None:
    _liga_ia(monkeypatch)
    from app import worker
    n = await worker.check_comments({}, mundo.rev_b, mundo.membro)
    assert n == 1 and falso.chamadas == 1
    row = await mundo.conn.fetchrow("""SELECT * FROM ia_uso WHERE user_id = $1 AND recurso = 'verificar_comentarios'""",
                                    uuid.UUID(mundo.membro))
    assert row["ok"] is True and row["input_tokens"] == 1000 and row["output_tokens"] == 500
    assert row["modelo"] == "claude-sonnet-5" and row["ref"] == mundo.rev_b
    assert row["custo_usd"] == Decimal("0.007000")            # 1000 × 2 + 500 × 10 por milhão
    eng = await mundo.conn.fetchval("SELECT engine FROM ai_suggestion WHERE target_id = $1", uuid.UUID(mundo.comentario))
    assert eng == "claude:claude-sonnet-5"


async def test_worker_sem_saldo_nao_chama_ia(mundo: Any, monkeypatch: pytest.MonkeyPatch, falso: Any) -> None:
    _liga_ia(monkeypatch)
    await _gasta(mundo.conn, mundo.membro, 20.0)
    from app import worker
    assert await worker.check_comments({}, mundo.rev_b, mundo.membro) == 1    # heurística
    assert falso.chamadas == 0


async def test_worker_atribui_ao_autor_sem_user(mundo: Any, monkeypatch: pytest.MonkeyPatch, falso: Any) -> None:
    _liga_ia(monkeypatch)
    from app import worker
    await worker.check_comments({}, mundo.rev_b)               # caminho do OCR: conta para quem criou a revisão
    assert await mundo.conn.fetchval("SELECT count(*) FROM ia_uso WHERE user_id = $1 AND recurso = 'verificar_comentarios'",
                                     uuid.UUID(mundo.membro)) == 1


async def test_erro_do_provedor_registrado_sem_detalhe(mundo: Any, monkeypatch: pytest.MonkeyPatch, falso: Any) -> None:
    _liga_ia(monkeypatch)
    falso.erro = _erro_500()
    from app import worker
    assert await worker.check_comments({}, mundo.rev_b, mundo.membro) == 1    # cai para a heurística
    row = await mundo.conn.fetchrow("SELECT ok, erro FROM ia_uso WHERE user_id = $1 AND recurso = 'verificar_comentarios'",
                                    uuid.UUID(mundo.membro))
    assert row["ok"] is False and row["erro"] == "status_500"
    vazou = await mundo.conn.fetchval("SELECT count(*) FROM ai_suggestion WHERE payload::text LIKE $1 OR engine LIKE $1",
                                      f"%{SEGREDO}%")
    assert vazou == 0


async def test_prompt_limitado(falso: Any) -> None:
    linha = "x" * 5000
    velho = "\n".join(f"{i} {linha}" for i in range(400))
    novo = "\n".join(f"{i} y{linha}" for i in range(400))
    comentarios = [{"id": str(i), "body": "z" * 50_000} for i in range(500)]
    comment_check.with_claude(comentarios, velho, novo, CHAVE_FALSA, "claude-sonnet-5", {})
    assert len(falso.prompts[0]) <= comment_check.MAX_PROMPT + 2000


async def test_preco_e_custo() -> None:
    u = SimpleNamespace(input_tokens=1_000_000, output_tokens=1_000_000, cache_read_input_tokens=0, cache_creation_input_tokens=0)
    assert ia_cota.custo("claude-opus-5-5", u) == 24.0
    assert ia_cota.custo("claude-sonnet-5-20261001", u) == 12.0
    assert ia_cota.custo("modelo-desconhecido", u) == 30.0
