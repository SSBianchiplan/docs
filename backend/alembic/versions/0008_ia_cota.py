"""cota mensal de IA por pessoa: app_user.ia_cota_usd e tabela ia_uso (idempotente)

Revision ID: 0008
"""
from pathlib import Path

from alembic import op

revision = "0008"
down_revision = "0007"

SQL = Path(__file__).resolve().parents[2] / "app" / "sql" / "0009_ia_cota.sql"


def upgrade() -> None:
    raw = op.get_bind().connection.dbapi_connection
    sql = SQL.read_text(encoding="utf-8")
    raw.run_async(lambda c: c.execute(sql))


def downgrade() -> None:
    raw = op.get_bind().connection.dbapi_connection
    raw.run_async(lambda c: c.execute("""
        DROP TABLE IF EXISTS ia_uso;
        ALTER TABLE app_user DROP COLUMN IF EXISTS ia_cota_usd;
    """))
