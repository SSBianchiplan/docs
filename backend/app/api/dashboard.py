from typing import Any

from fastapi import APIRouter

from app.api.deps import Conn
from app.core.db import fetch_all, fetch_one
from app.core.security import CurrentUser

router = APIRouter(tags=["painel"])

_ACL = "(:adm OR EXISTS (SELECT 1 FROM project_member m WHERE m.project_id = d.project_id AND m.user_id = :u))"


@router.get("/dashboard")
async def dashboard(conn: Conn, user: CurrentUser, project_id: str | None = None) -> dict[str, Any]:
    p = {"u": user.id, "adm": user.is_admin, "p": project_id}
    proj = "AND (CAST(:p AS uuid) IS NULL OR d.project_id = CAST(:p AS uuid))"
    by_status = await fetch_all(conn, f"""
        SELECT coalesce(r.status, 'SEM_REVISAO') AS status, count(*) AS n
          FROM document d LEFT JOIN revision r ON r.document_id = d.id AND r.is_current
         WHERE {_ACL} {proj} GROUP BY 1 ORDER BY 2 DESC""", **p)
    by_discipline = await fetch_all(conn, f"""
        SELECT d.discipline_code AS discipline, count(*) AS n FROM document d
         WHERE {_ACL} {proj} GROUP BY 1 ORDER BY 2 DESC""", **p)
    emissions = await fetch_all(conn, f"""
        SELECT to_char(w, 'IYYY-"S"IW') AS week, coalesce(n, 0) AS n
          FROM generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()),
                               interval '1 week') w
          LEFT JOIN (SELECT date_trunc('week', r.issued_at) AS wk, count(*) AS n
                       FROM revision r JOIN document d ON d.id = r.document_id
                      WHERE r.issued_at IS NOT NULL AND {_ACL} {proj} GROUP BY 1) e ON e.wk = w
         ORDER BY w""", **p)
    counters = await fetch_one(conn, f"""
        SELECT
          (SELECT count(*) FROM document d WHERE {_ACL} {proj}) AS documents,
          (SELECT count(*) FROM workflow_task k WHERE k.assignee_id = :u AND k.status = 'PENDENTE') AS my_tasks,
          (SELECT count(*) FROM workflow_task k WHERE k.assignee_id = :u AND k.status = 'PENDENTE'
              AND k.due_at < now()) AS my_overdue,
          (SELECT count(*) FROM grd g WHERE g.status = 'EMITIDA'
              AND (CAST(:p AS uuid) IS NULL OR g.project_id = CAST(:p AS uuid))) AS grds_awaiting_receipt,
          (SELECT count(*) FROM revision_comment c JOIN revision r ON r.id = c.revision_id
              JOIN document d ON d.id = r.document_id
            WHERE c.status = 'ABERTO' AND c.category = 'OBRIGATORIO' AND {_ACL} {proj}) AS mandatory_open,
          (SELECT count(*) FROM file_text t WHERE t.status IN ('PENDENTE','PROCESSANDO')) AS ocr_queue,
          (SELECT count(*) FROM file_text t WHERE t.status = 'FALHOU') AS ocr_failed,
          (SELECT count(*) FROM ai_suggestion s WHERE s.status = 'PROPOSTA') AS ai_pending""", **p)
    overdue = await fetch_all(conn, f"""
        SELECT k.id::text, k.step_name, k.due_at, ua.name AS assignee, d.id::text AS document_id, d.code,
               r.label AS revision_label
          FROM workflow_task k JOIN workflow_instance wi ON wi.id = k.instance_id
          JOIN revision r ON r.id = wi.revision_id JOIN document d ON d.id = r.document_id
          JOIN app_user ua ON ua.id = k.assignee_id
         WHERE k.status = 'PENDENTE' AND k.due_at < now() AND {_ACL} {proj}
         ORDER BY k.due_at LIMIT 10""", **p)
    recent = await fetch_all(conn, f"""
        SELECT d.id::text AS document_id, d.code, d.title, r.label, r.status, r.created_at
          FROM revision r JOIN document d ON d.id = r.document_id
         WHERE {_ACL} {proj} ORDER BY r.created_at DESC LIMIT 8""", **p)
    return {"counters": counters, "by_status": by_status, "by_discipline": by_discipline,
            "emissions": emissions, "overdue": overdue, "recent": recent}
