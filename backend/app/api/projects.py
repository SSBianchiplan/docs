import secrets
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, EmailStr, Field

from app.api.deps import Conn
from app.core.config import get_settings
from app.core.db import fetch_all, fetch_one, scalar
from app.core.errors import DomainError
from app.core.security import CurrentUser, Principal, hash_password, password_problem
from app.services import access

router = APIRouter(tags=["projetos"])


class MemberIn(BaseModel):
    user_id: str
    role: str = Field(pattern=r"^(ADMIN|CONTROLADOR|AUTOR|REVISOR|LEITOR|EXTERNO)$")


class UserIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=2, max_length=120)
    password: str | None = Field(default=None, max_length=512)   # vazio = senha temporária gerada
    company: str | None = None
    is_admin: bool = False
    is_external: bool = False
    project_ids: list[str] = []
    project_role: str = Field(default="LEITOR", pattern=r"^(ADMIN|CONTROLADOR|AUTOR|REVISOR|LEITOR|EXTERNO)$")


class UserPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    company: str | None = None
    is_admin: bool | None = None
    is_external: bool | None = None
    is_active: bool | None = None


@router.get("/projects")
async def list_projects(conn: Conn, user: CurrentUser, archived: bool = False) -> list[dict[str, Any]]:
    return await fetch_all(conn, """
        SELECT p.id::text, p.code, p.name, p.client, p.code_mask, p.require_workflow, p.active,
               p.start_date, p.end_date, p.location, p.revision_scheme, p.default_confidentiality,
               p.default_template_id::text, p.client IS NOT NULL AS has_client,
               coalesce(m.role, CASE WHEN :adm THEN 'ADMIN' END) AS my_role,
               s.documents, s.issued, s.late,
               (CASE WHEN s.weight > 0 THEN round(100 * s.issued_weight / s.weight, 1) ELSE 0 END)::float8 AS progress_pct,
               (SELECT count(*) FROM project_member pm WHERE pm.project_id = p.id) AS members,
               EXISTS (SELECT 1 FROM project_area a WHERE a.project_id = p.id) AS has_areas
          FROM project p
          LEFT JOIN project_member m ON m.project_id = p.id AND m.user_id = :u
          LEFT JOIN LATERAL (
               SELECT count(*) AS documents, coalesce(sum(v.weight), 0) AS weight,
                      count(*) FILTER (WHERE v.first_issued_at IS NOT NULL) AS issued,
                      coalesce(sum(v.weight) FILTER (WHERE v.first_issued_at IS NOT NULL), 0) AS issued_weight,
                      count(*) FILTER (WHERE v.planned_issue_date < current_date AND v.first_issued_at IS NULL) AS late
                 FROM v_master_list v WHERE v.project_id = p.id) s ON true
         WHERE (p.active OR :arch) AND (:adm OR m.user_id IS NOT NULL)
         ORDER BY p.active DESC, p.code""", u=user.id, adm=user.is_admin, arch=archived)


@router.get("/projects/{project_id}/members")
async def members(project_id: str, conn: Conn, user: CurrentUser) -> list[dict[str, Any]]:
    await access.require(conn, project_id, user)
    return await fetch_all(conn, """
        SELECT u.id::text, u.name, u.email::text, u.company, m.role
          FROM project_member m JOIN app_user u ON u.id = m.user_id
         WHERE m.project_id = :p ORDER BY u.name""", p=project_id)


@router.put("/projects/{project_id}/members", status_code=204)
async def upsert_member(project_id: str, body: MemberIn, conn: Conn, user: CurrentUser) -> None:
    await access.require(conn, project_id, user, access.CONTROL_ROLES)
    await fetch_one(conn, """
        INSERT INTO project_member (project_id, user_id, role) VALUES (:p, :u, :r)
        ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role RETURNING role""",
        p=project_id, u=body.user_id, r=body.role)


@router.delete("/projects/{project_id}/members/{user_id}", status_code=204)
async def remove_member(project_id: str, user_id: str, conn: Conn, user: CurrentUser) -> None:
    await access.require(conn, project_id, user, access.CONTROL_ROLES)
    if user_id == user.id and not user.is_admin:
        raise DomainError("Você não pode se remover da equipe", 403)
    await fetch_one(conn, """DELETE FROM project_member WHERE project_id = CAST(:p AS uuid)
                             AND user_id = CAST(:u AS uuid) RETURNING user_id""", p=project_id, u=user_id)


