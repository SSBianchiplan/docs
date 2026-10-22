"""schema inicial com invariantes (SPEC-GPS-DOCS-001)

Revision ID: 0001
"""
from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None

SQL = Path(__file__).resolve().parents[2] / "app" / "sql"


def upgrade() -> None:
    # asyncpg não aceita vários comandos num prepared statement: usa o protocolo simples do driver
    raw = op.get_bind().connection.dbapi_connection
    for name in ("0001_schema.sql", "0002_seed.sql"):
        sql = (SQL / name).read_text(encoding="utf-8")
        raw.run_async(lambda c, q=sql: c.execute(q))


def downgrade() -> None:
    raw = op.get_bind().connection.dbapi_connection
    raw.run_async(lambda c: c.execute(DOWN))


DOWN = """
        DROP VIEW IF EXISTS v_master_list;
        DROP TABLE IF EXISTS audit_log, ai_suggestion, grd_item, grd, grd_seq, revision_comment,
            workflow_task, workflow_instance, workflow_template_step, workflow_template,
            document_checkout, text_chunk, ocr_page, file_text, revision_file, revision_transition,
            revision, document_seq, document, blob, doc_type, discipline, project_member, project,
            app_user CASCADE;
        DROP FUNCTION IF EXISTS fn_phonetic, fn_actor, fn_document_code_check, fn_document_retention,
            fn_next_doc_seq, fn_revision_transition, fn_revision_file_lock, fn_task_guard, fn_comment_guard,
            fn_revision_cross_rules, fn_grd_item_guard, fn_grd_guard, fn_grd_emitir, fn_ai_guard,
            fn_audit_chain, fn_audit_immutable, fn_audit_row, fn_audit_verify CASCADE;
        DROP TEXT SEARCH CONFIGURATION IF EXISTS pt_unaccent;
"""
