from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.db import fetch_one, open_tx
from app.core.security import (
    CurrentUser,
    PasswordChangeUser,
    hash_password,
    issue_token,
    password_problem,
    throttle,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# hash fixo para gastar o mesmo tempo quando o e-mail não existe (não revela quem tem conta)
_DUMMY_HASH = hash_password("conta-inexistente-gplansis")


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(max_length=512)


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    is_admin: bool
    must_change_password: bool = False


class LoginOut(BaseModel):
    token: str
    user: UserOut


class ChangePasswordIn(BaseModel):
    current_password: str = Field(max_length=512)
    new_password: str = Field(min_length=10, max_length=512)


def _client_ip(req: Request) -> str:
    fwd = req.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() or (req.client.host if req.client else "?")


@router.post("/login", response_model=LoginOut)
async def login(body: LoginIn, req: Request) -> LoginOut:
    email = body.email.strip().lower()
    keys = (f"e:{email}", f"i:{_client_ip(req)}")
    wait = throttle.retry_after(*keys)
    if wait:
        raise HTTPException(429, f"Muitas tentativas. Tente de novo em {max(1, wait // 60)} min.",
                            headers={"Retry-After": str(wait)})
    async for conn in open_tx():
        u = await fetch_one(conn, """SELECT id::text, email::text, name, is_admin, password_hash, is_active,
                                            must_change_password
                                     FROM app_user WHERE email = :e""", e=email)
    valid = verify_password(body.password, u["password_hash"] if u else _DUMMY_HASH)
    if not u or not u["is_active"] or not valid:
        throttle.fail(*keys)
        raise HTTPException(401, "E-mail ou senha incorretos")
    throttle.ok(keys[0])
    async for conn in open_tx(u["id"]):
        await fetch_one(conn, "UPDATE app_user SET last_login_at = now() WHERE id = CAST(:u AS uuid) RETURNING id",
                        u=u["id"])
    scope = "pwd" if u["must_change_password"] else "api"
    token = issue_token(u, ttl_minutes=15 if scope == "pwd" else None, scope=scope)
    return LoginOut(token=token, user=UserOut(**{k: u[k] for k in UserOut.model_fields}))


@router.post("/change-password", response_model=LoginOut)
async def change_password(body: ChangePasswordIn, user: PasswordChangeUser) -> LoginOut:
    if (problem := password_problem(body.new_password)):
        raise HTTPException(422, problem)
    if body.new_password == body.current_password:
        raise HTTPException(422, "A nova senha precisa ser diferente da atual")
    async for conn in open_tx(user.id):
        u = await fetch_one(conn, """SELECT id::text, email::text, name, is_admin, password_hash, is_active,
                                            floor(extract(epoch FROM password_changed_at))::bigint AS pwd_at
                                     FROM app_user WHERE id = CAST(:u AS uuid) FOR UPDATE""", u=user.id)
        if not u or not u["is_active"]:
            raise HTTPException(401, "Conta desativada")
        if u["pwd_at"] and user.iat < u["pwd_at"]:
            raise HTTPException(401, "Senha alterada — entre novamente")
        if not verify_password(body.current_password, u["password_hash"]):
            raise HTTPException(403, "Senha atual incorreta")
        await fetch_one(conn, """UPDATE app_user SET password_hash = :h, must_change_password = false,
                                        password_changed_at = now()
                                  WHERE id = CAST(:u AS uuid) RETURNING id""",
                        h=hash_password(body.new_password), u=user.id)
    assert u is not None
    u["must_change_password"] = False
    # sessões emitidas antes da troca caem (iat < password_changed_at, ver deps._conn)
    return LoginOut(token=issue_token(u), user=UserOut(**{k: u[k] for k in UserOut.model_fields}))


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> UserOut:
    return UserOut(id=user.id, email=user.email, name=user.name, is_admin=user.is_admin)


@router.post("/file-token")
async def file_token(user: CurrentUser) -> dict[str, str]:
    """Token curto (10 min) de escopo 'file' para <img>, visualizador de PDF e downloads."""
    return {"token": issue_token(user.model_dump(), ttl_minutes=10, scope="file")}
