from typing import Any

from fastapi import APIRouter, Query

from app.api.deps import Conn
from app.core.db import fetch_all, fetch_one
from app.core.errors import DomainError
from app.core.security import CurrentUser
from app.services import access

router = APIRouter(prefix="/audit", tags=["auditoria"])


@router.get("")
async def audit(conn: Conn, user: CurrentUser, entity: str | None = None, entity_id: str | None = None,
                limit: int = Query(100, le=1000)) -> list[dict[str, Any]]:
    if entity_id is None and not user.is_admin:
        raise DomainError("Consulta ampla da trilha exige administrador", 403)
    if not user.is_admin:
        await _exige_acesso(conn, user, str(entity_id))
    return await fetch_all(conn, """
        SELECT a.id, a.at, a.entity, a.entity_id, a.action, a.data, a.hash, u.name AS actor
          FROM audit_log a LEFT JOIN app_user u ON u.id = a.actor_id
         WHERE (CAST(:e AS text) IS NULL OR a.entity = CAST(:e AS text))
           AND (CAST(:i AS text) IS NULL OR a.entity_id = CAST(:i AS text)
                OR a.data ->> 'document_id' = CAST(:i AS text) OR a.data ->> 'revision_id' = CAST(:i AS text))
         ORDER BY a.id DESC LIMIT :lim""", e=entity, i=entity_id, lim=limit)


async def _exige_acesso(conn: Conn, user: CurrentUser, entity_id: str) -> None:
    """Fora do admin, a trilha só sai para documento ou revisão de projeto do qual o usuário é membro
    (e, se o documento for RESTRITO, não para LEITOR/EXTERNO) — mesma regra dos arquivos."""
    row = await fetch_one(conn, """
        SELECT d.project_id::text, d.confidentiality FROM document d
         WHERE d.id::text = :i
            OR d.id = (SELECT r.document_id FROM revision r WHERE r.id::text = :i)""", i=entity_id)
    if not row:
        raise DomainError("Trilha disponível só para documento ou revisão de um projeto seu", 403)
    role = await access.require(conn, row["project_id"], user)
    if row["confidentiality"] == "RESTRITO" and role in ("LEITOR", "EXTERNO"):
        raise DomainError("Documento restrito", 403)


@router.get("/verify")
async def verify(conn: Conn, user: CurrentUser) -> dict[str, Any]:
    if not user.is_admin:
        raise DomainError("Somente administradores", 403)
    broken = await fetch_all(conn, "SELECT broken_id, reason FROM fn_audit_verify()")
    total = await fetch_all(conn, "SELECT count(*) AS n, max(id) AS last_id FROM audit_log")
    return {"intact": not broken, "broken": broken, **total[0]}
