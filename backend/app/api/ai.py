"""Sugestões da IA — INV-AI-001: a IA propõe, o humano decide."""
import json
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import Conn
from app.core.db import fetch_all, fetch_one
from app.core.errors import DomainError
from app.core.security import CurrentUser
from app.services import access

router = APIRouter(prefix="/suggestions", tags=["IA"])


class DecideIn(BaseModel):
    decision: Literal["APLICADA", "REJEITADA"]


@router.get("")
async def list_suggestions(conn: Conn, user: CurrentUser, status: str = "PROPOSTA") -> list[dict[str, Any]]:
    return await fetch_all(conn, """
        SELECT s.id::text, s.kind, s.target_type, s.target_id::text, s.payload, s.confidence, s.engine,
               s.status, s.created_at
          FROM ai_suggestion s WHERE s.status = :s ORDER BY s.created_at DESC LIMIT 200""", s=status)


async def _project_for(conn: Any, target_type: str, target_id: str) -> str:
    if target_type == "document":
        return await access.project_of_document(conn, target_id)
    if target_type == "revision":
        return await access.project_of_revision(conn, target_id)
    if target_type == "revision_file":
        row = await fetch_one(conn, "SELECT revision_id::text FROM revision_file WHERE id = :i", i=target_id)
    else:
        row = await fetch_one(conn, "SELECT revision_id::text FROM revision_comment WHERE id = :i", i=target_id)
    if not row:
        raise DomainError("Alvo da sugestão não existe mais", 404)
    return await access.project_of_revision(conn, row["revision_id"])


@router.post("/{suggestion_id}/decide")
async def decide(suggestion_id: str, body: DecideIn, conn: Conn, user: CurrentUser) -> dict[str, str]:
    s = await fetch_one(conn, """SELECT id::text, kind, target_type, target_id::text, payload
                                 FROM ai_suggestion WHERE id = :i AND status = 'PROPOSTA' FOR UPDATE""",
                        i=suggestion_id)
    if not s:
        raise DomainError("Sugestão inexistente ou já decidida", 404)
    await access.require(conn, await _project_for(conn, s["target_type"], s["target_id"]), user,
                         access.WRITE_ROLES + ("REVISOR",))
    if body.decision == "APLICADA":
        pl = s["payload"]
        if s["kind"] == "METADADOS_CARIMBO" and s["target_type"] == "document":
            if pl.get("title"):
                await fetch_one(conn, "UPDATE document SET title = :t WHERE id = :d RETURNING id",
                                t=pl["title"], d=s["target_id"])
            extra = {k: v for k, v in pl.items() if k in ("escala", "folha", "formato") and v}
            if extra:
                await fetch_one(conn, """UPDATE document SET metadata = metadata || CAST(:m AS jsonb)
                                         WHERE id = :d RETURNING id""", m=json.dumps(extra), d=s["target_id"])
        elif s["kind"] == "COMENTARIO_ATENDIDO" and s["target_type"] == "revision_comment":
            await fetch_one(conn, """
                UPDATE revision_comment SET status = 'RESOLVIDO', resolved_by = :u, resolved_at = now(),
                       resolution = :res, resolved_in_revision_id = CAST(:rr AS uuid)
                 WHERE id = :c AND status = 'ABERTO' RETURNING id""",
                u=user.id, c=s["target_id"], rr=pl.get("revision_id"),
                res="Atendido na revisão " + str(pl.get("revision_label", "?"))
                    + " — evidência: " + str(pl.get("evidence", ""))[:400]
                    + " (verificado por IA, confirmado por " + user.name + ")")
    await fetch_one(conn, """UPDATE ai_suggestion SET status = :st, decided_by = :u, decided_at = now()
                             WHERE id = :i RETURNING id""", st=body.decision, u=user.id, i=suggestion_id)
    return {"status": body.decision}
