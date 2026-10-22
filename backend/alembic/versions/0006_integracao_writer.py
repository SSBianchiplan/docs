"""integração com o GPlanSiS|Writer: fila de eventos por sistema e gatilhos para origem drawings ou writer

Revision ID: 0006
"""
from pathlib import Path

from alembic import op

revision = "0006"
down_revision = "0005"

SQL = Path(__file__).resolve().parents[2] / "app" / "sql" / "0007_integracao_writer.sql"


def upgrade() -> None:
    raw = op.get_bind().connection.dbapi_connection
    sql = SQL.read_text(encoding="utf-8")
    raw.run_async(lambda c: c.execute(sql))


def downgrade() -> None:
    # volta a função de enfileirar só para o Drawings (a de 0005_integracao.sql) e descarta a coluna
    raw = op.get_bind().connection.dbapi_connection
    sql = (Path(__file__).resolve().parents[2] / "app" / "sql" / "0005_integracao.sql").read_text(encoding="utf-8")
    raw.run_async(lambda c: c.execute(sql + """
        DROP INDEX IF EXISTS ix_integracao_evento_sistema_pendente;
        ALTER TABLE integracao_evento DROP COLUMN IF EXISTS sistema;
    """))
