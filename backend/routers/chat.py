import asyncio
import logging
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db, SessionLocal
from backend.dependencies import get_current_user_id
from backend.models import ChatSession, Context, Message, User
from backend.context_extractor import extract_contexts
from backend.providers import (
    ALLOWED_MODELS,
    get_provider,
    stream_provider,
    ProviderAuthError,
    ProviderRateLimitError,
    ProviderSpendLimitError,
    ProviderError,
)

router = APIRouter(prefix="/chat", tags=["chat"])



class ImageAttachment(BaseModel):
    media_type: str  # image/jpeg, image/png, image/gif, image/webp
    data: str  # base64-encoded


class ChatRequest(BaseModel):
    content: str
    images: list[ImageAttachment] = []
    model: str = "claude-sonnet-4-6"
    thinking: bool = False


async def stream_response(session_id: uuid.UUID, content: str, images: list[ImageAttachment] = [], api_key: str | None = None, model: str = "claude-sonnet-4-6", system_prompt: str | None = None, user_id: uuid.UUID | None = None, anthropic_key: str | None = None, thinking: bool = False):
    # StreamingResponse はルートハンドラの return 後に実行されるため
    # Depends(get_db) のセッションは既に閉じられている。
    # ジェネレーター内で独自にセッションを作成する。
    db = SessionLocal()
    full_response = ""

    try:
        images_data = [{"media_type": img.media_type, "data": img.data} for img in images] if images else None
        user_msg = Message(session_id=session_id, role="user", content=content, images=images_data)
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

        if not api_key:
            yield "\n\n⚠️ APIキーが設定されていません。サイドバーの「API Key 設定」からキーを設定してください。"
            return

        async for text in stream_provider(model, messages, api_key, system_prompt, thinking=thinking):
            full_response += text
            yield text

        assistant_msg = Message(session_id=session_id, role="assistant", content=full_response, model=model)
        db.add(assistant_msg)
        # Update session's updated_at
        chat_session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
        if chat_session:
            chat_session.updated_at = datetime.now(timezone.utc)
        db.commit()

        # Fire-and-forget context extraction (always uses Anthropic key)
        extraction_key = anthropic_key or (api_key if get_provider(model) == "anthropic" else None)
        if user_id and extraction_key and full_response:
            asyncio.create_task(
                extract_contexts(user_id, session_id, content, full_response, extraction_key)
            )

    except ProviderAuthError:
        db.rollback()
        yield "\n\n⚠️ APIキーが無効です。サイドバーの「API Key 設定」から正しいキーを設定してください。"

    except ProviderRateLimitError:
        db.rollback()
        yield "\n\n⚠️ レート制限に達しました。リクエストの送信頻度が高すぎます。しばらく待ってから再度お試しください。"

    except ProviderSpendLimitError:
        db.rollback()
        yield "\n\n⚠️ APIの月額利用上限に達しました。プロバイダーのダッシュボードで上限設定を引き上げてください。"

    except ProviderError as e:
        db.rollback()
        logger.error("ProviderError: %s", e)
        yield "\n\n⚠️ メッセージの生成中にエラーが発生しました。しばらく待ってから再度お試しください。"

    except Exception as e:
        db.rollback()
        logger.error("Unexpected error in stream_response: %s", e, exc_info=True)
        yield "\n\n⚠️ メッセージの生成中にエラーが発生しました。しばらく待ってから再度お試しください。"

    finally:
        db.close()


@router.post("/{session_id}")
async def chat(
    session_id: uuid.UUID,
    req: ChatRequest,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    x_api_key: str | None = Header(None),
    x_anthropic_key: str | None = Header(None),
):
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    if not x_api_key:
        raise HTTPException(status_code=400, detail="APIキーが設定されていません。サイドバーの「API Key 設定」からキーを設定してください。")

    model = req.model if req.model in ALLOWED_MODELS else "claude-sonnet-4-6"

    # Resolve system prompt: session-specific > user global > none
    system_prompt = session.system_prompt
    if not system_prompt:
        user = db.query(User).filter(User.id == current_user_id).first()
        if user:
            system_prompt = user.system_prompt

    # Inject active context memories into system prompt
    active_contexts = (
        db.query(Context)
        .filter(Context.user_id == current_user_id, Context.is_active == True)
        .order_by(Context.category)
        .all()
    )
    if active_contexts:
        context_lines = [f"- {c.content}" for c in active_contexts]
        context_block = "<context_memory>\nHere are things you know about the user:\n" + "\n".join(context_lines) + "\n</context_memory>"
        if system_prompt:
            system_prompt = system_prompt + "\n\n" + context_block
        else:
            system_prompt = context_block

    return StreamingResponse(
        stream_response(session_id, req.content, req.images, api_key=x_api_key, model=model, system_prompt=system_prompt, user_id=current_user_id, anthropic_key=x_anthropic_key, thinking=req.thinking),
        media_type="text/plain",
    )
