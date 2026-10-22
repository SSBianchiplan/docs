-- =============================================================================
-- Módulo Configurações
--   * user_profile: foto (avatar) e preferências do usuário. Fica FORA da trilha de auditoria de propósito:
--     app_user é auditada linha a linha e o audit_log é imutável — guardar a foto lá a eternizaria.
--   * system_config: configurações do sistema editáveis pelo painel (ex.: Assistente IA). Auditada; segredos
--     (chave da Anthropic) entram cifrados (Fernet, CONFIG_SEGREDO), nunca em claro.
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_profile (
  user_id     uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  avatar      bytea CHECK (avatar IS NULL OR octet_length(avatar) <= 400000),
  avatar_mime text CHECK (avatar_mime IS NULL OR avatar_mime IN ('image/png','image/jpeg','image/webp')),
  avatar_ver  integer NOT NULL DEFAULT 0,
  prefs       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_config (
  id          text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES app_user(id)
);
DROP TRIGGER IF EXISTS tg_audit_system_config ON system_config;
CREATE TRIGGER tg_audit_system_config AFTER INSERT OR UPDATE OR DELETE ON system_config
  FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
