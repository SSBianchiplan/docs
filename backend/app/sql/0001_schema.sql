-- =============================================================================
-- GPlanSiS|DOCS — EDMS (gestão de documentos técnicos de engenharia)
-- SPEC-GPS-DOCS-001 · migration 0001 · PostgreSQL 16 + pgvector
-- Regra da casa (P1): a verdade mora no banco. Toda invariante INV-* abaixo
-- é materializada como CHECK, UNIQUE parcial, EXCLUDE ou trigger.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE EXTENSION IF NOT EXISTS vector;

-- Configuração de busca textual PT-BR sem acento (OCR costuma perder acentos)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'pt_unaccent') THEN
    CREATE TEXT SEARCH CONFIGURATION pt_unaccent (COPY = portuguese);
    ALTER TEXT SEARCH CONFIGURATION pt_unaccent
      ALTER MAPPING FOR hword, hword_part, word WITH unaccent, portuguese_stem;
  END IF;
END $$;

-- Chave fonética (Double Metaphone) por palavra — "busca fonética"
CREATE OR REPLACE FUNCTION fn_phonetic(txt text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(string_agg(dmetaphone(w), ' ' ORDER BY ord), '')
  FROM regexp_split_to_table(lower(coalesce(txt, '')), '[^[:alnum:]]+') WITH ORDINALITY AS t(w, ord)
  WHERE length(w) > 2
$$;

-- Ator da transação (a API executa SET LOCAL app.user_id = '<uuid>')
CREATE OR REPLACE FUNCTION fn_actor() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- =============================================================================
-- Identidade e acesso
-- =============================================================================
CREATE TABLE app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  name          text   NOT NULL CHECK (length(trim(name)) >= 2),
  company       text,
  password_hash text   NOT NULL,
  is_admin      boolean NOT NULL DEFAULT false,
  is_external   boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{2,12}$'),
  name          text NOT NULL,
  client        text,
  -- máscara de codificação: tokens {PROJ} {DISC} {TIPO} {AREA} {SEQ:n}
  code_mask     text NOT NULL DEFAULT '{PROJ}-{DISC}-{TIPO}-{SEQ:4}',
  -- regex derivada da máscara, usada pela INV-DOC-002
  code_regex    text NOT NULL DEFAULT '^[A-Z0-9]{2,12}-[A-Z0-9]{1,4}-[A-Z0-9]{2,4}-[0-9]{4}$',
  require_workflow boolean NOT NULL DEFAULT true,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_member (
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('ADMIN','CONTROLADOR','AUTOR','REVISOR','LEITOR','EXTERNO')),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE discipline (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{1,4}$'),
  name text NOT NULL
);

CREATE TABLE doc_type (
  code            text PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{2,4}$'),
  name            text NOT NULL,
  metadata_schema jsonb NOT NULL DEFAULT '{}'::jsonb   -- JSON Schema dos metadados customizados
);

-- =============================================================================
-- Armazenamento: blobs endereçados por conteúdo (SHA-256) no MinIO/S3
-- =============================================================================
CREATE TABLE blob (
  sha256      char(64) PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),   -- INV-FILE-001
  size_bytes  bigint NOT NULL CHECK (size_bytes > 0),
  mime        text   NOT NULL,
  storage_key text   NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- Documento (Lista Mestra) e revisões
-- =============================================================================
CREATE TABLE document (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id),
  code            text NOT NULL,
  title           text NOT NULL CHECK (length(trim(title)) >= 3),
  discipline_code text NOT NULL REFERENCES discipline(code),
  doc_type_code   text NOT NULL REFERENCES doc_type(code),
  area            text,
  originator      text,                                   -- empresa emissora
  confidentiality text NOT NULL DEFAULT 'INTERNO'
                  CHECK (confidentiality IN ('PUBLICO','INTERNO','CONFIDENCIAL','RESTRITO')),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  tags            text[] NOT NULL DEFAULT '{}',
  retention_until date,
  created_by      uuid NOT NULL REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  title_phonetic  text GENERATED ALWAYS AS (fn_phonetic(title)) STORED,
  CONSTRAINT uq_document_code UNIQUE (project_id, code)                 -- INV-DOC-001
);
COMMENT ON CONSTRAINT uq_document_code ON document IS
  'INV-DOC-001: código do documento DEVE ser único por projeto';
