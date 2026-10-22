from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine

from app.core.config import get_settings

_engine: AsyncEngine | None = None


def engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(get_settings().database_url, pool_size=10, max_overflow=10,
                                      pool_pre_ping=True)
    return _engine


async def open_tx(user_id: str | None = None) -> AsyncIterator[AsyncConnection]:
    """Uma transação por requisição. O ator vai para app.user_id (lido pela trilha de auditoria)."""
    async with engine().begin() as conn:
        if user_id:
            await conn.execute(text("SELECT set_config('app.user_id', :u, true)"), {"u": user_id})
        yield conn


async def fetch_all(conn: AsyncConnection, sql: str, **params: Any) -> list[dict[str, Any]]:
    res = await conn.execute(text(sql), params)
    return [dict(r._mapping) for r in res]


async def fetch_one(conn: AsyncConnection, sql: str, **params: Any) -> dict[str, Any] | None:
    res = await conn.execute(text(sql), params)
    row = res.first()
    return dict(row._mapping) if row else None


async def scalar(conn: AsyncConnection, sql: str, **params: Any) -> Any:
    res = await conn.execute(text(sql), params)
    return res.scalar()
