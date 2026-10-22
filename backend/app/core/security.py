import hashlib
import hmac
import time
from collections import deque
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.core.config import get_settings

_ph = PasswordHasher()
_bearer = HTTPBearer(auto_error=False)


class Principal(BaseModel):
    id: str
    email: str
    name: str
    is_admin: bool
    iat: int = 0


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, pw)
    except (VerifyMismatchError, VerificationError):
        return False


def password_problem(pw: str) -> str | None:
    """Política mínima: 10+ caracteres com letras e números (ou 16+ de qualquer tipo)."""
    if len(pw) < 10:
        return "A senha precisa de pelo menos 10 caracteres"
    if len(pw) < 16 and not (any(c.isalpha() for c in pw) and any(c.isdigit() for c in pw)):
        return "Use letras e números (ou uma frase com 16+ caracteres)"
    return None


def issue_token(user: dict[str, Any], ttl_minutes: int | None = None, scope: str = "api") -> str:
    """Escopos: api (sessão), file (<img>/visualizador, curto), pwd (só troca de senha obrigatória)."""
    s = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": str(user["id"]), "email": user["email"], "name": user["name"],
        "adm": bool(user["is_admin"]), "scp": scope, "iat": int(now.timestamp()),
        "exp": now + timedelta(minutes=ttl_minutes or s.jwt_ttl_minutes),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256")


def _decode(raw: str) -> dict[str, Any]:
    try:
        return jwt.decode(raw, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão inválida ou expirada") from e


def _principal(p: dict[str, Any]) -> Principal:
    return Principal(id=p["sub"], email=p["email"], name=p["name"], is_admin=p["adm"], iat=int(p.get("iat", 0)))


def chave_integracao(finalidade: str, sistema: str = "drawings") -> bytes | None:
    """Subchave derivada do segredo compartilhado com o sistema integrado ('api', 'sso', 'webhook').
    Cada sistema (GPlanSiS|Drawings, GPlanSiS|Writer, GPlanSiS|Sheets) tem o próprio segredo."""
    s = get_settings()
    seg = {"drawings": s.integracao_drawings_segredo, "writer": s.integracao_writer_segredo,
           "sheets": s.integracao_sheets_segredo}.get(sistema)
    if not seg:
        return None
    return hmac.new(seg.encode(), finalidade.encode(), hashlib.sha256).digest()


async def _principal_integracao(chave: str, email: str) -> Principal:
    """Chamada do servidor de um sistema integrado em nome de um usuário: valida a chave e devolve o usuário real.
    As regras de papel por projeto, a trava de autoria e a auditoria valem como se ele estivesse logado."""
    if not any((k := chave_integracao("api", sis)) and hmac.compare_digest(chave.encode(), k.hex().encode())
               for sis in ("drawings", "writer", "sheets")):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Chave de integração inválida")
    from app.core.db import engine, fetch_one  # import tardio: db depende de config, não de security
    async with engine().connect() as conn:
        u = await fetch_one(conn, "SELECT id::text, email::text, name, is_admin, is_active FROM app_user WHERE email = :e",
                            e=email.strip().lower())
    if not u or not u["is_active"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"{email} não tem conta ativa no GPlanSiS|Docs")
    return Principal(id=u["id"], email=u["email"], name=u["name"], is_admin=u["is_admin"], iat=0)


async def current_user(
    request: Request,
    cred: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    token: str | None = None,
) -> Principal:
    integ = request.headers.get("x-integracao")
    if integ:
        return await _principal_integracao(integ, request.headers.get("x-em-nome-de", ""))
    # Bearer só aceita sessão (api); ?token= só aceita escopo "file" (curto, para <img>/visualizador)
    if cred:
        p = _decode(cred.credentials)
        if p.get("scp") == "pwd":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Troque a senha para continuar")
        if p.get("scp") != "api":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão inválida")
    elif token:
        p = _decode(token)
        if p.get("scp") != "file":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token de arquivo inválido")
    else:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão ausente")
    return _principal(p)


def password_change_user(cred: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]) -> Principal:
    """Aceita sessão normal ou o token restrito emitido quando a troca é obrigatória."""
    if not cred:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão ausente")
    p = _decode(cred.credentials)
    if p.get("scp") not in ("api", "pwd"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão inválida")
    return _principal(p)


CurrentUser = Annotated[Principal, Depends(current_user)]
PasswordChangeUser = Annotated[Principal, Depends(password_change_user)]


class LoginThrottle:
    """Janela deslizante por e-mail e por IP: após N falhas em 15 min, novas tentativas são recusadas.
    Em memória por processo — suficiente para travar força bruta; não substitui WAF."""

    def __init__(self, max_fail: int = 8, window_s: int = 900) -> None:
        self.max_fail, self.window_s = max_fail, window_s
        self._fails: dict[str, deque[float]] = {}

    def _recent(self, key: str) -> deque[float]:
        q = self._fails.setdefault(key, deque())
        cutoff = time.monotonic() - self.window_s
        while q and q[0] < cutoff:
            q.popleft()
        return q

    def retry_after(self, *keys: str) -> int:
        worst = 0
        for k in keys:
            q = self._recent(k)
            if len(q) >= self.max_fail:
                worst = max(worst, int(q[0] + self.window_s - time.monotonic()) + 1)
        return worst

    def fail(self, *keys: str) -> None:
        for k in keys:
            self._recent(k).append(time.monotonic())
        if len(self._fails) > 50_000:            # não deixa a tabela crescer sem limite
            self._fails = {k: v for k, v in self._fails.items() if v}

    def ok(self, *keys: str) -> None:
        for k in keys:
            self._fails.pop(k, None)


throttle = LoginThrottle()
