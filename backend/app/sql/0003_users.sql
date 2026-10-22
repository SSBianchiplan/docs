-- GPlanSiS|DOCS · migration 0002 · ciclo de vida da conta
-- Troca obrigatória de senha no primeiro acesso / após redefinição, e último acesso.
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

-- Solicitação de acesso vinda da página pública: só vira conta com decisão de um administrador
CREATE TABLE IF NOT EXISTS access_request (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
  email       citext NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  company     text CHECK (company IS NULL OR length(company) <= 160),
  message     text CHECK (message IS NULL OR length(message) <= 2000),
  status      text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','APROVADA','RECUSADA')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_by  uuid REFERENCES app_user(id),
  decided_at  timestamptz,
  user_id     uuid REFERENCES app_user(id),
  CONSTRAINT ck_access_decided CHECK (status = 'PENDENTE' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_access_request_pending ON access_request (email) WHERE status = 'PENDENTE';
DROP TRIGGER IF EXISTS tg_audit_access_request ON access_request;
CREATE TRIGGER tg_audit_access_request AFTER INSERT OR UPDATE OR DELETE ON access_request
  FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
