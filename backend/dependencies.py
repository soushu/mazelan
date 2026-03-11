import uuid
from typing import Annotated

from fastapi import Depends
from fastapi_nextauth_jwt import NextAuthJWTv4

JWT = NextAuthJWTv4(
    csrf_prevention_enabled=False,
    cookie_name="__Secure-next-auth.session-token",
)


async def get_current_user_id(token: Annotated[dict, Depends(JWT)]) -> uuid.UUID:
    return uuid.UUID(token["id"])
