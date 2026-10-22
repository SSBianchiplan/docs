"""Configurações do sistema editáveis pelo painel (tabela system_config).

A chave da Anthropic guardada pelo painel fica cifrada com Fernet. A chave de cifragem vem de CONFIG_SEGREDO;
sem ela, é derivada do JWT_SECRET (funciona, mas trocar o JWT_SECRET exige recolar a chave da IA).
O painel tem prioridade sobre ANTHROPIC_API_KEY / ANTHROPIC_MODEL do .env, que continuam valendo como reserva.
"""
from __future__ import annotations

import base64
import hashlib
import time
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import get_settings
from app.core.db import engine, fetch_one

_CACHE: dict[str, Any] = {"t": 0.0, "v": None}


def fernet() -> tuple[Fernet, str]:
    s = get_settings()
    if s.config_segredo:
        raw = hashlib.sha256(s.config_segredo.encode()).digest()
        origem = "CONFIG_SEGREDO"
    else:
        raw = hashlib.sha256(("config:" + s.jwt_secret).encode()).digest()
        origem = "derivada do JWT_SECRET"
    return Fernet(base64.urlsafe_b64encode(raw)), origem


def cifra(texto: str) -> str:
    return fernet()[0].encrypt(texto.encode()).decode()


def decifra(token: str) -> str | None:
    try:
        return fernet()[0].decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        return None


async def le(conn: AsyncConnection, chave: str) -> dict[str, Any]:
    row = await fetch_one(conn, """SELECT c.value, c.updated_at, u.name AS updated_by
                                     FROM system_config c LEFT JOIN app_user u ON u.id = c.updated_by
                                    WHERE c.id = :k""", k=chave)
    return {**(row["value"] or {}), "_atualizado_em": row["updated_at"], "_atualizado_por": row["updated_by"]} if row else {}


async def ia_config(forcar: bool = False) -> dict[str, Any]:
    """Configuração efetiva da IA (cache de 10 s por processo — API e worker veem a mudança em segundos)."""
    if not forcar and _CACHE["v"] and time.time() - _CACHE["t"] < 10:
        return _CACHE["v"]
    async with engine().connect() as conn:
        v = await le(conn, "ia")
    out = ia_de_valor(v)
    _CACHE.update(t=time.time(), v=out)
    return out


def ia_de_valor(v: dict[str, Any]) -> dict[str, Any]:
    """Configuração efetiva a partir do valor guardado (painel) com o .env como reserva."""
    s = get_settings()
    chave, origem, ilegivel = None, None, False
    if v.get("chave_cifrada"):
        chave = decifra(v["chave_cifrada"])
        origem = "painel" if chave else None
        ilegivel = chave is None
    if not chave and s.anthropic_api_key:
        chave, origem = s.anthropic_api_key, "env"
    ativo = v.get("ativo", True)
    out = {"chave": chave, "origem": origem, "ativo": ativo, "modelo": v.get("modelo") or s.anthropic_model,
           "pronta": bool(chave and ativo), "final": (chave[-4:] if chave else None), "ilegivel": ilegivel,
           "atualizado_em": v.get("_atualizado_em"), "atualizado_por": v.get("_atualizado_por")}
    return out


def invalida() -> None:
    _CACHE["t"] = 0.0
