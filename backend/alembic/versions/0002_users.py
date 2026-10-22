"""ciclo de vida da conta: troca obrigatória de senha e último acesso

Revision ID: 0002
"""
from pathlib import Path

from alembic import op

revision = "0002"
down_revision = "0001"

SQL = Path(__file__).resolve().parents[2] / "app" / "sql" / "0003_users.sql"


def upgrade() -> None:
    raw = op.get_bind().connection.dbapi_connection
    sql = SQL.read_text(encoding="utf-8")
    raw.run_async(lambda c: c.execute(sql))


def downgrade() -> None:
    raw = op.get_bind().connection.dbapi_connection
    raw.run_async(lambda c: c.execute("""
        ALTER TABLE app_user DROP COLUMN IF EXISTS must_change_password,
                             DROP COLUMN IF EXISTS last_login_at,
                             DROP COLUMN IF EXISTS password_changed_at;
        DROP TABLE IF EXISTS access_request"""))