CREATE INDEX ix_document_title_trgm ON document USING gin (title gin_trgm_ops);
CREATE INDEX ix_document_code_trgm  ON document USING gin (code gin_trgm_ops);
CREATE INDEX ix_document_phonetic   ON document USING gin (title_phonetic gin_trgm_ops);
CREATE INDEX ix_document_tags       ON document USING gin (tags);
CREATE INDEX ix_document_meta       ON document USING gin (metadata jsonb_path_ops);

-- INV-DOC-002: código DEVE obedecer à regex de codificação do projeto
CREATE OR REPLACE FUNCTION fn_document_code_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rx text;
BEGIN
  SELECT code_regex INTO rx FROM project WHERE id = NEW.project_id;
  IF NEW.code !~ rx THEN
    RAISE EXCEPTION 'INV-DOC-002: código % não obedece à codificação do projeto (%)', NEW.code, rx
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER tg_document_code BEFORE INSERT OR UPDATE OF code, project_id, title, metadata, tags
  ON document FOR EACH ROW EXECUTE FUNCTION fn_document_code_check();

-- INV-RET-001: documento sob retenção NÃO PODE ser excluído
CREATE OR REPLACE FUNCTION fn_document_retention() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.retention_until IS NOT NULL AND OLD.retention_until >= current_date THEN
    RAISE EXCEPTION 'INV-RET-001: documento % sob retenção até %', OLD.code, OLD.retention_until
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER tg_document_retention BEFORE DELETE ON document
  FOR EACH ROW EXECUTE FUNCTION fn_document_retention();

