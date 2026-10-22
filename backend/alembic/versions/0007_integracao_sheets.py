"""integração com o GPlanSiS|Sheets: eventos e estado para documentos de origem sheets

Revision ID: 0007
"""
from pathlib import Path

from alembic import op

revision = "0007"
down_revision = "0006"

SQL = Path(__file__).resolve().parents[2] / "app" / "sql" / "0008_integracao_sheets.sql"


def upgrade() -> None:
    raw = op.get_bind().connection.dbapi_connection
    sql = SQL.read_text(encoding="utf-8")
    raw.run_async(lambda c: c.execute(sql))


def downgrade() -> None:
    # volta as funções da 0006 (Drawings e Writer); eventos do Sheets já criados ficam na fila, sem entrega
    raw = op.get_bind().connection.dbapi_connection
    sql = (Path(__file__).resolve().parents[2] / "app" / "sql" / "0007_integracao_writer.sql").read_text(encoding="utf-8")
    raw.run_async(lambda c: c.execute(sql))
