import json
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.api.deps import Conn
from app.core.db import fetch_all, fetch_one, scalar
from app.core.errors import DomainError
from app.core.security import CurrentUser
from app.services import access

router = APIRouter(tags=["workflow"])


class StartIn(BaseModel):
    template_id: str
    assignees: dict[str, str] = Field(description='{"1": "<user_id>", "2": "<user_id>"}')


class DecideIn(BaseModel):
    decision: Literal["APROVADA", "REPROVADA"]
    note: str | None = None


async def _create_task(conn: Any, instance_id: str, template_id: str, step: int, assignee: str) -> None:
    await fetch_one(conn, """
        INSERT INTO workflow_task (instance_id, step_order, step_name, assignee_id, due_at)
        SELECT :i, s.step_order, s.name, :a, now() + make_interval(hours => s.sla_hours)
          FROM workflow_template_step s WHERE s.template_id = :t AND s.step_order = :n
        RETURNING id""", i=instance_id, a=assignee, t=template_id, n=step)


@router.post("/revisions/{revision_id}/workflow", status_code=201)
async def start(revision_id: str, body: StartIn, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    project_id = await access.project_of_revision(conn, revision_id)
    await access.require(conn, project_id, user, access.WRITE_ROLES)
    steps = await fetch_all(conn, """SELECT step_order, name, role_required FROM workflow_template_step
                                     WHERE template_id = :t ORDER BY step_order""", t=body.template_id)
    if not steps:
        raise DomainError("Modelo de workflow inexistente")
    for s in steps:
        uid = body.assignees.get(str(s["step_order"]))
        if not uid:
            raise DomainError(f"Defina o responsável da etapa {s['step_order']} ({s['name']})")
        r = await scalar(conn, "SELECT role FROM project_member WHERE project_id = :p AND user_id = :u",
                         p=project_id, u=uid)
        if r not in (s["role_required"], "ADMIN") and not (s["role_required"] == "REVISOR" and r == "CONTROLADOR"):
            raise DomainError(f"Responsável da etapa '{s['name']}' precisa do perfil {s['role_required']}")
    inst = await fetch_one(conn, """
        INSERT INTO workflow_instance (revision_id, template_id, started_by, assignees)
        VALUES (:r, :t, :u, CAST(:a AS jsonb)) RETURNING id::text""",
        r=revision_id, t=body.template_id, u=user.id, a=json.dumps(body.assignees))
    assert inst
    await fetch_one(conn, "UPDATE revision SET status = 'EM_VERIFICACAO' WHERE id = :r RETURNING id", r=revision_id)
    await _create_task(conn, inst["id"], body.template_id, 1, body.assignees["1"])
    return inst


@router.get("/tasks/mine")
async def my_tasks(conn: Conn, user: CurrentUser, status: str = "PENDENTE") -> list[dict[str, Any]]:
    return await fetch_all(conn, """
        SELECT k.id::text, k.step_name, k.step_order, k.status, k.due_at, k.created_at, k.due_at < now() AS overdue,
               r.id::text AS revision_id, r.label AS revision_label, d.id::text AS document_id, d.code, d.title,
               p.code AS project_code, wt.name AS template_name
          FROM workflow_task k
          JOIN workflow_instance wi ON wi.id = k.instance_id
          JOIN workflow_template wt ON wt.id = wi.template_id
          JOIN revision r ON r.id = wi.revision_id
          JOIN document d ON d.id = r.document_id JOIN project p ON p.id = d.project_id
         WHERE k.assignee_id = :u AND k.status = :s
         ORDER BY k.due_at""", u=user.id, s=status)


@router.post("/tasks/{task_id}/decide")
async def decide(task_id: str, body: DecideIn, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    task = await fetch_one(conn, """
        SELECT k.id::text, k.step_order, k.instance_id::text, wi.template_id::text, wi.revision_id::text,
               wi.assignees
          FROM workflow_task k JOIN workflow_instance wi ON wi.id = k.instance_id
         WHERE k.id = :k AND k.status = 'PENDENTE' FOR UPDATE OF k, wi""", k=task_id)
    if not task:
        raise DomainError("Tarefa inexistente ou já decidida", 404)
    # o banco garante quem decide (INV-WF-002), a segregação autor/aprovador (INV-WF-003)
    # e a justificativa em reprovação (INV-WF-001)
    await fetch_one(conn, """UPDATE workflow_task SET status = :s, decided_by = :u, decided_at = now(),
                             decision_note = :n WHERE id = :k RETURNING id""",
                    s=body.decision, u=user.id, n=body.note, k=task_id)
    if body.decision == "REPROVADA":
        await fetch_one(conn, """UPDATE workflow_instance SET status = 'REPROVADO', finished_at = now()
                                 WHERE id = :i RETURNING id""", i=task["instance_id"])
        await fetch_one(conn, "UPDATE revision SET status = 'EM_ELABORACAO' WHERE id = :r RETURNING id",
                        r=task["revision_id"])
        return {"instance": "REPROVADO"}
    nxt = task["step_order"] + 1
    exists = await scalar(conn, "SELECT 1 FROM workflow_template_step WHERE template_id = :t AND step_order = :n",
                          t=task["template_id"], n=nxt)
    if exists:
        await fetch_one(conn, "UPDATE workflow_instance SET current_step = :n WHERE id = :i RETURNING id",
                        n=nxt, i=task["instance_id"])
        await _create_task(conn, task["instance_id"], task["template_id"], nxt, task["assignees"][str(nxt)])
        return {"instance": "ATIVO", "step": nxt}
    await fetch_one(conn, """UPDATE workflow_instance SET status = 'CONCLUIDO', finished_at = now()
                             WHERE id = :i RETURNING id""", i=task["instance_id"])
    # INV-REV-006 / INV-REV-007 validados pelo constraint trigger
    await fetch_one(conn, "UPDATE revision SET status = 'APROVADA_INTERNA' WHERE id = :r RETURNING id",
                    r=task["revision_id"])
    return {"instance": "CONCLUIDO"}