-- Sequencial de numeração por (projeto, disciplina, tipo) — sem lacuna, sem corrida
CREATE TABLE document_seq (
  project_id      uuid NOT NULL REFERENCES project(id),
  discipline_code text NOT NULL,
  doc_type_code   text NOT NULL,
  last_value      integer NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  PRIMARY KEY (project_id, discipline_code, doc_type_code)
);
CREATE OR REPLACE FUNCTION fn_next_doc_seq(p uuid, d text, t text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
  INSERT INTO document_seq (project_id, discipline_code, doc_type_code, last_value)
  VALUES (p, d, t, 1)
  ON CONFLICT (project_id, discipline_code, doc_type_code)
  DO UPDATE SET last_value = document_seq.last_value + 1
  RETURNING last_value INTO v;
  RETURN v;
END $$;

CREATE TABLE revision (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  label        text NOT NULL CHECK (label ~ '^([0-9]{1,2}|[A-Z]{1,2})$'),
  status       text NOT NULL DEFAULT 'EM_ELABORACAO' CHECK (status IN (
                 'EM_ELABORACAO','EM_VERIFICACAO','APROVADA_INTERNA','EMITIDA',
                 'APROVADA','APROVADA_COM_COMENTARIOS','REPROVADA','SUPERADA','CANCELADA')),
  purpose      text CHECK (purpose IN ('PI','PA','PC','CE','CA')),  -- finalidade de emissão
  description  text,
  is_current   boolean NOT NULL DEFAULT true,
  created_by   uuid NOT NULL REFERENCES app_user(id),
  -- clock_timestamp: ordena revisões criadas na mesma transação (INV-REV-007 depende da ordem)
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  issued_at    timestamptz,
  client_return_code text CHECK (client_return_code IN ('A','B','C','D')),
  client_returned_at timestamptz,
  CONSTRAINT uq_revision_label UNIQUE (document_id, label),               -- INV-REV-001
  -- INV-REV-004 (parte local): emitida ou posterior DEVE ter data e finalidade
  CONSTRAINT ck_revision_issued CHECK (
    status IN ('EM_ELABORACAO','EM_VERIFICACAO','APROVADA_INTERNA','CANCELADA')
    OR (issued_at IS NOT NULL AND purpose IS NOT NULL)),
  -- retorno do cliente só existe após emissão
  CONSTRAINT ck_revision_return CHECK (
    (client_return_code IS NULL) = (client_returned_at IS NULL)
    AND (client_return_code IS NULL OR status IN
         ('APROVADA','APROVADA_COM_COMENTARIOS','REPROVADA','SUPERADA')))
);
-- INV-REV-002: no máximo uma revisão vigente por documento
CREATE UNIQUE INDEX uq_revision_current ON revision (document_id) WHERE is_current;
CREATE INDEX ix_revision_status ON revision (status);
-- INV-REV-009: no máximo uma revisão em andamento (não emitida) por documento
CREATE UNIQUE INDEX uq_revision_open ON revision (document_id)
  WHERE status IN ('EM_ELABORACAO','EM_VERIFICACAO','APROVADA_INTERNA');

-- INV-REV-005: máquina de estados da revisão
CREATE TABLE revision_transition (
  from_status text NOT NULL,
  to_status   text NOT NULL,
  PRIMARY KEY (from_status, to_status)
);
INSERT INTO revision_transition VALUES
  ('EM_ELABORACAO','EM_VERIFICACAO'),
  ('EM_ELABORACAO','APROVADA_INTERNA'),          -- só se o projeto não exigir workflow (INV-REV-006)
  ('EM_VERIFICACAO','EM_ELABORACAO'),
  ('EM_VERIFICACAO','APROVADA_INTERNA'),
  ('APROVADA_INTERNA','EMITIDA'),
  ('EMITIDA','APROVADA'),
  ('EMITIDA','APROVADA_COM_COMENTARIOS'),
  ('EMITIDA','REPROVADA'),
  ('APROVADA','SUPERADA'),
  ('APROVADA_COM_COMENTARIOS','SUPERADA'),
  ('REPROVADA','SUPERADA'),
  ('EMITIDA','SUPERADA'),
  ('EM_ELABORACAO','CANCELADA'),
  ('EM_VERIFICACAO','CANCELADA'),
  ('APROVADA_INTERNA','CANCELADA');

CREATE OR REPLACE FUNCTION fn_revision_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'EM_ELABORACAO' THEN
      RAISE EXCEPTION 'INV-REV-005: revisão nasce em EM_ELABORACAO (recebido %)', NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT EXISTS (
       SELECT 1 FROM revision_transition WHERE from_status = OLD.status AND to_status = NEW.status) THEN
    RAISE EXCEPTION 'INV-REV-005: transição % -> % não permitida', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.label <> OLD.label OR NEW.document_id <> OLD.document_id THEN
    RAISE EXCEPTION 'INV-REV-001: rótulo e documento da revisão são imutáveis'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_revision_transition BEFORE INSERT OR UPDATE ON revision
  FOR EACH ROW EXECUTE FUNCTION fn_revision_transition();

CREATE TABLE revision_file (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  blob_sha256 char(64) NOT NULL REFERENCES blob(sha256),
  role        text NOT NULL CHECK (role IN ('PDF','NATIVO','ANEXO')),
  filename    text NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  created_by  uuid NOT NULL REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_revision_file UNIQUE (revision_id, blob_sha256)
);

-- INV-REV-003: arquivos de revisão fora de EM_ELABORACAO são imutáveis
CREATE OR REPLACE FUNCTION fn_revision_file_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM revision WHERE id = COALESCE(NEW.revision_id, OLD.revision_id);
  IF st IS NOT NULL AND st <> 'EM_ELABORACAO' THEN
    RAISE EXCEPTION 'INV-REV-003: revisão em % tem arquivos congelados', st
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER tg_revision_file_lock BEFORE INSERT OR UPDATE OR DELETE ON revision_file
  FOR EACH ROW EXECUTE FUNCTION fn_revision_file_lock();

-- Texto extraído / OCR (derivado — pode ser reprocessado sem tocar no arquivo)
CREATE TABLE file_text (
  file_id        uuid PRIMARY KEY REFERENCES revision_file(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'PENDENTE'
                 CHECK (status IN ('PENDENTE','PROCESSANDO','CONCLUIDO','FALHOU','IGNORADO')),
  engine         text,
  pages          integer CHECK (pages IS NULL OR pages >= 0),
  content        text NOT NULL DEFAULT '',
  confidence_avg numeric(5,2) CHECK (confidence_avg IS NULL OR confidence_avg BETWEEN 0 AND 100),
  archive_sha256 char(64) REFERENCES blob(sha256),   -- PDF/A pesquisável gerado pelo OCR
  thumb_key      text,
  error          text,
  attempts       integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  processed_at   timestamptz,
  tsv            tsvector GENERATED ALWAYS AS (to_tsvector('pt_unaccent'::regconfig, content)) STORED,
  CONSTRAINT ck_file_text_done CHECK (status <> 'CONCLUIDO' OR (processed_at IS NOT NULL AND engine IS NOT NULL)),
  CONSTRAINT ck_file_text_fail CHECK (status <> 'FALHOU' OR error IS NOT NULL)
);
CREATE INDEX ix_file_text_tsv ON file_text USING gin (tsv);
CREATE INDEX ix_file_text_pending ON file_text (status) WHERE status IN ('PENDENTE','FALHOU');

CREATE TABLE ocr_page (                                               -- INV-OCR-001
  file_id    uuid NOT NULL REFERENCES revision_file(id) ON DELETE CASCADE,
  page       integer NOT NULL CHECK (page >= 1),
  text       text NOT NULL DEFAULT '',
  confidence numeric(5,2) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  words      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{t, x, y, w, h, c}] normalizado 0..1
  PRIMARY KEY (file_id, page)
);

CREATE TABLE text_chunk (
  id        bigserial PRIMARY KEY,
  file_id   uuid NOT NULL REFERENCES revision_file(id) ON DELETE CASCADE,
  page      integer NOT NULL CHECK (page >= 1),
  content   text NOT NULL,
  embedding vector(384)
);
CREATE INDEX ix_text_chunk_emb ON text_chunk USING hnsw (embedding vector_cosine_ops);

-- =============================================================================
-- Check-out / check-in
-- =============================================================================
CREATE TABLE document_checkout (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES app_user(id),
  note           text,
  checked_out_at timestamptz NOT NULL DEFAULT now(),
  checked_in_at  timestamptz,
  CONSTRAINT ck_checkout_window CHECK (checked_in_at IS NULL OR checked_in_at >= checked_out_at)
);
-- INV-CHK-001: no máximo um check-out ativo por documento
CREATE UNIQUE INDEX uq_checkout_active ON document_checkout (document_id) WHERE checked_in_at IS NULL;

-- =============================================================================
-- Workflow de análise/aprovação
-- =============================================================================
CREATE TABLE workflow_template (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES project(id) ON DELETE CASCADE,  -- NULL = global
  name       text NOT NULL,
  active     boolean NOT NULL DEFAULT true
);
CREATE TABLE workflow_template_step (
  template_id   uuid NOT NULL REFERENCES workflow_template(id) ON DELETE CASCADE,
  step_order    integer NOT NULL CHECK (step_order >= 1),
  name          text NOT NULL,
  role_required text NOT NULL CHECK (role_required IN ('CONTROLADOR','AUTOR','REVISOR','ADMIN')),
  sla_hours     integer NOT NULL DEFAULT 48 CHECK (sla_hours > 0),
  PRIMARY KEY (template_id, step_order)
);

CREATE TABLE workflow_instance (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id  uuid NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  template_id  uuid NOT NULL REFERENCES workflow_template(id),
  status       text NOT NULL DEFAULT 'ATIVO' CHECK (status IN ('ATIVO','CONCLUIDO','REPROVADO','CANCELADO')),
  current_step integer NOT NULL DEFAULT 1 CHECK (current_step >= 1),
  assignees    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(assignees) = 'object'),  -- {"1": uuid, "2": uuid}
  started_by   uuid NOT NULL REFERENCES app_user(id),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  CONSTRAINT ck_wf_finished CHECK ((status = 'ATIVO') = (finished_at IS NULL))
);
-- um fluxo ativo por revisão
CREATE UNIQUE INDEX uq_workflow_active ON workflow_instance (revision_id) WHERE status = 'ATIVO';

