"""RED-TEAM: cada teste TENTA violar uma invariante direto no banco.
Se o comando passar, a invariante não existe — só a intenção dela."""
import asyncpg
import pytest

pytestmark = pytest.mark.asyncio


async def violates(db: asyncpg.Connection, sql: str, *args: object, match: str = "") -> str:
    with pytest.raises(asyncpg.PostgresError) as ei:
        async with db.transaction():  # savepoint: a falha desfaz só a tentativa
            await db.execute(sql, *args)
    msg = str(ei.value)
    assert match in msg, msg
    return msg


async def world(db: asyncpg.Connection) -> dict[str, str]:
    u = await db.fetchval("INSERT INTO app_user (email, name, password_hash) VALUES ('autor@t', 'Autor', 'x') RETURNING id")
    rv = await db.fetchval("INSERT INTO app_user (email, name, password_hash) VALUES ('rev@t', 'Revisor', 'x') RETURNING id")
    p = await db.fetchval("INSERT INTO project (code, name) VALUES ('P100', 'Projeto teste') RETURNING id")
    d = await db.fetchval("""INSERT INTO document (project_id, code, title, discipline_code, doc_type_code, created_by)
                             VALUES ($1, 'P100-MEC-DE-0001', 'Arranjo geral', 'MEC', 'DE', $2) RETURNING id""", p, u)
    r = await db.fetchval("INSERT INTO revision (document_id, label, created_by) VALUES ($1, 'A', $2) RETURNING id", d, u)
    await db.execute("""INSERT INTO blob (sha256, size_bytes, mime, storage_key)
                        VALUES (repeat('a', 64), 10, 'application/pdf', 'k1')""")
    return {"u": str(u), "rv": str(rv), "p": str(p), "d": str(d), "r": str(r)}


async def add_pdf(db: asyncpg.Connection, w: dict[str, str]) -> None:
    await db.execute("""INSERT INTO revision_file (revision_id, blob_sha256, role, filename, created_by)
                        VALUES ($1, repeat('a', 64), 'PDF', 'a.pdf', $2)""", w["r"], w["u"])


async def approve_via_workflow(db: asyncpg.Connection, w: dict[str, str]) -> None:
    wi = await db.fetchval("""INSERT INTO workflow_instance (revision_id, template_id, started_by)
                              VALUES ($1, '00000000-0000-0000-0000-00000000f001', $2) RETURNING id""", w["r"], w["u"])
    await db.execute("UPDATE revision SET status = 'EM_VERIFICACAO' WHERE id = $1", w["r"])
    await db.execute("UPDATE workflow_instance SET status = 'CONCLUIDO', finished_at = now() WHERE id = $1", wi)
    await db.execute("UPDATE revision SET status = 'APROVADA_INTERNA' WHERE id = $1", w["r"])


async def test_inv_doc_001_codigo_unico(db: asyncpg.Connection) -> None:
    w = await world(db)
    await violates(db, """INSERT INTO document (project_id, code, title, discipline_code, doc_type_code, created_by)
                          VALUES ($1, 'P100-MEC-DE-0001', 'Duplicado', 'MEC', 'DE', $2)""", w["p"], w["u"],
                   match="uq_document_code")


async def test_inv_doc_002_codificacao(db: asyncpg.Connection) -> None:
    w = await world(db)
    await violates(db, """INSERT INTO document (project_id, code, title, discipline_code, doc_type_code, created_by)
                          VALUES ($1, 'qualquer-coisa', 'Fora da máscara', 'MEC', 'DE', $2)""", w["p"], w["u"],
                   match="INV-DOC-002")


async def test_inv_rev_005_nasce_em_elaboracao(db: asyncpg.Connection) -> None:
    w = await world(db)
    await violates(db, """INSERT INTO revision (document_id, label, status, created_by, is_current)
                          VALUES ($1, 'B', 'APROVADA', $2, false)""", w["d"], w["u"], match="INV-REV-005")


async def test_inv_rev_005_transicao_invalida(db: asyncpg.Connection) -> None:
    w = await world(db)
    await violates(db, "UPDATE revision SET status = 'APROVADA' WHERE id = $1", w["r"], match="INV-REV-005")


async def test_inv_rev_002_e_009_uma_vigente_e_uma_aberta(db: asyncpg.Connection) -> None:
    w = await world(db)
    await violates(db, "INSERT INTO revision (document_id, label, created_by) VALUES ($1, 'B', $2)",
                   w["d"], w["u"])


async def test_inv_rev_006_aprovacao_sem_workflow(db: asyncpg.Connection) -> None:
    w = await world(db)
    await violates(db, "UPDATE revision SET status = 'APROVADA_INTERNA' WHERE id = $1", w["r"], match="INV-REV-006")


