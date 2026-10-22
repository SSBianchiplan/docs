"""Cota mensal de IA por pessoa (US$), no modelo do GPlanSiS|Studio.

Cada chamada à Anthropic grava tokens reais e custo em ia_uso (também quando falha). A cota padrão fica em
system_config['ia'].cota_usd (US$ 20 se ausente) e só o administrador a altera; app_user.ia_cota_usd sobrepõe
a padrão para uma pessoa (NULL = usa a padrão). Ritmo: 30 chamadas por minuto e 3 simultâneas por pessoa,
contadas no banco porque a API roda com vários workers e a chamada em si acontece no worker do arq.
Gasto ≥ cota → 402 na API; no worker, a verificação cai para a heurística (sem custo).
Para o cliente nunca vai detalhe de erro do provedor; o registro guarda só um código curto.
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api.deps import Conn
from app.core import sysconfig
from app.core.db import engine, fetch_all, fetch_one, scalar
from app.core.errors import DomainError
from app.core.security import CurrentUser

log = logging.getLogger(__name__)
router = APIRouter(prefix="/config", tags=["configurações"])

COTA_PADRAO = 20.0
POR_MINUTO = 30
SIMULTANEAS = 3
EM_ANDAMENTO_MAX_MIN = 10          # reserva sem fechamento (processo morto) deixa de contar depois disso
MAX_CORPO = 64 * 1024              # rotas de IA e de cota recebem JSON pequeno

# US$ por milhão de tokens (entrada, saída) — mesma tabela do Studio
PRECOS = {
    "claude-opus-5-5": (4.0, 20.0), "claude-sonnet-5-5": (2.0, 10.0), "claude-haiku-5-5": (0.10, 0.50),
    "claude-opus-5": (5.0, 25.0), "claude-opus-4-8": (5.0, 25.0), "claude-sonnet-5": (2.0, 10.0),
}
PRECO_DESCONHECIDO = (5.0, 25.0)   # conservador


def preco(modelo: str | None) -> tuple[float, float]:
    m = modelo or ""
    if m in PRECOS:
        return PRECOS[m]
    for k in sorted(PRECOS, key=len, reverse=True):
        if m.startswith(k):
            return PRECOS[k]
    return PRECO_DESCONHECIDO


def custo(modelo: str | None, u: Any) -> float:
    if u is None:
        return 0.0
    pin, pout = preco(modelo)
    tin = getattr(u, "input_tokens", 0) or 0
    tout = getattr(u, "output_tokens", 0) or 0
    cw = getattr(u, "cache_creation_input_tokens", 0) or 0
    cr = getattr(u, "cache_read_input_tokens", 0) or 0
    return (tin * pin + cw * pin * 1.25 + cr * pin * 0.1 + tout * pout) / 1e6


def erro_curto(e: BaseException) -> str:
    """Código curto para o registro (nunca a mensagem do provedor)."""
    try:
        import anthropic
        tabela = [(anthropic.AuthenticationError, "auth"), (anthropic.PermissionDeniedError, "permissao"),
                  (anthropic.RateLimitError, "limite"), (anthropic.BadRequestError, "pedido"),
                  (anthropic.APIConnectionError, "conexao")]
        for cls, cod in tabela:
            if isinstance(e, cls):
                return cod
        if isinstance(e, anthropic.APIStatusError):
            return f"status_{e.status_code}"
    except ImportError:
        pass
    return ("interno:" + type(e).__name__)[:60]


# ---------------------------------------------------------------------------- consultas
async def cota_de(conn: Any, user_id: str) -> float:
    ia = await sysconfig.ia_config()
    padrao = float(ia.get("cota_usd", COTA_PADRAO))
    q = await scalar(conn, "SELECT ia_cota_usd FROM app_user WHERE id = CAST(:u AS uuid)", u=user_id)
    return padrao if q is None else float(q)


async def gasto_mes(conn: Any, user_id: str) -> float:
    v = await scalar(conn, """SELECT coalesce(sum(custo_usd), 0) FROM ia_uso
                               WHERE user_id = CAST(:u AS uuid) AND ts >= date_trunc('month', now())""", u=user_id)
    return float(v or 0)


async def _ritmo(conn: Any, user_id: str) -> tuple[int, int]:
    row = await fetch_one(conn, f"""
        SELECT count(*) FILTER (WHERE ts > now() - interval '1 minute') AS minuto,
               count(*) FILTER (WHERE ok IS NULL AND ts > now() - interval '{EM_ANDAMENTO_MAX_MIN} minutes') AS andamento
          FROM ia_uso WHERE user_id = CAST(:u AS uuid) AND ts > now() - interval '{EM_ANDAMENTO_MAX_MIN} minutes'""",
                          u=user_id)
    if not row:
        return 0, 0
    return int(row["minuto"]), int(row["andamento"])


async def verifica(conn: Any, user_id: str) -> None:
    """Na API, antes de enfileirar trabalho de IA: 402 se a cota do mês acabou, 429 se o ritmo passou do limite."""
    gasto, cota = await gasto_mes(conn, user_id), await cota_de(conn, user_id)
    if gasto >= cota:
        raise DomainError(f"Cota de IA do mês atingida (US$ {gasto:.2f} de US$ {cota:.2f}). "
                          "Fale com um administrador.", 402)
    minuto, andamento = await _ritmo(conn, user_id)
    if minuto >= POR_MINUTO or andamento >= SIMULTANEAS:
        raise DomainError("Muitas chamadas de IA seguidas. Aguarde alguns segundos.", 429)


async def reserva(user_id: str | None, recurso: str, ref: str | None = None) -> int | None:
    """No worker, logo antes de chamar a Anthropic. Devolve o id da linha de uso (ok = NULL = em andamento)
    ou None se a cota/ritmo não permitem — nesse caso quem chama usa o caminho sem IA."""
    async with engine().begin() as conn:
        if user_id:
            # serializa as reservas da mesma pessoa entre processos (checagem e gravação atômicas)
            await scalar(conn, "SELECT pg_advisory_xact_lock(hashtext('ia_uso:' || :u))", u=user_id)
            gasto, cota = await gasto_mes(conn, user_id), await cota_de(conn, user_id)
            if gasto >= cota:
                log.info("IA: cota do mês atingida para %s; usando o caminho sem IA", user_id)
                return None
            minuto, andamento = await _ritmo(conn, user_id)
            if minuto >= POR_MINUTO or andamento >= SIMULTANEAS:
                log.info("IA: ritmo acima do limite para %s; usando o caminho sem IA", user_id)
                return None
        row = await fetch_one(conn, """INSERT INTO ia_uso (user_id, recurso, ref) VALUES (CAST(:u AS uuid), :r, :ref)
                                       RETURNING id""", u=user_id, r=recurso, ref=ref)
    return int(row["id"]) if row else None


async def fecha(uso_id: int | None, modelo: str | None, usage: Any, ok: bool, erro: str | None, ms: int) -> float:
    c = custo(modelo, usage)
    if uso_id is None:
        return c
    async with engine().begin() as conn:
        await fetch_one(conn, """
            UPDATE ia_uso SET modelo = :m, input_tokens = :i, output_tokens = :o, cache_read = :cr, cache_write = :cw,
                   custo_usd = :c, ok = :ok, erro = :e, ms = :ms WHERE id = :id RETURNING id""",
            m=(modelo or "")[:80] or None, i=getattr(usage, "input_tokens", 0) or 0,
            o=getattr(usage, "output_tokens", 0) or 0, cr=getattr(usage, "cache_read_input_tokens", 0) or 0,
            cw=getattr(usage, "cache_creation_input_tokens", 0) or 0, c=Decimal(str(round(c, 6))), ok=ok,
            e=(erro or None) and erro[:80], ms=ms, id=uso_id)
    return c


async def registra(user_id: str | None, recurso: str, modelo: str | None, usage: Any, ok: bool,
                   erro: str | None, ms: int) -> float:
    """Registro direto (sem reserva), para chamadas fora da cota — ex.: o teste da chave pelo admin."""
    async with engine().begin() as conn:
        row = await fetch_one(conn, "INSERT INTO ia_uso (user_id, recurso) VALUES (CAST(:u AS uuid), :r) RETURNING id",
                              u=user_id, r=recurso)
    return await fecha(int(row["id"]) if row else None, modelo, usage, ok, erro, ms)


# ---------------------------------------------------------------------------- limite do corpo
class LimiteCorpoIA:
    """413 para corpos grandes nas rotas de IA/cota, antes de o JSON ser lido para a memória."""

    def __init__(self, app: ASGIApp, limite: int = MAX_CORPO) -> None:
        self.app, self.limite = app, limite

    def _alvo(self, path: str) -> bool:
        return path.startswith("/api/config/ia") or (path.startswith("/api/revisions/") and path.endswith("/check-comments"))

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") in ("GET", "HEAD") or not self._alvo(scope.get("path", "")):
            await self.app(scope, receive, send)
            return
        cl = dict(scope.get("headers") or []).get(b"content-length", b"")
        if cl.isdigit() and int(cl) > self.limite:
            await _413(send)
            return
        corpo = bytearray()
        mais = True
        while mais:
            msg = await receive()
            if msg["type"] != "http.request":
                break
            corpo += msg.get("body", b"")
            if len(corpo) > self.limite:
                await _413(send)
                return
            mais = msg.get("more_body", False)
        entregue = False

        async def recebe() -> Message:
            nonlocal entregue
            if not entregue:
                entregue = True
                return {"type": "http.request", "body": bytes(corpo), "more_body": False}
            return await receive()

        await self.app(scope, recebe, send)


async def _413(send: Send) -> None:
    body = b'{"detail":"Pedido grande demais para a IA."}'
    await send({"type": "http.response.start", "status": 413,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
    await send({"type": "http.response.body", "body": body})


# ---------------------------------------------------------------------------- rotas
def _admin(user: CurrentUser) -> None:
    if not user.is_admin:
        raise DomainError("Somente administradores", 403)


class CotaIn(BaseModel):
    cota_usd: float = Field(ge=0, le=10000)


class CotaUsuarioIn(BaseModel):
    cota_usd: float | None = Field(default=None, ge=0, le=10000)   # None = volta à cota padrão


@router.get("/ia/uso")
async def uso(conn: Conn, user: CurrentUser) -> dict[str, Any]:
    """A pessoa vê o próprio gasto; o administrador vê também o de todos no mês."""
    ia = await sysconfig.ia_config()
    out: dict[str, Any] = {"cota_padrao_usd": float(ia.get("cota_usd", COTA_PADRAO)),
                           "gasto_usd": round(await gasto_mes(conn, user.id), 4),
                           "cota_usd": await cota_de(conn, user.id)}
    if user.is_admin:
        out["por_usuario"] = await fetch_all(conn, """
            SELECT u.id::text, u.name, u.ia_cota_usd, count(a.id) AS chamadas, coalesce(sum(a.custo_usd), 0) AS gasto_usd,
                   coalesce(sum(a.input_tokens), 0) AS tokens_entrada, coalesce(sum(a.output_tokens), 0) AS tokens_saida
              FROM app_user u LEFT JOIN ia_uso a ON a.user_id = u.id AND a.ts >= date_trunc('month', now())
             GROUP BY u.id ORDER BY gasto_usd DESC, u.name LIMIT 500""")
    return out


@router.put("/ia/cota")
async def define_cota_padrao(body: CotaIn, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    _admin(user)
    import json
    atual = await sysconfig.le(conn, "ia")
    valor = {k: v for k, v in atual.items() if not k.startswith("_")}
    valor["cota_usd"] = round(body.cota_usd, 2)
    await fetch_one(conn, """INSERT INTO system_config (id, value, updated_by) VALUES ('ia', CAST(:v AS jsonb), CAST(:u AS uuid))
                             ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by
                             RETURNING id""", v=json.dumps(valor), u=user.id)
    sysconfig.invalida()
    return {"cota_padrao_usd": valor["cota_usd"]}


@router.put("/ia/cota/usuarios/{user_id}")
async def define_cota_usuario(user_id: str, body: CotaUsuarioIn, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    _admin(user)
    row = await fetch_one(conn, """UPDATE app_user SET ia_cota_usd = :q WHERE id = CAST(:u AS uuid)
                                   RETURNING id::text, ia_cota_usd""",
                          q=None if body.cota_usd is None else Decimal(str(round(body.cota_usd, 2))), u=user_id)
    if not row:
        raise DomainError("Usuário não encontrado", 404)
    return {"id": row["id"], "cota_usd": None if row["ia_cota_usd"] is None else float(row["ia_cota_usd"])}
