import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.database import get_db
from backend.dependencies import get_current_user_id
from backend.models import ChatSession, Message, User

limiter = Limiter(key_func=get_remote_address)
router = APIRouter(prefix="/sessions", tags=["sessions"])


class SessionResponse(BaseModel):
    id: uuid.UUID
    title: str
    is_starred: bool = False
    created_at: str

    class Config:
        from_attributes = True


@router.post("", response_model=SessionResponse)
@limiter.limit("30/minute")
def create_session(
    request: Request,
    title: str,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    session = ChatSession(user_id=current_user_id, title=title[:60])
    db.add(session)
    db.commit()
    db.refresh(session)
    return SessionResponse(
        id=session.id,
        title=session.title,
        is_starred=session.is_starred,
        created_at=session.created_at.isoformat(),
    )


@router.get("", response_model=list[SessionResponse])
def list_sessions(
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    sessions = (
        db.query(ChatSession)
        .filter(ChatSession.user_id == current_user_id)
        .order_by(ChatSession.is_starred.desc(), ChatSession.updated_at.desc().nullslast(), ChatSession.created_at.desc())
        .all()
    )
    return [
        SessionResponse(id=s.id, title=s.title, is_starred=s.is_starred, created_at=s.created_at.isoformat())
        for s in sessions
    ]


@router.get("/{session_id}/messages")
def get_messages(
    session_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    messages = (
        db.query(Message)
        .filter(Message.session_id == session_id)
        .order_by(Message.created_at)
        .all()
    )
    return [
        {
            "role": m.role,
            "content": m.content,
            "created_at": m.created_at.isoformat(),
            **({"images": m.images} if m.images else {}),
            **({"model": m.model} if m.model else {}),
            **({"input_tokens": m.input_tokens} if m.input_tokens is not None else {}),
            **({"output_tokens": m.output_tokens} if m.output_tokens is not None else {}),
            **({"cost": m.cost} if m.cost is not None else {}),
        }
        for m in messages
    ]


class SessionUpdateRequest(BaseModel):
    title: str


@router.put("/{session_id}", response_model=SessionResponse)
@limiter.limit("30/minute")
def update_session(
    request: Request,
    session_id: uuid.UUID,
    req: SessionUpdateRequest,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    session.title = req.title[:60]
    db.commit()
    db.refresh(session)
    return SessionResponse(
        id=session.id,
        title=session.title,
        is_starred=session.is_starred,
        created_at=session.created_at.isoformat(),
    )


@router.delete("/{session_id}", status_code=204)
@limiter.limit("20/minute")
def delete_session(
    request: Request,
    session_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    db.delete(session)
    db.commit()


@router.put("/{session_id}/star", response_model=SessionResponse)
@limiter.limit("30/minute")
def toggle_star(
    request: Request,
    session_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    session.is_starred = not session.is_starred
    db.commit()
    db.refresh(session)
    return SessionResponse(
        id=session.id,
        title=session.title,
        is_starred=session.is_starred,
        created_at=session.created_at.isoformat(),
    )


class SystemPromptRequest(BaseModel):
    system_prompt: str | None = None


@router.get("/user/system-prompt")
def get_user_system_prompt(
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == current_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"system_prompt": user.system_prompt}


@router.put("/user/system-prompt")
@limiter.limit("10/minute")
def update_user_system_prompt(
    request: Request,
    req: SystemPromptRequest,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == current_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.system_prompt = req.system_prompt
    db.commit()
    return {"system_prompt": user.system_prompt}


@router.get("/{session_id}/system-prompt")
def get_session_system_prompt(
    session_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return {"system_prompt": session.system_prompt}


@router.put("/{session_id}/system-prompt")
@limiter.limit("10/minute")
def update_session_system_prompt(
    request: Request,
    session_id: uuid.UUID,
    req: SystemPromptRequest,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    session.system_prompt = req.system_prompt
    db.commit()
    return {"system_prompt": session.system_prompt}
