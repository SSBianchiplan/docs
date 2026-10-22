import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import DBAPIError

from app.api import (
    access_requests,
    ai,
    audit,
    auth,
    comments,
    dashboard,
    documents,
    configuracoes,
    grd,
    integracao,
    project_admin,
    projects,
    search,
    workflow,
)
from app.core.config import get_settings
from app.core.db import engine, fetch_one, scalar
from app.core.errors import DomainError, db_error_handler, domain_error_handler
from app.core.security import hash_password

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("api")


async def bootstrap() -> None:
    """Garante o administrador master (BOOTSTRAP_ADMIN_EMAIL) ativo e com perfil de admin.
    Na primeira criação a senha vem de BOOTSTRAP_ADMIN_PASSWORD e a troca é obrigatória no 1º acesso."""
    s = get_settings()
    email = s.bootstrap_admin_email.strip().lower()
    async with engine().begin() as conn:
        row = await fetch_one(conn, "SELECT id::text, is_admin, is_active FROM app_user WHERE email = :e", e=email)
        if row is None:
            # vários workers sobem juntos: só o primeiro cria, os demais seguem
            created = await fetch_one(conn, """
                INSERT INTO app_user (email, name, password_hash, is_admin, must_change_password)
                VALUES (:e, :n, :h, true, true) ON CONFLICT (email) DO NOTHING RETURNING id""",
                e=email, n=s.bootstrap_admin_name, h=hash_password(s.bootstrap_admin_password))
            if created:
                log.warning("administrador master criado: %s", email)
        elif not (row["is_admin"] and row["is_active"]):
            await fetch_one(conn, "UPDATE app_user SET is_admin = true, is_active = true WHERE id = CAST(:u AS uuid) RETURNING id",
                            u=row["id"])
            log.warning("administrador master reativado: %s", email)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await bootstrap()
    yield
    await engine().dispose()


# Swagger/OpenAPI só fora de produção (APP_ENV=dev/teste): em produção não expõe o mapa das rotas
_DEV = get_settings().app_env.strip().lower() in ("dev", "desenvolvimento", "teste", "test")
app = FastAPI(title="GPlanSiS|DOCS API", version="0.1.0", lifespan=lifespan,
              docs_url="/api/docs" if _DEV else None, redoc_url=None,
              openapi_url="/api/openapi.json" if _DEV else None)
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
app.add_exception_handler(DBAPIError, db_error_handler)
app.add_exception_handler(DomainError, domain_error_handler)

for r in (auth, access_requests, project_admin, projects, documents, workflow, comments, grd, search, dashboard, ai, audit,
          integracao, configuracoes):
    app.include_router(r.router, prefix="/api")


@app.get("/api/health")
async def health() -> dict[str, str]:
    async with engine().connect() as conn:
        await scalar(conn, "SELECT 1")
    return {"status": "ok"}
