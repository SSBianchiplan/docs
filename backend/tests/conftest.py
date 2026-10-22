import os
from collections.abc import AsyncIterator

import asyncpg
import pytest

os.environ.setdefault("APP_ENV", "teste")   # o validador de segredos de produção não vale nos testes
DSN = os.environ.get("TEST_DSN", "postgresql://postgres@localhost:5432/edms_test")
# a API testada (tests/test_seguranca.py) usa o mesmo banco de teste e segredos só de teste
os.environ.setdefault("DATABASE_URL", DSN.replace("postgresql://", "postgresql+asyncpg://", 1))
os.environ.setdefault("JWT_SECRET", "segredo-so-de-teste-" + "x" * 32)
os.environ.setdefault("INTEGRACAO_WRITER_SEGREDO", "segredo-writer-teste")
os.environ.setdefault("INTEGRACAO_DRAWINGS_SEGREDO", "segredo-drawings-teste")


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