CREATE TABLE workflow_task (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id   uuid NOT NULL REFERENCES workflow_instance(id) ON DELETE CASCADE,
  step_order    integer NOT NULL,
  step_name     text NOT NULL,
  assignee_id   uuid NOT NULL REFERENCES app_user(id),
  due_at        timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','APROVADA','REPROVADA','CANCELADA')),
  decided_by    uuid REFERENCES app_user(id),
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- INV-WF-001: decisão DEVE registrar quem, quando e (se reprovada) por quê
  CONSTRAINT ck_task_decided CHECK (
    status IN ('PENDENTE','CANCELADA')
    OR (decided_by IS NOT NULL AND decided_at IS NOT NULL
        AND (status <> 'REPROVADA' OR length(trim(coalesce(decision_note,''))) >= 5))),
  -- INV-WF-002: só o responsável decide a própria tarefa
  CONSTRAINT ck_task_assignee CHECK (decided_by IS NULL OR decided_by = assignee_id)
);
CREATE INDEX ix_task_inbox ON workflow_task (assignee_id, status, due_at);

-- INV-WF-003: autor da revisão NÃO PODE aprovar a própria revisão (segregação de funções)
-- INV-WF-004: tarefa decidida é imutável
CREATE OR REPLACE FUNCTION fn_task_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE author uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status <> 'PENDENTE' THEN
    RAISE EXCEPTION 'INV-WF-004: tarefa já decidida (%) é imutável', OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT r.created_by INTO author
    FROM workflow_instance wi JOIN revision r ON r.id = wi.revision_id
   WHERE wi.id = NEW.instance_id;
  IF NEW.status = 'APROVADA' AND NEW.decided_by = author THEN
    RAISE EXCEPTION 'INV-WF-003: autor da revisão não pode aprová-la'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_task_guard BEFORE INSERT OR UPDATE ON workflow_task
  FOR EACH ROW EXECUTE FUNCTION fn_task_guard();

