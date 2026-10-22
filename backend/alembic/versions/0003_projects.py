"""projeto avançado: prazos, áreas, disciplinas habilitadas, planejamento de emissão

Revision ID: 0003
"""
from pathlib import Path

from alembic import op

revision = "0003"
down_revision = "0002"

SQL = Path(__file__).resolve().parents[2] / "app" / "sql" / "0004_projects.sql"


def upgrade() -> None:
    raw = op.get_bind().connection.dbapi_connection
    sql = SQL.read_text(encoding="utf-8")
    raw.run_async(lambda c: c.execute(sql))


def downgrade() -> None:
    raw = op.get_bind().connection.dbapi_connection
    raw.run_async(lambda c: c.execute("""
        DROP TRIGGER IF EXISTS tg_document_project_rules ON document;
        DROP FUNCTION IF EXISTS fn_document_project_rules();
        DROP VIEW IF EXISTS v_master_list;
        CREATE VIEW v_master_list AS
        SELECT d.id, d.project_id, p.code AS project_code, d.code, d.title, d.discipline_code, d.doc_type_code,
               d.area, d.originator, d.confidentiality, d.tags, d.created_at, d.updated_at,
               r.id AS revision_id, r.label AS revision_label, r.status AS revision_status, r.purpose,
               r.issued_at, r.client_return_code,
               (SELECT count(*) FROM revision_comment c WHERE c.revision_id = r.id AND c.status = 'ABERTO') AS open_comments,
               co.user_id AS checked_out_by
          FROM document d JOIN project p ON p.id = d.project_id
          LEFT JOIN revision r ON r.document_id = d.id AND r.is_current
          LEFT JOIN document_checkout co ON co.document_id = d.id AND co.checked_in_at IS NULL;
        DROP TABLE IF EXISTS project_area, project_discipline;
        ALTER TABLE document DROP COLUMN IF EXISTS planned_issue_date, DROP COLUMN IF EXISTS weight;
        ALTER TABLE project DROP COLUMN IF EXISTS description, DROP COLUMN IF EXISTS contract,
          DROP COLUMN IF EXISTS location, DROP COLUMN IF EXISTS start_date, DROP COLUMN IF EXISTS end_date,
          DROP COLUMN IF EXISTS revision_scheme, DROP COLUMN IF EXISTS default_confidentiality,
          DROP COLUMN IF EXISTS retention_years, DROP COLUMN IF EXISTS default_template_id,
          DROP COLUMN IF EXISTS created_by;"""))
