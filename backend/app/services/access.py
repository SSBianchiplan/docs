from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.db import scalar
from app.core.errors import DomainError
from app.core.security import Principal

WRITE_ROLES = ("ADMIN", "CONTROLADOR", "AUTOR")
CONTROL_ROLES = ("ADMIN", "CONTROLADOR")


async def project_role(conn: AsyncConnection, project_id: str, user: Principal) -> str | None:
    if user.is_admin:
        return "ADMIN"
    role = await scalar(conn, "SELECT role FROM project_member WHERE project_id = :p AND user_id = :u",
                        p=project_id, u=user.id)
    return str(role) if role else None


async def require(conn: AsyncConnection, project_id: str, user: Principal,
                  roles: tuple[str, ...] | None = None) -> str:
    role = await project_role(conn, project_id, user)
    if role is None:
        raise DomainError("Sem acesso a este projeto", 403)
    if roles and role not in roles:
        raise DomainError(f"Ação exige perfil {', '.join(roles)} (seu perfil: {role})", 403)
    return role


async def project_of_document(conn: AsyncConnection, document_id: str) -> str:
    p = await scalar(conn, "SELECT project_id::text FROM document WHERE id = :d", d=document_id)
    if not p:
        raise DomainError("Documento não encontrado", 404)
    return str(p)


async def project_of_revision(conn: AsyncConnection, revision_id: str) -> str:
    p = await scalar(conn, """SELECT d.project_id::text FROM revision r JOIN document d ON d.id = r.document_id
                              WHERE r.id = :r""", r=revision_id)
    if not p:
        raise DomainError("Revisão não encontrada", 404)
    return str(p)
