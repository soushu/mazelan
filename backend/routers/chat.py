import os
import uuid
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from anthropic import AsyncAnthropic

from backend.database import get_db, SessionLocal
from backend.models import ChatSession, Message

router = APIRouter(prefix="/chat", tags=["chat"])
client = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


class ChatRequest(BaseModel):
    content: str


async def stream_response(session_id: uuid.UUID, content: str):
    # StreamingResponse はルートハンドラの return 後に実行されるため
    # Depends(get_db) のセッションは既に閉じられている。
    # ジェネレーター内で独自にセッションを作成する。
    db = SessionLocal()
    full_response = ""

    try:
        user_msg = Message(session_id=session_id, role="user", content=content)
        db.add(user_msg)
        db.commit()

        async with client.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            messages=[{"role": "user", "content": content}],
        ) as stream:
            async for text in stream.text_stream:
                full_response += text
                yield text

        assistant_msg = Message(session_id=session_id, role="assistant", content=full_response)
        db.add(assistant_msg)
        db.commit()

    except Exception as e:
        db.rollback()
        yield f"\n\n[ERROR: {str(e)}]"

    finally:
        db.close()


@router.post("/{session_id}")
async def chat(session_id: uuid.UUID, req: ChatRequest, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return StreamingResponse(
        stream_response(session_id, req.content),
        media_type="text/plain",
    )