-- =============================================================================
-- Comentários eletrônicos (anotações sobre o PDF)
-- =============================================================================
CREATE TABLE revision_comment (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id  uuid NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  author_id    uuid NOT NULL REFERENCES app_user(id),
  page         integer CHECK (page IS NULL OR page >= 1),
  -- retângulo normalizado 0..1 sobre a página (INV-CMT-001)
  x numeric(6,5), y numeric(6,5), w numeric(6,5), h numeric(6,5),
  category     text NOT NULL DEFAULT 'GERAL' CHECK (category IN ('GERAL','TECNICO','EDITORIAL','OBRIGATORIO')),
  body         text NOT NULL CHECK (length(trim(body)) >= 2),
  status       text NOT NULL DEFAULT 'ABERTO' CHECK (status IN ('ABERTO','RESOLVIDO','NAO_APLICAVEL')),
  resolved_in_revision_id uuid REFERENCES revision(id),
  resolved_by  uuid REFERENCES app_user(id),
  resolved_at  timestamptz,
  resolution   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_comment_rect CHECK (
    (x IS NULL AND y IS NULL AND w IS NULL AND h IS NULL)
    OR (page IS NOT NULL AND x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1
        AND w > 0 AND h > 0 AND x + w <= 1 AND y + h <= 1)),
  CONSTRAINT ck_comment_resolved CHECK (
    status = 'ABERTO'
    OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND length(trim(coalesce(resolution,''))) >= 3))
);
CREATE INDEX ix_comment_rev ON revision_comment (revision_id, status);

-- corpo, autor e alvo do comentário são imutáveis (só o status evolui)
CREATE OR REPLACE FUNCTION fn_comment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.body <> OLD.body OR NEW.author_id <> OLD.author_id OR NEW.revision_id <> OLD.revision_id
     OR NEW.category <> OLD.category THEN
    RAISE EXCEPTION 'INV-CMT-002: conteúdo do comentário é imutável; registre novo comentário'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_comment_guard BEFORE UPDATE ON revision_comment
  FOR EACH ROW EXECUTE FUNCTION fn_comment_guard();

-- =============================================================================
-- Regras entre tabelas para aprovação e emissão (constraint triggers, deferíveis)
-- INV-REV-004: EMITIDA exige ≥1 arquivo PDF
-- INV-REV-006: APROVADA_INTERNA exige workflow CONCLUIDO (se o projeto exigir)
-- INV-REV-007: APROVADA_INTERNA exige comentários OBRIGATORIO da revisão anterior encerrados
-- INV-REV-008: ao tornar-se vigente, a anterior deixa de ser vigente (feito pela API; o índice garante)
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_revision_cross_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE req boolean; prev uuid;
BEGIN
  IF NEW.status = 'EMITIDA' AND (TG_OP = 'INSERT' OR OLD.status <> 'EMITIDA') THEN
    IF NOT EXISTS (SELECT 1 FROM revision_file WHERE revision_id = NEW.id AND role = 'PDF') THEN
      RAISE EXCEPTION 'INV-REV-004: revisão % não pode ser emitida sem arquivo PDF', NEW.label
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'APROVADA_INTERNA' AND (TG_OP = 'INSERT' OR OLD.status <> 'APROVADA_INTERNA') THEN
    SELECT p.require_workflow INTO req
      FROM document d JOIN project p ON p.id = d.project_id WHERE d.id = NEW.document_id;
    IF req AND NOT EXISTS (SELECT 1 FROM workflow_instance
                            WHERE revision_id = NEW.id AND status = 'CONCLUIDO') THEN
      RAISE EXCEPTION 'INV-REV-006: aprovação interna exige workflow concluído'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT id INTO prev FROM revision
     WHERE document_id = NEW.document_id AND id <> NEW.id AND created_at < NEW.created_at
     ORDER BY created_at DESC LIMIT 1;
    IF prev IS NOT NULL AND EXISTS (SELECT 1 FROM revision_comment
         WHERE revision_id = prev AND category = 'OBRIGATORIO' AND status = 'ABERTO') THEN
      RAISE EXCEPTION 'INV-REV-007: há comentários obrigatórios abertos na revisão anterior'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER tg_revision_cross_rules AFTER INSERT OR UPDATE OF status ON revision
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION fn_revision_cross_rules();