async def test_inv_rev_004_emitir_sem_pdf(db: asyncpg.Connection) -> None:
    w = await world(db)
    await approve_via_workflow(db, w)
    await violates(db, "UPDATE revision SET status = 'EMITIDA', issued_at = now(), purpose = 'PA' WHERE id = $1",
                   w["r"], match="INV-REV-004")


async def test_inv_rev_003_arquivo_congelado(db: asyncpg.Connection) -> None:
    w = await world(db)
    await add_pdf(db, w)
    await approve_via_workflow(db, w)
    await violates(db, "DELETE FROM revision_file WHERE revision_id = $1", w["r"], match="INV-REV-003")


async def test_inv_chk_001_checkout_duplo(db: asyncpg.Connection) -> None:
    w = await world(db)
    await db.execute("INSERT INTO document_checkout (document_id, user_id) VALUES ($1, $2)", w["d"], w["u"])
    await violates(db, "INSERT INTO document_checkout (document_id, user_id) VALUES ($1, $2)", w["d"], w["rv"],
                   match="uq_checkout_active")


async def test_inv_wf_003_autor_nao_aprova(db: asyncpg.Connection) -> None:
    w = await world(db)
    wi = await db.fetchval("""INSERT INTO workflow_instance (revision_id, template_id, started_by)
                              VALUES ($1, '00000000-0000-0000-0000-00000000f001', $2) RETURNING id""", w["r"], w["u"])
    t = await db.fetchval("""INSERT INTO workflow_task (instance_id, step_order, step_name, assignee_id, due_at)
                             VALUES ($1, 1, 'Verificação', $2, now()) RETURNING id""", wi, w["u"])
    await violates(db, "UPDATE workflow_task SET status='APROVADA', decided_by=$2, decided_at=now() WHERE id=$1",
                   t, w["u"], match="INV-WF-003")


async def test_inv_wf_001_002_decisao(db: asyncpg.Connection) -> None:
    w = await world(db)
    wi = await db.fetchval("""INSERT INTO workflow_instance (revision_id, template_id, started_by)
                              VALUES ($1, '00000000-0000-0000-0000-00000000f001', $2) RETURNING id""", w["r"], w["u"])
    t = await db.fetchval("""INSERT INTO workflow_task (instance_id, step_order, step_name, assignee_id, due_at)
                             VALUES ($1, 1, 'Verificação', $2, now()) RETURNING id""", wi, w["rv"])
    # reprovação sem justificativa
    await violates(db, "UPDATE workflow_task SET status='REPROVADA', decided_by=$2, decided_at=now() WHERE id=$1",
                   t, w["rv"], match="ck_task_decided")
    # terceiro (nem autor, nem responsável) decidindo
    x = await db.fetchval("INSERT INTO app_user (email, name, password_hash) VALUES ('x@t', 'Terceiro', 'x') RETURNING id")
    await violates(db, "UPDATE workflow_task SET status='APROVADA', decided_by=$2, decided_at=now() WHERE id=$1",
                   t, x, match="ck_task_assignee")
    await db.execute("UPDATE workflow_task SET status='APROVADA', decided_by=$2, decided_at=now() WHERE id=$1", t, w["rv"])
    await violates(db, "UPDATE workflow_task SET status='REPROVADA', decision_note='mudei de ideia' WHERE id=$1",
                   t, match="INV-WF-004")


async def test_inv_rev_007_comentario_obrigatorio_aberto(db: asyncpg.Connection) -> None:
    w = await world(db)
    await add_pdf(db, w)
    await approve_via_workflow(db, w)
    await db.execute("""INSERT INTO revision_comment (revision_id, author_id, category, body)
                        VALUES ($1, $2, 'OBRIGATORIO', 'Corrigir cota do bocal N3')""", w["r"], w["rv"])
    g = await db.fetchval("""INSERT INTO grd (project_id, recipient, purpose, created_by)
                             VALUES ($1, 'Cliente', 'PA', $2) RETURNING id""", w["p"], w["u"])
    await db.execute("INSERT INTO grd_item (grd_id, revision_id) VALUES ($1, $2)", g, w["r"])
    await db.fetchval("SELECT fn_grd_emitir($1, $2)", g, w["u"])
    await db.execute("UPDATE revision SET status='REPROVADA', client_return_code='C', client_returned_at=now() WHERE id=$1", w["r"])
    await db.execute("UPDATE revision SET is_current = false WHERE id = $1", w["r"])
    await db.execute("UPDATE revision SET status = 'SUPERADA' WHERE id = $1", w["r"])
    r2 = await db.fetchval("INSERT INTO revision (document_id, label, created_by) VALUES ($1, 'B', $2) RETURNING id",
                           w["d"], w["u"])
    await db.execute("""INSERT INTO workflow_instance (revision_id, template_id, started_by, status, finished_at)
                        VALUES ($1, '00000000-0000-0000-0000-00000000f001', $2, 'CONCLUIDO', now())""", r2, w["u"])
    await db.execute("UPDATE revision SET status = 'EM_VERIFICACAO' WHERE id = $1", r2)
    await violates(db, "UPDATE revision SET status = 'APROVADA_INTERNA' WHERE id = $1", r2, match="INV-REV-007")


