-- =============================================================================
-- Cota mensal de IA por pessoa (auditoria 2026-10, M5) — idempotente.
--   * app_user.ia_cota_usd: cota própria da pessoa em US$ (NULL = usa a padrão de system_config['ia'].cota_usd).
--     app_user já é auditada linha a linha: mudar a cota de alguém fica na trilha.
--   * ia_uso: uma linha por chamada à Anthropic, com os tokens REAIS e o custo; ok NULL = em andamento.
--     É registro de consumo (não entra na trilha de auditoria) e nunca guarda texto do prompt nem da resposta.
-- =============================================================================
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS ia_cota_usd numeric(10,2)
  CHECK (ia_cota_usd IS NULL OR ia_cota_usd BETWEEN 0 AND 10000);

CREATE TABLE IF NOT EXISTS ia_uso (
  id            bigserial PRIMARY KEY,
  ts            timestamptz NOT NULL DEFAULT now(),
  user_id       uuid REFERENCES app_user(id) ON DELETE SET NULL,
  recurso       text NOT NULL CHECK (length(recurso) <= 60),
  ref           text CHECK (ref IS NULL OR length(ref) <= 80),
  modelo        text CHECK (modelo IS NULL OR length(modelo) <= 80),
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read    integer NOT NULL DEFAULT 0,
  cache_write   integer NOT NULL DEFAULT 0,
  custo_usd     numeric(12,6) NOT NULL DEFAULT 0,
  ok            boolean,
  erro          text CHECK (erro IS NULL OR length(erro) <= 80),
  ms            integer
);
CREATE INDEX IF NOT EXISTS ix_ia_uso_user_ts ON ia_uso (user_id, ts);
