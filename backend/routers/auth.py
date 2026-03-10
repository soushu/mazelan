import os
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session as DBSession
from passlib.context import CryptContext

from backend.database import get_db
from backend.models import User

router = APIRouter(prefix="/auth", tags=["auth"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALLOWED_EMAIL = os.getenv("ALLOWED_EMAIL", "")


class UpsertUserRequest(BaseModel):
    email: str
    name: str | None = None
    google_id: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/upsert-user")
def upsert_user(req: UpsertUserRequest, db: DBSession = Depends(get_db)):
    """Google OAuth 初回ログイン時にユーザーをDB作成/更新し、DB UUID を返す。"""
    user = db.query(User).filter(User.email == req.email).first()

    if user:
        if req.google_id and not user.google_id:
            user.google_id = req.google_id
        if req.name:
            user.name = req.name
        db.commit()
        db.refresh(user)
    else:
        user = User(
            email=req.email,
            name=req.name,
            google_id=req.google_id,
            auth_provider="google",
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return {"id": str(user.id), "email": user.email, "name": user.name}


@router.post("/login")
def login(req: LoginRequest, db: DBSession = Depends(get_db)):
    """CredentialsProvider から呼ばれる。email+password を検証する。"""
    user = db.query(User).filter(User.email == req.email).first()

    if not user or not user.password_hash:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not pwd_context.verify(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return {"id": str(user.id), "email": user.email, "name": user.name}
