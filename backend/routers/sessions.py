import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import ChatSession

router = APIRouter(prefix="/sessions", tags=["sessions"])


class SessionResponse(BaseModel):
    id: uuid.UUID
    title: str
    created_at: str

    class Config:
        from_attributes = True


@router.post("", response_model=SessionResponse)
def create_session(user_id: uuid.UUID, title: str, db: Session = Depends(get_db)):
    session = ChatSession(user_id=user_id, title=title[:60])
    db.add(session)
    db.commit()
    db.refresh(session)
    return SessionResponse(
        id=session.id,
        title=session.title,
        created_at=session.created_at.isoformat(),
    )


@router.get("", response_model=list[SessionResponse])
def list_sessions(user_id: uuid.UUID, db: Session = Depends(get_db)):
    sessions = (
        db.query(ChatSession)
        .filter(ChatSession.user_id == user_id)
        .order_by(ChatSession.created_at.desc())
        .all()
    )
    return [
        SessionResponse(id=s.id, title=s.title, created_at=s.created_at.isoformat())
        for s in sessions
    ]


@router.get("/{session_id}/messages")
def get_messages(session_id: uuid.UUID, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return [
        {"role": m.role, "content": m.content, "created_at": m.created_at.isoformat()}
        for m in session.messages
    ]


@router.delete("/{session_id}", status_code=204)
def delete_session(session_id: uuid.UUID, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete(session)
    db.commit()
