import os

from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session as DBSession
from passlib.context import CryptContext

from backend.database import get_db
from backend.models import User
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")

router = APIRouter(prefix="/auth", tags=["auth"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class UpsertUserRequest(BaseModel):
    email: str
    name: str | None = None
    google_id: str | None = None


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/upsert-user")
def upsert_user(
    req: UpsertUserRequest,
    db: DBSession = Depends(get_db),
    x_internal_api_key: str = Header(alias="X-Internal-API-Key", default=""),
):
    """Google OAuth 初回ログイン時にユーザーをDB作成/更新し、DB UUID を返す。"""
    if not INTERNAL_API_KEY or x_internal_api_key != INTERNAL_API_KEY:
        raise HTTPException(status_code=403, detail="Forbidden")
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


@router.post("/register")
@limiter.limit("3/minute")
def register(request: Request, req: RegisterRequest, db: DBSession = Depends(get_db)):
    """メール/パスワードで新規ユーザー登録。"""
    existing = db.query(User).filter(User.email == req.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        email=req.email,
        name=req.name or req.email.split("@")[0],
        password_hash=pwd_context.hash(req.password),
        auth_provider="email",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"id": str(user.id), "email": user.email, "name": user.name}


@router.post("/login")
@limiter.limit("5/minute")
def login(request: Request, req: LoginRequest, db: DBSession = Depends(get_db)):
    """CredentialsProvider から呼ばれる。email+password を検証する。"""
    user = db.query(User).filter(User.email == req.email).first()

    if not user or not user.password_hash:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not pwd_context.verify(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return {"id": str(user.id), "email": user.email, "name": user.name}
