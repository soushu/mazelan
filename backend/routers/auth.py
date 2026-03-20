import hashlib
import hmac
import os
import time
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Header, Request
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session as DBSession
from passlib.context import CryptContext

from backend.database import get_db
from backend.dependencies import get_current_user_id
from backend.models import User, ChatSession, Message, Context
from backend.slack_notify import notify_new_user
from backend.email_sender import send_password_reset
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

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("パスワードは8文字以上で入力してください。")
        if not any(c.isupper() for c in v):
            raise ValueError("パスワードには大文字を含めてください。")
        if not any(c.isdigit() for c in v):
            raise ValueError("パスワードには数字を含めてください。")
        return v


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/upsert-user")
@limiter.limit("10/minute")
def upsert_user(
    request: Request,
    req: UpsertUserRequest,
    background_tasks: BackgroundTasks,
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
        background_tasks.add_task(notify_new_user, req.email, "google")

    return {"id": str(user.id), "email": user.email, "name": user.name}


@router.post("/register")
@limiter.limit("3/minute")
def register(request: Request, req: RegisterRequest, background_tasks: BackgroundTasks, db: DBSession = Depends(get_db)):
    """メール/パスワードで新規ユーザー登録。"""
    existing = db.query(User).filter(User.email == req.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="このメールアドレスは既に登録されています。")

    user = User(
        email=req.email,
        name=req.name or req.email.split("@")[0],
        password_hash=pwd_context.hash(req.password),
        auth_provider="email",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    background_tasks.add_task(notify_new_user, req.email, "email")
    return {"id": str(user.id), "email": user.email, "name": user.name}


@router.post("/login")
@limiter.limit("3/minute")
def login(request: Request, req: LoginRequest, db: DBSession = Depends(get_db)):
    """CredentialsProvider から呼ばれる。email+password を検証する。"""
    user = db.query(User).filter(User.email == req.email).first()

    if not user or not user.password_hash:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not pwd_context.verify(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return {"id": str(user.id), "email": user.email, "name": user.name}


@router.delete("/account")
@limiter.limit("3/minute")
def delete_account(
    request: Request,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: DBSession = Depends(get_db),
):
    """ユーザーアカウントと関連データを全て削除。"""
    user = db.query(User).filter(User.id == current_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Delete all user data: contexts → messages → sessions → user
    db.query(Context).filter(Context.user_id == current_user_id).delete()
    sessions = db.query(ChatSession).filter(ChatSession.user_id == current_user_id).all()
    for session in sessions:
        db.query(Message).filter(Message.session_id == session.id).delete()
    db.query(ChatSession).filter(ChatSession.user_id == current_user_id).delete()
    db.delete(user)
    db.commit()
    return {"detail": "Account deleted"}


# ── Password Reset ──────────────────────────────────

RESET_SECRET = os.getenv("NEXTAUTH_SECRET", "fallback-secret-key")
RESET_TTL = 3600  # 1 hour
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")


def _make_reset_token(user_id: str, email: str) -> str:
    """Create HMAC-signed reset token: user_id:timestamp:signature."""
    ts = str(int(time.time()))
    payload = f"{user_id}:{email}:{ts}"
    sig = hmac.new(RESET_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{user_id}:{ts}:{sig}"


def _verify_reset_token(token: str, email: str) -> str | None:
    """Verify token and return user_id if valid, None if expired/invalid."""
    try:
        parts = token.split(":")
        if len(parts) != 3:
            return None
        user_id, ts, sig = parts
        payload = f"{user_id}:{email}:{ts}"
        expected = hmac.new(RESET_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        if time.time() - int(ts) > RESET_TTL:
            return None
        return user_id
    except Exception:
        return None


class PasswordResetRequest(BaseModel):
    email: str


class PasswordResetConfirm(BaseModel):
    token: str
    email: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("パスワードは8文字以上で入力してください。")
        if not any(c.isupper() for c in v):
            raise ValueError("パスワードには大文字を含めてください。")
        if not any(c.isdigit() for c in v):
            raise ValueError("パスワードには数字を含めてください。")
        return v


@router.post("/forgot-password")
@limiter.limit("3/minute")
def forgot_password(
    request: Request,
    req: PasswordResetRequest,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
):
    """Send password reset email. Always returns 200 to prevent email enumeration."""
    user = db.query(User).filter(User.email == req.email).first()
    if user:
        token = _make_reset_token(str(user.id), user.email)
        reset_url = f"{FRONTEND_URL}/reset-password?token={token}&email={req.email}"
        background_tasks.add_task(send_password_reset, req.email, reset_url)
    # Always return 200 to prevent email enumeration
    return {"detail": "パスワードリセットメールを送信しました。メールを確認してください。"}


@router.post("/reset-password")
@limiter.limit("5/minute")
def reset_password(
    request: Request,
    req: PasswordResetConfirm,
    db: DBSession = Depends(get_db),
):
    """Reset password using token from email."""
    user_id = _verify_reset_token(req.token, req.email)
    if not user_id:
        raise HTTPException(status_code=400, detail="リセットリンクが無効または期限切れです。")

    user = db.query(User).filter(User.id == uuid.UUID(user_id), User.email == req.email).first()
    if not user:
        raise HTTPException(status_code=400, detail="リセットリンクが無効です。")

    user.password_hash = pwd_context.hash(req.new_password)
    db.commit()
    return {"detail": "パスワードが更新されました。"}
