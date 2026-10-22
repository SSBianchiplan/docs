from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

JWT_SECRET_PADRAO = "troque-este-segredo"
BOOTSTRAP_SENHA_PADRAO = "troque-no-primeiro-acesso"
JWT_SECRET_MIN = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)  # erro não ecoa segredos

    app_name: str = "GPlanSiS|DOCS"
    # "producao" (padrão, falha fechado) | "dev" | "teste": fora de produção os padrões abaixo são aceitos
    app_env: str = "producao"
    database_url: str = "postgresql+asyncpg://edms:edms@localhost:5432/edms"
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret: str = JWT_SECRET_PADRAO
    jwt_ttl_minutes: int = 60 * 10

    storage_backend: str = "fs"            # fs (volume local) | s3 (MinIO/S3)
    storage_dir: str = "/data/blobs"
    s3_endpoint: str = "localhost:9000"
    s3_access_key: str = "minio"
    s3_secret_key: str = "minio12345"
    s3_bucket: str = "edms"
    s3_secure: bool = False

    gotenberg_url: str = "http://gotenberg:3000"

    # OCR
    ocr_engine: str = "tesseract"          # tesseract | paddle
    ocr_languages: str = "por+eng"
    ocr_dpi: int = 300
    ocr_min_chars_per_page: int = 40       # abaixo disso a página é tratada como imagem
    ocr_archive_pdfa: bool = True          # gera PDF/A pesquisável via OCRmyPDF
    ocr_max_pages: int = 500

    embeddings_enabled: bool = False
    embeddings_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-sonnet-5"   # snapshot fixo — troca exige reavaliação de prompt
    config_segredo: str | None = None          # cifra segredos guardados pelo painel (ex.: chave da IA)

    max_upload_mb: int = 512
    bootstrap_admin_email: str = "contato@gplansis.com"
    bootstrap_admin_name: str = "Administrador"
    bootstrap_admin_password: str = BOOTSTRAP_SENHA_PADRAO
    cors_origins: list[str] = ["http://localhost:5173"]

    # Integração com o GPlanSiS|Drawings (segredo compartilhado; vazio = integração desligada)
    integracao_drawings_segredo: str | None = None
    drawings_url: str = "https://drawings.gplansis.com"
    drawings_webhook_url: str | None = None   # padrão: {drawings_url}/api/integracao/docs/evento

    # Integração com o GPlanSiS|Writer (mesmo desenho do Drawings, com segredo próprio)
    integracao_writer_segredo: str | None = None
    writer_url: str = "https://writer.gplansis.com"
    writer_webhook_url: str | None = None     # padrão: {writer_url}/api/integracao/docs/evento

    # Integração com o GPlanSiS|Sheets (planilhas e BI; mesmo desenho, segredo próprio)
    integracao_sheets_segredo: str | None = None
    sheets_url: str = "https://sheets.gplansis.com"
    sheets_webhook_url: str | None = None     # padrão: {sheets_url}/api/integracao/docs/evento

    @model_validator(mode="after")
    def _segredos_de_producao(self) -> "Settings":
        """Em produção a API não sobe com o segredo do JWT padrão, vazio ou curto (quem conhece o padrão
        forja sessão de admin), nem com a senha inicial do admin padrão."""
        if self.app_env.strip().lower() in ("dev", "desenvolvimento", "teste", "test"):
            return self
        erros = []
        if not self.jwt_secret or self.jwt_secret == JWT_SECRET_PADRAO or len(self.jwt_secret) < JWT_SECRET_MIN:
            erros.append(f"JWT_SECRET ausente, padrão ou com menos de {JWT_SECRET_MIN} caracteres "
                         "(gere com: openssl rand -hex 32)")
        if not self.bootstrap_admin_password or self.bootstrap_admin_password == BOOTSTRAP_SENHA_PADRAO:
            erros.append("BOOTSTRAP_ADMIN_PASSWORD ausente ou padrão")
        if erros:
            raise ValueError("Configuração insegura para produção (APP_ENV=producao): " + "; ".join(erros))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
