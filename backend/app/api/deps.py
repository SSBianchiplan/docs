from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.db import fetch_one, open_tx
from app.core.security import CurrentUser


async def _conn(user: CurrentUser) -> AsyncIterator[AsyncConnection]:
    async for c in open_tx(user.id):
        # a conta vale mais que o token: desativação, troca de senha e perfil de admin valem na hora
        u = await fetch_one(c, """SELECT is_active, is_admin, must_change_password,
                                         floor(extract(epoch FROM password_changed_at))::bigint AS pwd_at
                                    FROM app_user WHERE id = CAST(:u AS uuid)""", u=user.id)
        if not u or not u["is_active"]:
            raise HTTPException(401, "Conta desativada ou inexistente")
        if u["pwd_at"] and user.iat and user.iat < u["pwd_at"]:
            raise HTTPException(401, "Senha alterada — entre novamente")
        if u["must_change_password"]:
            raise HTTPException(403, "Troque a senha para continuar")
        user.is_admin = bool(u["is_admin"])
        yield c


Conn = Annotated[AsyncConnection, Depends(_conn)]