@router.get("/catalog")
async def catalog(conn: Conn) -> dict[str, Any]:
    return {
        "disciplines": await fetch_all(conn, "SELECT code, name FROM discipline ORDER BY code"),
        "doc_types": await fetch_all(conn, "SELECT code, name, metadata_schema FROM doc_type ORDER BY code"),
        "workflow_templates": await fetch_all(conn, """
            SELECT t.id::text, t.name, t.project_id::text,
                   json_agg(json_build_object('step_order', s.step_order, 'name', s.name,
                            'role_required', s.role_required, 'sla_hours', s.sla_hours)
                            ORDER BY s.step_order) AS steps
              FROM workflow_template t JOIN workflow_template_step s ON s.template_id = t.id
             WHERE t.active GROUP BY t.id ORDER BY t.project_id NULLS FIRST, t.name"""),
        "areas": await fetch_all(conn, "SELECT project_id::text, code, name FROM project_area ORDER BY project_id, code"),
        "project_disciplines": await fetch_all(conn, """SELECT project_id::text, discipline_code AS code
                                                        FROM project_discipline ORDER BY 1, 2"""),
    }


def _master() -> str:
    return get_settings().bootstrap_admin_email.strip().lower()


def _require_admin(user: Principal) -> None:
    if not user.is_admin:
        raise DomainError("Somente administradores", 403)


def _temp_password() -> str:
    # 3 blocos legíveis (sem 0/O/1/l) + dígitos: fácil de ditar, ~70 bits
    alpha = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"
    return "-".join("".join(secrets.choice(alpha) for _ in range(4)) for _ in range(3)) + str(secrets.randbelow(90) + 10)


@router.get("/users")
async def list_users(conn: Conn, user: CurrentUser) -> list[dict[str, Any]]:
    _require_admin(user)
    return await fetch_all(conn, """
        SELECT u.id::text, u.name, u.email::text, u.company, u.is_admin, u.is_external, u.is_active,
               u.must_change_password, u.last_login_at, u.created_at, lower(u.email::text) = :m AS is_master,
               (SELECT count(*) FROM project_member pm WHERE pm.user_id = u.id) AS projects
          FROM app_user u ORDER BY u.is_active DESC, u.name""", m=_master())


@router.post("/users", status_code=201)
async def create_user(body: UserIn, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    _require_admin(user)
    pw = body.password or _temp_password()
    if body.password and (problem := password_problem(body.password)):
        raise DomainError(problem, 422)
    exists = await scalar(conn, "SELECT 1 FROM app_user WHERE email = :e", e=body.email.lower())
    if exists:
        raise DomainError("Já existe usuário com este e-mail", 409)
    row = await fetch_one(conn, """
        INSERT INTO app_user (email, name, company, password_hash, is_admin, is_external, must_change_password)
        VALUES (:e, :n, :c, :h, :a, :x, true) RETURNING id::text, name, email::text""",
        e=body.email.lower(), n=body.name.strip(), c=body.company, h=hash_password(pw),
        a=body.is_admin, x=body.is_external)
    assert row
    for pid in body.project_ids:
        await fetch_one(conn, """INSERT INTO project_member (project_id, user_id, role)
                                 VALUES (CAST(:p AS uuid), CAST(:u AS uuid), :r)
                                 ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role
                                 RETURNING role""", p=pid, u=row["id"], r=body.project_role)
    # a senha temporária aparece uma única vez, para o administrador repassar
    return {**row, "temporary_password": pw}


@router.patch("/users/{user_id}")
async def patch_user(user_id: str, body: UserPatch, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    _require_admin(user)
    target = await fetch_one(conn, "SELECT id::text, lower(email::text) AS email FROM app_user WHERE id = CAST(:u AS uuid)",
                             u=user_id)
    if not target:
        raise DomainError("Usuário não encontrado", 404)
    fields = body.model_dump(exclude_unset=True)
    demote = fields.get("is_admin") is False or fields.get("is_active") is False
    if demote and target["email"] == _master():
        raise DomainError("O administrador master não pode ser rebaixado nem desativado", 403)
    if demote and target["id"] == user.id:
        raise DomainError("Você não pode remover o próprio acesso de administrador", 403)
    if not fields:
        return {"id": user_id}
    sets = ", ".join(f"{k} = :{k}" for k in fields)
    await fetch_one(conn, f"UPDATE app_user SET {sets} WHERE id = CAST(:id AS uuid) RETURNING id",
                    id=user_id, **fields)
    return {"id": user_id}


@router.post("/users/{user_id}/reset-password")
async def reset_password(user_id: str, conn: Conn, user: CurrentUser) -> dict[str, str]:
    """Gera senha temporária, derruba as sessões abertas e exige troca no próximo acesso."""
    _require_admin(user)
    target = await scalar(conn, "SELECT lower(email::text) FROM app_user WHERE id = CAST(:u AS uuid)", u=user_id)
    if not target:
        raise DomainError("Usuário não encontrado", 404)
    if target == _master() and user.email.lower() != _master():
        raise DomainError("Só o próprio administrador master redefine a senha dele", 403)
    pw = _temp_password()
    await fetch_one(conn, """UPDATE app_user SET password_hash = :h, must_change_password = true,
                                    password_changed_at = now()
                              WHERE id = CAST(:u AS uuid) RETURNING id""", h=hash_password(pw), u=user_id)
    return {"temporary_password": pw}
