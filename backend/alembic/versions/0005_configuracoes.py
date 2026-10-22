"""módulo configurações: perfil com avatar (fora da auditoria) e configurações do sistema (auditadas)

Revision ID: 0005
"""
from pathlib import Path

from alembic import op

revision = "0005"
down_revision = "0004"

SQL = Path(__file__).resolve().parents[2] / "app" / "sql" / "0006_configuracoes.sql"


def upgrade() -> None:
    raw = op.get_bind().connection.dbapi_connection
    sql = SQL.read_text(encoding="utf-8")
    raw.run_async(lambda c: c.execute(sql))


def downgrade() -> None:
    raw = op.get_bind().connection.dbapi_connection
    raw.run_async(lambda c: c.execute("""
        DROP TRIGGER IF EXISTS tg_audit_system_config ON system_config;
        DROP TABLE IF EXISTS system_config;
        DROP TABLE IF EXISTS user_profile;
    """))
