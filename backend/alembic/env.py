"""Migrations SQL-first: o DDL (com as invariantes) vive em app/sql/*.sql."""
import asyncio

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings


def run(conn) -> None:  # type: ignore[no-untyped-def]
    context.configure(connection=conn, target_metadata=None, transaction_per_migration=True)
    with context.begin_transaction():
        context.run_migrations()


async def main() -> None:
    eng = create_async_engine(get_settings().database_url)
    async with eng.connect() as conn:
        await conn.run_sync(run)
        await conn.commit()
    await eng.dispose()


asyncio.run(main())
