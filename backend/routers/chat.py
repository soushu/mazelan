import asyncio
import logging
import re
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from backend.database import get_db, SessionLocal
from backend.dependencies import get_current_user_id
from backend.models import ChatSession, Context, Message, User
from backend.context_extractor import extract_contexts
from backend.base_prompt import build_system_prompt
from backend.providers import (
    ALLOWED_MODELS,
    GEMINI_FREE_POOL_MODELS,
    MODEL_REGISTRY,
    get_provider,
    stream_provider,
    gemini_free_pool,
    ProviderAuthError,
    ProviderRateLimitError,
    ProviderSpendLimitError,
    ProviderError,
)

from backend.schemas import ImageAttachment, validate_image_count

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatRequest(BaseModel):
    content: str
    images: list[ImageAttachment] = []
    model: str = "gemini-2.5-flash-lite"
    thinking: bool = False

    @field_validator("content")
    @classmethod
    def check_content_length(cls, v: str) -> str:
        if len(v) > 50000:
            raise ValueError("メッセージは50000文字以内にしてください。")
        return v

    @field_validator("images")
    @classmethod
    def check_image_count(cls, v: list[ImageAttachment]) -> list[ImageAttachment]:
        return validate_image_count(v)


async def stream_response(session_id: uuid.UUID, content: str, images: list[ImageAttachment] = [], api_key: str | None = None, model: str = "gemini-2.5-flash-lite", system_prompt: str | None = None, user_id: uuid.UUID | None = None, anthropic_key: str | None = None, thinking: bool = False, google_fallback: str | None = None):
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

        if not api_key and not (get_provider(model) == "google" and gemini_free_pool.available and model in GEMINI_FREE_POOL_MODELS):
            yield "\n\n⚠️ APIキーが設定されていません。サイドバーの「API Key 設定」からキーを設定してください。"
            return

        usage_info = None
        async for chunk in stream_provider(model, messages, api_key, system_prompt, thinking=thinking, google_fallback=google_fallback):
            if isinstance(chunk, dict):
                usage_info = chunk
            else:
                full_response += chunk
                yield chunk

        # Calculate cost
        cost = None
        if usage_info:
            from backend.providers import calculate_cost
            cost = calculate_cost(model, usage_info.get("input_tokens", 0), usage_info.get("output_tokens", 0))

        # Strip status markers and excessively long URLs before saving to DB
        clean_response = re.sub(r"<!--STATUS:.*?-->", "", full_response)
        clean_response = re.sub(r"\[([^\]]*)\]\(https?://[^\)]{500,}\)", r"[\1](リンク省略)", clean_response)
        assistant_msg = Message(
            session_id=session_id, role="assistant", content=clean_response, model=model,
            input_tokens=usage_info.get("input_tokens") if usage_info else None,
            output_tokens=usage_info.get("output_tokens") if usage_info else None,
            cost=cost,
        )
        db.add(assistant_msg)
        # Update session's updated_at
        chat_session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
        if chat_session:
            chat_session.updated_at = datetime.now(timezone.utc)
        db.commit()

        # Yield usage metadata marker
        if usage_info:
            import json
            meta = {"input_tokens": usage_info["input_tokens"], "output_tokens": usage_info["output_tokens"], "cost": round(cost, 6) if cost else 0}
            yield f"\n<!--USAGE:{json.dumps(meta)}-->"

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
@limiter.limit("20/minute")
async def chat(
    request: Request,
    session_id: uuid.UUID,
    req: ChatRequest,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    x_api_key: str | None = Header(None),
    x_anthropic_key: str | None = Header(None),
    x_google_fallback_key: str | None = Header(None),
):
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    model = req.model if req.model in ALLOWED_MODELS else "gemini-2.5-flash-lite"

    # For Google models, allow access without user API key if free pool is available (Flash Lite only)
    if not x_api_key:
        if get_provider(model) == "google" and gemini_free_pool.available and model in GEMINI_FREE_POOL_MODELS:
            pass  # Will use free pool keys (Tier 1: only Flash Lite is $0)
        else:
            raise HTTPException(status_code=400, detail="APIキーが設定されていません。サイドバーの「API Key 設定」からキーを設定してください。")

    # For Google models, attach fallback key for auto-switching on quota errors
    google_fallback = x_google_fallback_key if get_provider(model) == "google" else None

    # Resolve system prompt: session-specific > user global > none
    user_prompt = session.system_prompt
    if not user_prompt:
        user = db.query(User).filter(User.id == current_user_id).first()
        if user:
            user_prompt = user.system_prompt

    # Inject active context memories into system prompt
    active_contexts = (
        db.query(Context)
        .filter(Context.user_id == current_user_id, Context.is_active == True)
        .order_by(Context.category)
        .all()
    )
    context_block = None
    if active_contexts:
        context_lines = [f"- {c.content}" for c in active_contexts]
        context_block = "<context_memory>\nHere are things you know about the user:\n" + "\n".join(context_lines) + "\n</context_memory>"

    has_web_search = MODEL_REGISTRY.get(model, {}).get("supports_web_search", False)
    system_prompt = build_system_prompt(user_prompt, context_block, has_web_search=has_web_search)

    return StreamingResponse(
        stream_response(session_id, req.content, req.images, api_key=x_api_key, model=model, system_prompt=system_prompt, user_id=current_user_id, anthropic_key=x_anthropic_key, thinking=req.thinking, google_fallback=google_fallback),
        media_type="text/plain",
    )
