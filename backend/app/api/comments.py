from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel, Field

from app.api.deps import Conn
from app.core.db import fetch_all, fetch_one
from app.core.errors import DomainError
from app.core.security import CurrentUser, LoginThrottle
from app.services import access, ia_cota
from app.services.queue import enqueue_comment_check

router = APIRouter(tags=["comentários"])
# teto de verificações pela IA (cada uma pode chamar a API da Anthropic): por usuário e por revisão, em memória
COTA_IA_USUARIO = LoginThrottle(max_fail=20, window_s=3600)
COTA_IA_REVISAO = LoginThrottle(max_fail=3, window_s=600)


class CommentIn(BaseModel):
    body: str = Field(min_length=2)
    category: Literal["GERAL", "TECNICO", "EDITORIAL", "OBRIGATORIO"] = "GERAL"
    page: int | None = Field(default=None, ge=1)
    x: float | None = None
    y: float | None = None
    w: float | None = None
    h: float | None = None


class ResolveIn(BaseModel):
    status: Literal["RESOLVIDO", "NAO_APLICAVEL"]
    resolution: str = Field(min_length=3)
    resolved_in_revision_id: str | None = None


@router.get("/revisions/{revision_id}/comments")
async def list_comments(revision_id: str, conn: Conn, user: CurrentUser) -> list[dict[str, Any]]:
    await access.require(conn, await access.project_of_revision(conn, revision_id), user)
    return await fetch_all(conn, """
        SELECT c.id::text, c.page, c.x, c.y, c.w, c.h, c.category, c.body, c.status, c.resolution,
               c.created_at, c.resolved_at, a.name AS author, rb.name AS resolved_by_name,
               rr.label AS resolved_in_label
          FROM revision_comment c JOIN app_user a ON a.id = c.author_id
          LEFT JOIN app_user rb ON rb.id = c.resolved_by
          LEFT JOIN revision rr ON rr.id = c.resolved_in_revision_id
         WHERE c.revision_id = :r ORDER BY c.page NULLS FIRST, c.created_at""", r=revision_id)


@router.post("/revisions/{revision_id}/comments", status_code=201)
async def add_comment(revision_id: str, body: CommentIn, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    role = await access.require(conn, await access.project_of_revision(conn, revision_id), user)
    if role == "LEITOR":
        raise DomainError("Perfil LEITOR não comenta", 403)
    row = await fetch_one(conn, """
        INSERT INTO revision_comment (revision_id, author_id, page, x, y, w, h, category, body)
        VALUES (:r, :u, :p, :x, :y, :w, :h, :c, :b) RETURNING id::text, created_at""",
        r=revision_id, u=user.id, p=body.page, x=body.x, y=body.y, w=body.w, h=body.h,
        c=body.category, b=body.body)
    assert row
    return row


@router.post("/comments/{comment_id}/resolve")
async def resolve(comment_id: str, body: ResolveIn, conn: Conn, user: CurrentUser) -> dict[str, str]:
    rev = await fetch_one(conn, "SELECT revision_id::text FROM revision_comment WHERE id = :c", c=comment_id)
    if not rev:
        raise DomainError("Comentário não encontrado", 404)
    await access.require(conn, await access.project_of_revision(conn, rev["revision_id"]), user,
                         access.WRITE_ROLES + ("REVISOR",))
    await fetch_one(conn, """
        UPDATE revision_comment SET status = :s, resolution = :res, resolved_by = :u, resolved_at = now(),
               resolved_in_revision_id = CAST(:rr AS uuid)
         WHERE id = :c AND status = 'ABERTO' RETURNING id""",
        s=body.status, res=body.resolution, u=user.id, rr=body.resolved_in_revision_id, c=comment_id)
    return {"id": comment_id}


@router.post("/revisions/{revision_id}/check-comments", status_code=202)
async def check_comments(revision_id: str, conn: Conn, user: CurrentUser, bg: BackgroundTasks) -> dict[str, str]:
    """Pede à IA para verificar se os comentários da revisão anterior foram atendidos nesta.
    O resultado são PROPOSTAS (ai_suggestion) — só um humano as aplica (INV-AI-001)."""
    await access.require(conn, await access.project_of_revision(conn, revision_id), user,
                         access.WRITE_ROLES + ("REVISOR",))
    ku, kr = f"u:{user.id}", f"r:{revision_id}"
    espera = max(COTA_IA_USUARIO.retry_after(ku), COTA_IA_REVISAO.retry_after(kr))
    if espera:
        raise DomainError(f"Limite de verificações pela IA atingido; tente de novo em {espera // 60 + 1} min", 429)
    from app.core import sysconfig
    if (await sysconfig.ia_config())["pronta"]:
        await ia_cota.verifica(conn, user.id)      # 402 cota mensal em US$ / 429 ritmo, antes de enfileirar
    COTA_IA_USUARIO.fail(ku)
    COTA_IA_REVISAO.fail(kr)
    bg.add_task(enqueue_comment_check, revision_id, user.id)
    return {"status": "enfileirado"}
