-- =============================================================================
-- Integração com o GPlanSiS|Drawings
--   * integracao_evento: fila de saída (outbox). Gatilhos gravam o estado completo do documento
--     a cada mudança de revisão ou de comentário; o worker entrega ao Drawings com assinatura HMAC.
--   * integracao_nonce: códigos de entrada única (SSO) já usados — impede reutilização.
-- Só documentos com metadata.origem = 'drawings' geram eventos.
-- =============================================================================

CREATE TABLE IF NOT EXISTS integracao_evento (
  id           bigserial PRIMARY KEY,
  tipo         text NOT NULL,
  document_id  uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  payload      jsonb NOT NULL,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  entregue_em  timestamptz,
  tentativas   integer NOT NULL DEFAULT 0,
  proxima_em   timestamptz NOT NULL DEFAULT now(),
  ultimo_erro  text
);
CREATE INDEX IF NOT EXISTS ix_integracao_evento_pendente
  ON integracao_evento (proxima_em, id) WHERE entregue_em IS NULL;

CREATE TABLE IF NOT EXISTS integracao_nonce (
  nonce      text PRIMARY KEY,
  expira_em  timestamptz NOT NULL
);

-- Estado completo de um documento vindo do Drawings: o que o Drawings precisa para o carimbo,
-- a tabela de revisões e as nuvens de comentário. Mandar o estado inteiro torna a entrega idempotente.
CREATE OR REPLACE FUNCTION fn_integracao_estado(p_doc uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'document_id', d.id, 'code', d.code, 'title', d.title,
    'project_id', p.id, 'project_code', p.code, 'project_name', p.name,
    'discipline_code', d.discipline_code, 'doc_type_code', d.doc_type_code,
    'drawing_id', d.metadata->>'drawing_id', 'metadata', d.metadata,
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
BEGIN
  IF EXISTS (SELECT 1 FROM document WHERE id = p_doc AND metadata->>'origem' = 'drawings') THEN
    INSERT INTO integracao_evento (tipo, document_id, payload) VALUES (p_tipo, p_doc, fn_integracao_estado(p_doc));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_integracao_revisao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM fn_integracao_enfileira(NEW.document_id, 'revisao.criada');
  ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.client_return_code IS DISTINCT FROM OLD.client_return_code THEN
    PERFORM fn_integracao_enfileira(NEW.document_id, 'revisao.status');
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS tg_integracao_revisao ON revision;
CREATE TRIGGER tg_integracao_revisao AFTER INSERT OR UPDATE ON revision
  FOR EACH ROW EXECUTE FUNCTION fn_integracao_revisao();

CREATE OR REPLACE FUNCTION fn_integracao_comentario() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM fn_integracao_enfileira((SELECT document_id FROM revision WHERE id = NEW.revision_id),
                                    CASE WHEN TG_OP = 'INSERT' THEN 'comentario.criado' ELSE 'comentario.status' END);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS tg_integracao_comentario ON revision_comment;
CREATE TRIGGER tg_integracao_comentario AFTER INSERT OR UPDATE ON revision_comment
  FOR EACH ROW EXECUTE FUNCTION fn_integracao_comentario();