-- =============================================================================
-- GRD — Guia de Remessa de Documentos (transmittal)
-- =============================================================================
CREATE TABLE grd_seq (
  project_id uuid PRIMARY KEY REFERENCES project(id),
  last_value integer NOT NULL DEFAULT 0 CHECK (last_value >= 0)
);

CREATE TABLE grd (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id),
  number      integer CHECK (number IS NULL OR number >= 1),
  recipient   text NOT NULL CHECK (length(trim(recipient)) >= 2),
  recipient_email text,
  purpose     text NOT NULL CHECK (purpose IN ('PI','PA','PC','CE','CA')),
  status      text NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN ('RASCUNHO','EMITIDA','RECEBIDA','CANCELADA')),
  notes       text,
  created_by  uuid NOT NULL REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  issued_by   uuid REFERENCES app_user(id),
  issued_at   timestamptz,
  received_by text,
  received_at timestamptz,
  manifest_sha256 char(64),                    -- hash do manifesto emitido (prova de conteúdo)
  CONSTRAINT uq_grd_number UNIQUE (project_id, number),                 -- INV-GRD-001
  CONSTRAINT ck_grd_issued CHECK (
    status IN ('RASCUNHO','CANCELADA')
    OR (number IS NOT NULL AND issued_by IS NOT NULL AND issued_at IS NOT NULL AND manifest_sha256 IS NOT NULL)),
  CONSTRAINT ck_grd_received CHECK (status <> 'RECEBIDA' OR (received_at IS NOT NULL AND received_by IS NOT NULL)),
  CONSTRAINT ck_grd_draft_number CHECK (status <> 'RASCUNHO' OR number IS NULL)
);

