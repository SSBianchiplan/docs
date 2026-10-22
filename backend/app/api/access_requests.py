"""Solicitação de acesso (página pública) → fila do administrador → conta criada só com decisão humana."""
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from app.api.deps import Conn
from app.api.projects import _require_admin, _temp_password
from app.core.db import fetch_all, fetch_one, open_tx, scalar
from app.core.errors import DomainError
from app.core.security import CurrentUser, LoginThrottle, hash_password

router = APIRouter(tags=["acesso"])
_limit = LoginThrottle(max_fail=5, window_s=3600)       # 5 pedidos por IP por hora


class RequestIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    company: str | None = Field(default=None, max_length=160)
    message: str | None = Field(default=None, max_length=2000)
    website: str | None = None      # honeypot: humano não vê o campo, robô preenche


class DecideIn(BaseModel):
    decision: Literal["APROVADA", "RECUSADA"]
    is_external: bool = False


@router.post("/access-requests", status_code=202)
async def create_request(body: RequestIn, req: Request) -> dict[str, str]:
    ip = (req.headers.get("x-forwarded-for", "").split(",")[0].strip()
          or (req.client.host if req.client else "?"))
    if _limit.retry_after(f"i:{ip}"):
        raise HTTPException(429, "Muitas solicitações deste endereço. Tente mais tarde.")
    _limit.fail(f"i:{ip}")
    if body.website:                 # robô: responde igual, não grava
        return {"status": "recebida"}
    email = str(body.email).lower()
    async for conn in open_tx():
        if await scalar(conn, "SELECT 1 FROM app_user WHERE email = :e", e=email):
            return {"status": "recebida"}          # não revela quem já tem conta
        await fetch_one(conn, """
            INSERT INTO access_request (name, email, company, message) VALUES (:n, :e, :c, :m)
            ON CONFLICT (email) WHERE status = 'PENDENTE'
            DO UPDATE SET name = EXCLUDED.name, company = EXCLUDED.company, message = EXCLUDED.message
            RETURNING id""", n=body.name.strip(), e=email, c=body.company, m=body.message)
    return {"status": "recebida"}


@router.get("/access-requests")
async def list_requests(conn: Conn, user: CurrentUser, status: str = "PENDENTE") -> list[dict[str, Any]]:
    _require_admin(user)
    return await fetch_all(conn, """
        SELECT a.id::text, a.name, a.email::text, a.company, a.message, a.status, a.created_at, a.decided_at,
               u.name AS decided_by_name
          FROM access_request a LEFT JOIN app_user u ON u.id = a.decided_by
         WHERE a.status = :s ORDER BY a.created_at DESC LIMIT 200""", s=status)


@router.post("/access-requests/{request_id}/decide")
async def decide(request_id: str, body: DecideIn, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    _require_admin(user)
    r = await fetch_one(conn, """SELECT id::text, name, email::text, company FROM access_request
                                 WHERE id = CAST(:i AS uuid) AND status = 'PENDENTE' FOR UPDATE""", i=request_id)
    if not r:
        raise DomainError("Solicitação inexistente ou já decidida", 404)
    out: dict[str, Any] = {"status": body.decision}
    new_user = None
    if body.decision == "APROVADA":
        if await scalar(conn, "SELECT 1 FROM app_user WHERE email = :e", e=r["email"]):
            raise DomainError("Já existe usuário com este e-mail", 409)
        pw = _temp_password()
        row = await fetch_one(conn, """
            INSERT INTO app_user (email, name, company, password_hash, is_external, must_change_password)
            VALUES (:e, :n, :c, :h, :x, true) RETURNING id::text""",
            e=r["email"], n=r["name"], c=r["company"], h=hash_password(pw), x=body.is_external)
        assert row
        new_user = row["id"]
        out.update(user_id=new_user, email=r["email"], temporary_password=pw)
    await fetch_one(conn, """UPDATE access_request SET status = :s, decided_by = CAST(:u AS uuid), decided_at = now(),
                                    user_id = CAST(:nu AS uuid)
                              WHERE id = CAST(:i AS uuid) RETURNING id""",
                    s=body.decision, u=user.id, nu=new_user, i=request_id)
    return out
