import os
from collections.abc import AsyncIterator

import asyncpg
import pytest

DSN = os.environ.get("TEST_DSN", "postgresql://postgres@localhost:5432/edms_test")


@pytest.fixture
async def db() -> AsyncIterator[asyncpg.Connection]:
    """Conexão direta ao banco, dentro de transação desfeita ao final (RED-TEAM sem sujar o banco)."""
    try:
        conn = await asyncpg.connect(DSN)
    except (OSError, asyncpg.PostgresError) as e:
        pytest.skip(f"Postgres de teste indisponível: {e}")
    tx = conn.transaction()
    await tx.start()
    try:
        yield conn
    finally:
        await tx.rollback()
        await conn.close()
