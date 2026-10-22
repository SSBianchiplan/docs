"""integração com o GPlanSiS|Drawings: fila de eventos, nonces de SSO e gatilhos

Revision ID: 0004
"""
from pathlib import Path

from alembic import op

revision = "0004"
down_revision = "0003"

SQL = Path(__file__).resolve().parents[2] / "app" / "sql" / "0005_integracao.sql"


def upgrade() -> None:
    raw = op.get_bind().connection.dbapi_connection
    sql = SQL.read_text(encoding="utf-8")
    raw.run_async(lambda c: c.execute(sql))


def downgrade() -> None:
    raw = op.get_bind().connection.dbapi_connection
    raw.run_async(lambda c: c.execute("""
        DROP TRIGGER IF EXISTS tg_integracao_comentario ON revision_comment;
        DROP TRIGGER IF EXISTS tg_integracao_revisao ON revision;
        DROP FUNCTION IF EXISTS fn_integracao_comentario();
        DROP FUNCTION IF EXISTS fn_integracao_revisao();
        DROP FUNCTION IF EXISTS fn_integracao_enfileira(uuid, text);
        DROP FUNCTION IF EXISTS fn_integracao_estado(uuid);
        DROP TABLE IF EXISTS integracao_nonce;
        DROP TABLE IF EXISTS integracao_evento;
    """))
