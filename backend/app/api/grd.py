from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.api.deps import Conn
from app.core.db import fetch_all, fetch_one, scalar
from app.core.errors import DomainError
from app.core.security import CurrentUser
from app.services import access

router = APIRouter(prefix="/grds", tags=["GRD"])


class GrdIn(BaseModel):
    project_id: str
    recipient: str = Field(min_length=2)
    recipient_email: str | None = None
    purpose: Literal["PI", "PA", "PC", "CE", "CA"]
    notes: str | None = None


class ItemsIn(BaseModel):
    revision_ids: list[str] = Field(min_length=1)
    media: Literal["DIGITAL", "IMPRESSO", "AMBOS"] = "DIGITAL"
    copies: int = Field(1, ge=1, le=99)


class ReceiveIn(BaseModel):
    received_by: str = Field(min_length=2)


async def _grd_project(conn: Any, grd_id: str) -> str:
    p = await scalar(conn, "SELECT project_id::text FROM grd WHERE id = :g", g=grd_id)
    if not p:
        raise DomainError("GRD não encontrada", 404)
    return str(p)


@router.get("")
async def list_grds(conn: Conn, user: CurrentUser, project_id: str | None = None,
                    status: str | None = None) -> list[dict[str, Any]]:
    return await fetch_all(conn, """
        SELECT g.id::text, g.number, p.code AS project_code,
               CASE WHEN g.number IS NULL THEN NULL
                    ELSE 'GRD-' || p.code || '-' || lpad(g.number::text, 4, '0') END AS code,
               g.recipient, g.purpose, g.status, g.created_at, g.issued_at, g.received_at,
               (SELECT count(*) FROM grd_item i WHERE i.grd_id = g.id) AS items
          FROM grd g JOIN project p ON p.id = g.project_id
         WHERE (:adm OR EXISTS (SELECT 1 FROM project_member m WHERE m.project_id = g.project_id AND m.user_id = :u))
           AND (CAST(:p AS uuid) IS NULL OR g.project_id = CAST(:p AS uuid))
           AND (CAST(:s AS text) IS NULL OR g.status = CAST(:s AS text))
         ORDER BY g.created_at DESC LIMIT 500""", u=user.id, adm=user.is_admin, p=project_id, s=status)


@router.post("", status_code=201)
async def create_grd(body: GrdIn, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    await access.require(conn, body.project_id, user, access.CONTROL_ROLES)
    row = await fetch_one(conn, """
        INSERT INTO grd (project_id, recipient, recipient_email, purpose, notes, created_by)
        VALUES (:p, :r, :e, :pu, :n, :u) RETURNING id::text, status""",
        p=body.project_id, r=body.recipient, e=body.recipient_email, pu=body.purpose, n=body.notes, u=user.id)
    assert row
    return row


@router.get("/{grd_id}")
async def get_grd(grd_id: str, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    await access.require(conn, await _grd_project(conn, grd_id), user)
    head = await fetch_one(conn, """
        SELECT g.id::text, g.project_id::text, p.code AS project_code, p.name AS project_name, p.client,
               g.number, CASE WHEN g.number IS NULL THEN NULL
                              ELSE 'GRD-' || p.code || '-' || lpad(g.number::text, 4, '0') END AS code,
               g.recipient, g.recipient_email, g.purpose, g.status, g.notes, g.created_at, g.issued_at,
               g.received_at, g.received_by, g.manifest_sha256, ui.name AS issued_by_name
          FROM grd g JOIN project p ON p.id = g.project_id LEFT JOIN app_user ui ON ui.id = g.issued_by
         WHERE g.id = :g""", g=grd_id)
    items = await fetch_all(conn, """
        SELECT i.revision_id::text, i.copies, i.media, d.id::text AS document_id, d.code, d.title,
               r.label, r.status, r.purpose, d.discipline_code, d.doc_type_code,
               (SELECT string_agg(f.filename, ', ') FROM revision_file f WHERE f.revision_id = r.id) AS files
          FROM grd_item i JOIN revision r ON r.id = i.revision_id JOIN document d ON d.id = r.document_id
         WHERE i.grd_id = :g ORDER BY d.code""", g=grd_id)
    return {"grd": head, "items": items}


@router.post("/{grd_id}/items", status_code=201)
async def add_items(grd_id: str, body: ItemsIn, conn: Conn, user: CurrentUser) -> dict[str, int]:
    await access.require(conn, await _grd_project(conn, grd_id), user, access.CONTROL_ROLES)
    n = 0
    for rid in body.revision_ids:
        # INV-GRD-002/003 verificados no trigger
        r = await fetch_one(conn, """INSERT INTO grd_item (grd_id, revision_id, copies, media)
                                     VALUES (:g, :r, :c, :m) ON CONFLICT DO NOTHING RETURNING revision_id""",
                            g=grd_id, r=rid, c=body.copies, m=body.media)
        n += 1 if r else 0
    return {"added": n}


@router.delete("/{grd_id}/items/{revision_id}", status_code=204)
async def remove_item(grd_id: str, revision_id: str, conn: Conn, user: CurrentUser) -> None:
    await access.require(conn, await _grd_project(conn, grd_id), user, access.CONTROL_ROLES)
    await fetch_one(conn, "DELETE FROM grd_item WHERE grd_id = :g AND revision_id = :r RETURNING grd_id",
                    g=grd_id, r=revision_id)


@router.post("/{grd_id}/issue")
async def issue(grd_id: str, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    await access.require(conn, await _grd_project(conn, grd_id), user, access.CONTROL_ROLES)
    n = await scalar(conn, "SELECT fn_grd_emitir(:g, :u)", g=grd_id, u=user.id)
    return {"number": n, "status": "EMITIDA"}


@router.post("/{grd_id}/receive")
async def receive(grd_id: str, body: ReceiveIn, conn: Conn, user: CurrentUser) -> dict[str, str]:
    await access.require(conn, await _grd_project(conn, grd_id), user, access.CONTROL_ROLES)
    r = await fetch_one(conn, """UPDATE grd SET status = 'RECEBIDA', received_by = :rb, received_at = now()
                                 WHERE id = :g AND status = 'EMITIDA' RETURNING id""", g=grd_id, rb=body.received_by)
    if not r:
        raise DomainError("Só GRD emitida pode ter recebimento registrado", 409)
    return {"status": "RECEBIDA"}


@router.post("/{grd_id}/cancel")
async def cancel(grd_id: str, conn: Conn, user: CurrentUser) -> dict[str, str]:
    await access.require(conn, await _grd_project(conn, grd_id), user, access.CONTROL_ROLES)
    await fetch_one(conn, "UPDATE grd SET status = 'CANCELADA' WHERE id = :g RETURNING id", g=grd_id)
    return {"status": "CANCELADA"}
