-- =============================================================================
-- Integração com o GPlanSiS|Writer (além do Drawings)
--   * integracao_evento.sistema: cada evento vai para o sistema de origem do documento
--     (metadata.origem = 'drawings' | 'writer'); a fila é entregue em ordem por sistema.
--   * o estado completo ganha writer_doc_id (o id do documento no Writer).
-- Eventos antigos ficam com sistema = 'drawings' (eram todos de lá).
-- =============================================================================

ALTER TABLE integracao_evento ADD COLUMN IF NOT EXISTS sistema text NOT NULL DEFAULT 'drawings';
CREATE INDEX IF NOT EXISTS ix_integracao_evento_sistema_pendente
  ON integracao_evento (sistema, proxima_em, id) WHERE entregue_em IS NULL;

CREATE OR REPLACE FUNCTION fn_integracao_estado(p_doc uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'document_id', d.id, 'code', d.code, 'title', d.title,
    'project_id', p.id, 'project_code', p.code, 'project_name', p.name,
    'discipline_code', d.discipline_code, 'doc_type_code', d.doc_type_code,
    'origem', d.metadata->>'origem',
    'drawing_id', d.metadata->>'drawing_id', 'writer_doc_id', d.metadata->>'writer_doc_id', 'metadata', d.metadata,
    'revision', (SELECT jsonb_build_object('id', r.id, 'label', r.label, 'status', r.status, 'purpose', r.purpose,
                        'client_return_code', r.client_return_code, 'issued_at', r.issued_at)
                   FROM revision r WHERE r.document_id = d.id AND r.is_current),
    'revisions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'label', r.label, 'status', r.status,
                         'purpose', r.purpose, 'description', r.description, 'issued_at', r.issued_at,
                         'created_at', r.created_at, 'author', u.name) ORDER BY r.created_at), '[]'::jsonb)
                    FROM revision r JOIN app_user u ON u.id = r.created_by WHERE r.document_id = d.id),
    'comments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'revision_label', r.label,
                        'page', c.page, 'x', c.x, 'y', c.y, 'w', c.w, 'h', c.h, 'category', c.category,
                        'body', c.body, 'status', c.status, 'resolution', c.resolution, 'author', a.name,
                        'created_at', c.created_at) ORDER BY c.created_at), '[]'::jsonb)
                   FROM revision_comment c JOIN revision r ON r.id = c.revision_id
                   JOIN app_user a ON a.id = c.author_id
                  WHERE r.document_id = d.id AND (r.is_current OR c.status = 'ABERTO'))
  )
  FROM document d JOIN project p ON p.id = d.project_id WHERE d.id = p_doc
$$;

CREATE OR REPLACE FUNCTION fn_integracao_enfileira(p_doc uuid, p_tipo text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_origem text;
BEGIN
  SELECT metadata->>'origem' INTO v_origem FROM document WHERE id = p_doc;
  IF v_origem IN ('drawings', 'writer') THEN
    INSERT INTO integracao_evento (tipo, document_id, payload, sistema)
    VALUES (p_tipo, p_doc, fn_integracao_estado(p_doc), v_origem);
  END IF;
END $$;
