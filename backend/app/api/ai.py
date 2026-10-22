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


# documento de cada sugestão (pelo alvo), para aplicar a mesma regra de acesso da lista mestra e dos arquivos:
# membro do projeto (ou admin) e, em documento RESTRITO, nada para LEITOR/EXTERNO.
_DOC_DA_SUGESTAO = """
    CASE s.target_type
      WHEN 'document' THEN s.target_id
      WHEN 'revision' THEN (SELECT r.document_id FROM revision r WHERE r.id = s.target_id)
      WHEN 'revision_file' THEN (SELECT r.document_id FROM revision_file f JOIN revision r ON r.id = f.revision_id
                                  WHERE f.id = s.target_id)
      ELSE (SELECT r.document_id FROM revision_comment c JOIN revision r ON r.id = c.revision_id WHERE c.id = s.target_id)
    END"""


@router.get("")
async def list_suggestions(conn: Conn, user: CurrentUser, status: str = "PROPOSTA",
                           project_id: str | None = None) -> list[dict[str, Any]]:
    return await fetch_all(conn, f"""
        SELECT s.id::text, s.kind, s.target_type, s.target_id::text, s.payload, s.confidence, s.engine,
               s.status, s.created_at, d.project_id::text AS project_id
          FROM ai_suggestion s
          JOIN document d ON d.id = ({_DOC_DA_SUGESTAO})
          LEFT JOIN project_member m ON m.project_id = d.project_id AND m.user_id = CAST(:u AS uuid)
         WHERE s.status = :s
           AND (CAST(:p AS uuid) IS NULL OR d.project_id = CAST(:p AS uuid))
           AND (:adm OR (m.role IS NOT NULL
                         AND NOT (d.confidentiality = 'RESTRITO' AND m.role IN ('LEITOR', 'EXTERNO'))))
         ORDER BY s.created_at DESC LIMIT 200""", s=status, u=user.id, adm=user.is_admin, p=project_id)


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