CREATE TABLE grd_item (
  grd_id      uuid NOT NULL REFERENCES grd(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES revision(id),
  copies      integer NOT NULL DEFAULT 1 CHECK (copies BETWEEN 1 AND 99),
  media       text NOT NULL DEFAULT 'DIGITAL' CHECK (media IN ('DIGITAL','IMPRESSO','AMBOS')),
  PRIMARY KEY (grd_id, revision_id)
);

-- INV-GRD-002: itens de GRD fora de RASCUNHO são imutáveis
-- INV-GRD-003: item DEVE pertencer ao projeto da GRD e estar APROVADA_INTERNA (ou emitida, para reenvio)
CREATE OR REPLACE FUNCTION fn_grd_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g grd%ROWTYPE; rp uuid; rs text;
BEGIN
  SELECT * INTO g FROM grd WHERE id = COALESCE(NEW.grd_id, OLD.grd_id);
  IF g.status <> 'RASCUNHO' THEN
    RAISE EXCEPTION 'INV-GRD-002: GRD % já emitida; itens congelados', g.number
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT d.project_id, r.status INTO rp, rs
      FROM revision r JOIN document d ON d.id = r.document_id WHERE r.id = NEW.revision_id;
    IF rp <> g.project_id THEN
      RAISE EXCEPTION 'INV-GRD-003: revisão pertence a outro projeto' USING ERRCODE = 'check_violation';
    END IF;
    IF rs NOT IN ('APROVADA_INTERNA','EMITIDA','APROVADA','APROVADA_COM_COMENTARIOS') THEN
      RAISE EXCEPTION 'INV-GRD-003: revisão em % não pode ser remetida', rs USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER tg_grd_item_guard BEFORE INSERT OR UPDATE OR DELETE ON grd_item
  FOR EACH ROW EXECUTE FUNCTION fn_grd_item_guard();

-- Cabeçalho de GRD emitida só pode evoluir para RECEBIDA/CANCELADA
CREATE OR REPLACE FUNCTION fn_grd_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'RASCUNHO' AND (
       NEW.number IS DISTINCT FROM OLD.number OR NEW.recipient <> OLD.recipient
       OR NEW.purpose <> OLD.purpose OR NEW.project_id <> OLD.project_id
       OR NEW.manifest_sha256 IS DISTINCT FROM OLD.manifest_sha256) THEN
    RAISE EXCEPTION 'INV-GRD-002: GRD emitida tem cabeçalho imutável' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('RECEBIDA','CANCELADA') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'INV-GRD-005: GRD em estado final (%)', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_grd_guard BEFORE UPDATE ON grd FOR EACH ROW EXECUTE FUNCTION fn_grd_guard();

-- Emissão atômica: numera sem lacuna, congela manifesto, emite as revisões
-- INV-GRD-004: GRD só é emitida com ≥1 item
CREATE OR REPLACE FUNCTION fn_grd_emitir(p_grd uuid, p_user uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE g grd%ROWTYPE; n integer; manifest text;
BEGIN
  SELECT * INTO g FROM grd WHERE id = p_grd FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GRD inexistente'; END IF;
  IF g.status <> 'RASCUNHO' THEN
    RAISE EXCEPTION 'INV-GRD-002: GRD já está em %', g.status USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM grd_item WHERE grd_id = p_grd) THEN
    RAISE EXCEPTION 'INV-GRD-004: GRD sem itens não pode ser emitida' USING ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(d.code || '|' || r.label || '|' || coalesce(
           (SELECT string_agg(f.blob_sha256, ',' ORDER BY f.blob_sha256) FROM revision_file f WHERE f.revision_id = r.id), ''),
         E'\n' ORDER BY d.code, r.label)
    INTO manifest
    FROM grd_item gi JOIN revision r ON r.id = gi.revision_id JOIN document d ON d.id = r.document_id
   WHERE gi.grd_id = p_grd;

  -- revisões aprovadas internamente passam a EMITIDA com a finalidade da GRD
  UPDATE revision r SET status = 'EMITIDA', purpose = g.purpose, issued_at = now()
    FROM grd_item gi WHERE gi.grd_id = p_grd AND gi.revision_id = r.id AND r.status = 'APROVADA_INTERNA';

  INSERT INTO grd_seq (project_id, last_value) VALUES (g.project_id, 1)
  ON CONFLICT (project_id) DO UPDATE SET last_value = grd_seq.last_value + 1
  RETURNING last_value INTO n;

  UPDATE grd SET status = 'EMITIDA', number = n, issued_by = p_user, issued_at = now(),
                 manifest_sha256 = encode(digest(manifest, 'sha256'), 'hex')
   WHERE id = p_grd;
  RETURN n;
END $$;

-- =============================================================================
-- INV-AI-001 · "A IA propõe. O humano decide."
-- Sugestão de IA só alcança APLICADA com decisão humana registrada.
-- =============================================================================
CREATE TABLE ai_suggestion (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('METADADOS_CARIMBO','COMENTARIO_ATENDIDO','CLASSIFICACAO')),
  target_type text NOT NULL CHECK (target_type IN ('document','revision','revision_file','revision_comment')),
  target_id   uuid NOT NULL,
  payload     jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  confidence  numeric(4,3) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  engine      text NOT NULL,
  status      text NOT NULL DEFAULT 'PROPOSTA' CHECK (status IN ('PROPOSTA','APLICADA','REJEITADA')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_by  uuid REFERENCES app_user(id),
  decided_at  timestamptz,
  CONSTRAINT ck_ai_human_gate CHECK (
    status = 'PROPOSTA' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
COMMENT ON CONSTRAINT ck_ai_human_gate ON ai_suggestion IS
  'INV-AI-001: sugestão de IA NÃO DEVE ser aplicada ou rejeitada sem decisão humana registrada';
CREATE INDEX ix_ai_target ON ai_suggestion (target_type, target_id, status);

CREATE OR REPLACE FUNCTION fn_ai_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'PROPOSTA' THEN
    RAISE EXCEPTION 'INV-AI-002: decisão sobre sugestão é final' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.payload <> OLD.payload THEN
    RAISE EXCEPTION 'INV-AI-002: proposta da IA não pode ser editada após criada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_ai_guard BEFORE UPDATE ON ai_suggestion FOR EACH ROW EXECUTE FUNCTION fn_ai_guard();

-- =============================================================================
-- INV-AUD-001 · Trilha de auditoria append-only com encadeamento SHA-256
-- =============================================================================
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_id    uuid,
  entity      text NOT NULL,
  entity_id   text NOT NULL,
  action      text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash   char(64) NOT NULL,
  hash        char(64) NOT NULL UNIQUE
);
CREATE INDEX ix_audit_entity ON audit_log (entity, entity_id, id);

CREATE OR REPLACE FUNCTION fn_audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ph char(64);
BEGIN
  PERFORM pg_advisory_xact_lock(7340031);          -- serializa a cadeia
  SELECT hash INTO ph FROM audit_log ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := coalesce(ph, repeat('0', 64));
  NEW.at := clock_timestamp();
  NEW.hash := encode(digest(
      NEW.prev_hash || '|' || NEW.at::text || '|' || coalesce(NEW.actor_id::text,'') || '|' ||
      NEW.entity || '|' || NEW.entity_id || '|' || NEW.action || '|' || NEW.data::text, 'sha256'), 'hex');
  RETURN NEW;
END $$;
CREATE TRIGGER tg_audit_chain BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fn_audit_chain();

CREATE OR REPLACE FUNCTION fn_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'INV-AUD-001: audit_log é append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER tg_audit_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION fn_audit_immutable();
CREATE TRIGGER tg_audit_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION fn_audit_immutable();

-- Auditoria genérica das tabelas de negócio
CREATE OR REPLACE FUNCTION fn_audit_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rec jsonb; old_rec jsonb; diff jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN rec := to_jsonb(OLD); ELSE rec := to_jsonb(NEW); END IF;
  rec := rec - 'tsv' - 'content' - 'title_phonetic' - 'password_hash';
  IF TG_OP = 'UPDATE' THEN
    old_rec := to_jsonb(OLD) - 'tsv' - 'content' - 'title_phonetic' - 'password_hash';
    SELECT coalesce(jsonb_object_agg(k, jsonb_build_array(old_rec -> k, rec -> k)), '{}'::jsonb) INTO diff
      FROM jsonb_object_keys(rec) k WHERE rec -> k IS DISTINCT FROM old_rec -> k;
    IF diff = '{}'::jsonb THEN RETURN NULL; END IF;
    rec := diff;
  END IF;
  INSERT INTO audit_log (actor_id, entity, entity_id, action, data, prev_hash, hash)
  VALUES (fn_actor(), TG_TABLE_NAME,
          coalesce(to_jsonb(coalesce(NEW, OLD)) ->> 'id', to_jsonb(coalesce(NEW, OLD)) ->> 'grd_id', '?'),
          TG_OP, rec, '', '');
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project','project_member','document','revision','revision_file',
                           'document_checkout','workflow_instance','workflow_task',
                           'revision_comment','grd','grd_item','ai_suggestion','app_user']
  LOOP
    EXECUTE format('CREATE TRIGGER tg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON %1$I
                    FOR EACH ROW EXECUTE FUNCTION fn_audit_row()', t);
  END LOOP;
END $$;

-- Verificação da cadeia: retorna a primeira linha quebrada (vazio = íntegra)
CREATE OR REPLACE FUNCTION fn_audit_verify() RETURNS TABLE (broken_id bigint, reason text)
LANGUAGE sql STABLE AS $$
  WITH c AS (
    SELECT id, hash, prev_hash,
           lag(hash) OVER (ORDER BY id) AS lag_hash,
           encode(digest(prev_hash || '|' || at::text || '|' || coalesce(actor_id::text,'') || '|' ||
                  entity || '|' || entity_id || '|' || action || '|' || data::text, 'sha256'), 'hex') AS recomputed
      FROM audit_log)
  SELECT id, CASE WHEN hash <> recomputed THEN 'hash não confere'
                  ELSE 'prev_hash não encadeia' END
    FROM c
   WHERE hash <> recomputed OR (lag_hash IS NOT NULL AND prev_hash <> lag_hash)
   ORDER BY id LIMIT 1
$$;

-- =============================================================================
-- Views de leitura
-- =============================================================================
CREATE OR REPLACE VIEW v_master_list AS
SELECT d.id, d.project_id, p.code AS project_code, d.code, d.title, d.discipline_code, d.doc_type_code,
       d.area, d.originator, d.confidentiality, d.tags, d.created_at, d.updated_at,
       r.id AS revision_id, r.label AS revision_label, r.status AS revision_status, r.purpose,
       r.issued_at, r.client_return_code,
       (SELECT count(*) FROM revision_comment c WHERE c.revision_id = r.id AND c.status = 'ABERTO') AS open_comments,
       co.user_id AS checked_out_by
  FROM document d
  JOIN project p ON p.id = d.project_id
  LEFT JOIN revision r ON r.document_id = d.id AND r.is_current
  LEFT JOIN document_checkout co ON co.document_id = d.id AND co.checked_in_at IS NULL;
