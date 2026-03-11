import os
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from anthropic import AsyncAnthropic, AuthenticationError

from backend.database import get_db, SessionLocal
from backend.dependencies import get_current_user_id
from backend.models import ChatSession, Message

router = APIRouter(prefix="/chat", tags=["chat"])

_default_api_key = os.getenv("ANTHROPIC_API_KEY")


class ImageAttachment(BaseModel):
    media_type: str  # image/jpeg, image/png, image/gif, image/webp
    data: str  # base64-encoded


class ChatRequest(BaseModel):
    content: str
    images: list[ImageAttachment] = []


async def stream_response(session_id: uuid.UUID, content: str, images: list[ImageAttachment] = [], api_key: str | None = None):
    # StreamingResponse はルートハンドラの return 後に実行されるため
    # Depends(get_db) のセッションは既に閉じられている。
    # ジェネレーター内で独自にセッションを作成する。
    db = SessionLocal()
    full_response = ""

    try:
        user_msg = Message(session_id=session_id, role="user", content=content)
        db.add(user_msg)
        db.commit()

        history = (
            db.query(Message)
            .filter(Message.session_id == session_id)
            .order_by(Message.created_at)
            .all()
        )
        messages = [{"role": m.role, "content": m.content} for m in history]

        # Replace the last user message with multimodal content if images are attached
        if images and messages and messages[-1]["role"] == "user":
            image_blocks = [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": img.media_type,
                        "data": img.data,
                    },
                }
                for img in images
            ]
            messages[-1]["content"] = [
                *image_blocks,
                {"type": "text", "text": content},
            ]

        effective_key = api_key or _default_api_key
        if not effective_key:
            yield "\n\n[ERROR: APIキーが設定されていません]"
            return
        client = AsyncAnthropic(api_key=effective_key)

        async with client.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            messages=messages,
            tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}],
        ) as stream:
            async for text in stream.text_stream:
                full_response += text
                yield text

        assistant_msg = Message(session_id=session_id, role="assistant", content=full_response)
        db.add(assistant_msg)
        db.commit()

    except AuthenticationError:
        db.rollback()
        yield "\n\n[ERROR: APIキーが無効です。正しいキーを設定してください]"

    except Exception:
        db.rollback()
        yield "\n\n[ERROR: メッセージの生成中にエラーが発生しました]"

    finally:
        db.close()


@router.post("/{session_id}")
async def chat(
    session_id: uuid.UUID,
    req: ChatRequest,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    x_api_key: str | None = Header(None),
):
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    # Validate that at least one API key source is available
    if not x_api_key and not _default_api_key:
        raise HTTPException(status_code=400, detail="APIキーが設定されていません")

    return StreamingResponse(
        stream_response(session_id, req.content, req.images, api_key=x_api_key),
        media_type="text/plain",
    )
