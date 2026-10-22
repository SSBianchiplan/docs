-- GPlanSiS|DOCS · migration 0003 · projeto avançado: contrato, prazos, áreas, disciplinas habilitadas,
-- padrões de documento e planejamento de emissão (curva S planejado × realizado)
ALTER TABLE project ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE project ADD COLUMN IF NOT EXISTS contract text;
ALTER TABLE project ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE project ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE project ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE project ADD COLUMN IF NOT EXISTS revision_scheme text NOT NULL DEFAULT 'auto';
ALTER TABLE project ADD COLUMN IF NOT EXISTS default_confidentiality text NOT NULL DEFAULT 'INTERNO';
ALTER TABLE project ADD COLUMN IF NOT EXISTS retention_years integer;
ALTER TABLE project ADD COLUMN IF NOT EXISTS default_template_id uuid REFERENCES workflow_template(id);
ALTER TABLE project ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES app_user(id);
DO $$ BEGIN ALTER TABLE project ADD CONSTRAINT ck_project_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE project ADD CONSTRAINT ck_project_revscheme CHECK (revision_scheme IN ('auto','numeric'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE project ADD CONSTRAINT ck_project_conf CHECK (default_confidentiality IN ('PUBLICO','INTERNO','CONFIDENCIAL','RESTRITO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE project ADD CONSTRAINT ck_project_retention CHECK (retention_years IS NULL OR retention_years BETWEEN 1 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Áreas / unidades do projeto (alimentam o token {AREA} da máscara)
CREATE TABLE IF NOT EXISTS project_area (
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code       text NOT NULL CHECK (code ~ '^[A-Z0-9]{1,6}$'),
  name       text NOT NULL CHECK (length(trim(name)) >= 2),
  PRIMARY KEY (project_id, code)
);

-- Disciplinas habilitadas no projeto (nenhuma linha = todas do catálogo)
CREATE TABLE IF NOT EXISTS project_discipline (
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  discipline_code text NOT NULL REFERENCES discipline(code),
  PRIMARY KEY (project_id, discipline_code)
);

-- Planejamento: data prevista da 1ª emissão e peso para o avanço físico da documentação
ALTER TABLE document ADD COLUMN IF NOT EXISTS planned_issue_date date;
ALTER TABLE document ADD COLUMN IF NOT EXISTS weight numeric(8,2) NOT NULL DEFAULT 1;
DO $$ BEGIN
  ALTER TABLE document ADD CONSTRAINT ck_document_weight CHECK (weight > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_document_planned ON document (project_id, planned_issue_date);

-- INV-PRJ-001: documento só pode usar disciplina habilitada no projeto (quando houver restrição)
-- INV-PRJ-002: área do documento DEVE existir no projeto quando o projeto tem áreas cadastradas
CREATE OR REPLACE FUNCTION fn_document_project_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM project_discipline WHERE project_id = NEW.project_id)
     AND NOT EXISTS (SELECT 1 FROM project_discipline
                      WHERE project_id = NEW.project_id AND discipline_code = NEW.discipline_code) THEN
    RAISE EXCEPTION 'INV-PRJ-001: disciplina % não habilitada no projeto', NEW.discipline_code
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.area IS NOT NULL AND EXISTS (SELECT 1 FROM project_area WHERE project_id = NEW.project_id)
     AND NOT EXISTS (SELECT 1 FROM project_area WHERE project_id = NEW.project_id AND code = NEW.area) THEN
    RAISE EXCEPTION 'INV-PRJ-002: área % não cadastrada no projeto', NEW.area
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_document_project_rules ON document;
CREATE TRIGGER tg_document_project_rules BEFORE INSERT OR UPDATE OF discipline_code, area, project_id
  ON document FOR EACH ROW EXECUTE FUNCTION fn_document_project_rules();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_area','project_discipline','workflow_template','workflow_template_step'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tg_audit_%1$s ON %1$I', t);
    EXECUTE format('CREATE TRIGGER tg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON %1$I
                    FOR EACH ROW EXECUTE FUNCTION fn_audit_row()', t);
  END LOOP;
END $$;

-- lista mestra passa a expor o planejamento
DROP VIEW IF EXISTS v_master_list;
CREATE VIEW v_master_list AS
SELECT d.id, d.project_id, p.code AS project_code, d.code, d.title, d.discipline_code, d.doc_type_code,
       d.area, d.originator, d.confidentiality, d.tags, d.created_at, d.updated_at,
       r.id AS revision_id, r.label AS revision_label, r.status AS revision_status, r.purpose,
       r.issued_at, r.client_return_code,
       (SELECT count(*) FROM revision_comment c WHERE c.revision_id = r.id AND c.status = 'ABERTO') AS open_comments,
       co.user_id AS checked_out_by,
       d.planned_issue_date, d.weight,
       (SELECT min(r2.issued_at) FROM revision r2 WHERE r2.document_id = d.id) AS first_issued_at
  FROM document d
  JOIN project p ON p.id = d.project_id
  LEFT JOIN revision r ON r.document_id = d.id AND r.is_current
  LEFT JOIN document_checkout co ON co.document_id = d.id AND co.checked_in_at IS NULL;