async def test_inv_grd_emissao_e_imutabilidade(db: asyncpg.Connection) -> None:
    w = await world(db)
    g = await db.fetchval("""INSERT INTO grd (project_id, recipient, purpose, created_by)
                             VALUES ($1, 'Cliente', 'PA', $2) RETURNING id""", w["p"], w["u"])
    await violates(db, "SELECT fn_grd_emitir($1, $2)", g, w["u"], match="INV-GRD-004")
    await violates(db, "INSERT INTO grd_item (grd_id, revision_id) VALUES ($1, $2)", g, w["r"], match="INV-GRD-003")
    await add_pdf(db, w)
    await approve_via_workflow(db, w)
    await db.execute("INSERT INTO grd_item (grd_id, revision_id) VALUES ($1, $2)", g, w["r"])
    n = await db.fetchval("SELECT fn_grd_emitir($1, $2)", g, w["u"])
    assert n == 1
    assert await db.fetchval("SELECT status FROM revision WHERE id = $1", w["r"]) == "EMITIDA"
    await violates(db, "DELETE FROM grd_item WHERE grd_id = $1", g, match="INV-GRD-002")
    await violates(db, "UPDATE grd SET recipient = 'Outro' WHERE id = $1", g, match="INV-GRD-002")
    await violates(db, "UPDATE grd SET status = 'RASCUNHO', number = NULL WHERE id = $1", g)


async def test_inv_ai_001_humano_decide(db: asyncpg.Connection) -> None:
    w = await world(db)
    s = await db.fetchval("""INSERT INTO ai_suggestion (kind, target_type, target_id, payload, engine)
                             VALUES ('METADADOS_CARIMBO', 'document', $1, '{"title":"X"}', 'teste') RETURNING id""", w["d"])
    await violates(db, "UPDATE ai_suggestion SET status = 'APLICADA' WHERE id = $1", s, match="ck_ai_human_gate")
    await violates(db, """INSERT INTO ai_suggestion (kind, target_type, target_id, payload, engine, status)
                          VALUES ('CLASSIFICACAO', 'document', $1, '{}', 'teste', 'APLICADA')""", w["d"],
                   match="ck_ai_human_gate")
    await violates(db, "UPDATE ai_suggestion SET payload = '{\"title\":\"Y\"}' WHERE id = $1", s, match="INV-AI-002")


async def test_inv_aud_001_append_only_e_cadeia(db: asyncpg.Connection) -> None:
    await world(db)
    n = await db.fetchval("SELECT count(*) FROM audit_log")
    assert n >= 4
    await violates(db, "UPDATE audit_log SET action = 'x' WHERE id = (SELECT max(id) FROM audit_log)", match="INV-AUD-001")
    await violates(db, "DELETE FROM audit_log", match="INV-AUD-001")
    assert await db.fetch("SELECT * FROM fn_audit_verify()") == []


async def test_inv_ret_001_retencao(db: asyncpg.Connection) -> None:
    w = await world(db)
    await db.execute("UPDATE document SET retention_until = current_date + 30 WHERE id = $1", w["d"])
    await violates(db, "DELETE FROM document WHERE id = $1", w["d"], match="INV-RET-001")


async def test_inv_cmt_001_retangulo_fora_da_pagina(db: asyncpg.Connection) -> None:
    w = await world(db)
    await violates(db, """INSERT INTO revision_comment (revision_id, author_id, page, x, y, w, h, body)
                          VALUES ($1, $2, 1, 0.9, 0.9, 0.2, 0.2, 'fora')""", w["r"], w["u"], match="ck_comment_rect")


async def test_busca_fonetica_e_fts(db: asyncpg.Connection) -> None:
    w = await world(db)
    hit = await db.fetchval("SELECT title_phonetic % fn_phonetic('aranjo jeral') FROM document WHERE id = $1", w["d"])
    assert hit is True
    await add_pdf(db, w)
    f = await db.fetchval("SELECT id FROM revision_file WHERE revision_id = $1", w["r"])
    await db.execute("""INSERT INTO file_text (file_id, content) VALUES ($1, 'Válvula de segurança do vaso de pressão')""", f)
    ok = await db.fetchval("SELECT tsv @@ websearch_to_tsquery('pt_unaccent', 'valvulas seguranca') FROM file_text WHERE file_id=$1", f)
    assert ok is True
