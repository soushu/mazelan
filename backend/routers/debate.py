import asyncio
import logging
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db, SessionLocal
from backend.dependencies import get_current_user_id
from backend.models import ChatSession, Context, Message, User
from backend.context_extractor import extract_contexts
from backend.providers import (
    ALLOWED_MODELS,
    MODEL_REGISTRY,
    get_provider,
    stream_provider,
    ProviderAuthError,
    ProviderRateLimitError,
    ProviderSpendLimitError,
    ProviderError,
)

router = APIRouter(prefix="/debate", tags=["debate"])


class ImageAttachment(BaseModel):
    media_type: str
    data: str


class DebateRequest(BaseModel):
    content: str
    images: list[ImageAttachment] = []
    model_a: str = "claude-sonnet-4-6"
    model_b: str = "gpt-4o"
    thinking: bool = False


# ── Debate prompts ──────────────────────────────────────

def _critique_prompt(other_model_label: str, other_answer: str) -> str:
    return (
        f"以下は {other_model_label} による回答です。この回答を批評し、補足や改善点を述べてください。\n\n"
        f"---\n{other_answer}\n---"
    )


def _final_prompt(
    model_a_label: str, model_b_label: str,
    answer_a: str, answer_b: str,
    critique_a: str, critique_b: str,
) -> str:
    return (
        "以下の議論を踏まえて、全ての意見を統合した最終回答を出してください。\n\n"
        f"## {model_a_label} の初回回答\n{answer_a}\n\n"
        f"## {model_b_label} の初回回答\n{answer_b}\n\n"
        f"## {model_a_label} の批評\n{critique_a}\n\n"
        f"## {model_b_label} の批評\n{critique_b}\n\n"
        "上記を踏まえ、最も正確で包括的な最終回答を提供してください。"
    )


# ── Stream debate ────────────────────────────────────────

async def stream_debate(
    session_id: uuid.UUID,
    content: str,
    images: list[ImageAttachment] = [],
    model_a: str = "claude-sonnet-4-6",
    model_b: str = "gpt-4o",
    api_key_a: str | None = None,
    api_key_b: str | None = None,
    system_prompt: str | None = None,
    user_id: uuid.UUID | None = None,
    anthropic_key: str | None = None,
    thinking: bool = False,
):
    db = SessionLocal()
    step_contents: dict[str, str] = {}

    try:
        # Save user message
        images_data = [{"media_type": img.media_type, "data": img.data} for img in images] if images else None
        user_msg = Message(session_id=session_id, role="user", content=content, images=images_data)
        db.add(user_msg)
        db.commit()

        # Build message history
        history = (
            db.query(Message)
            .filter(Message.session_id == session_id)
            .order_by(Message.created_at)
            .all()
        )
        messages = [{"role": m.role, "content": m.content} for m in history]

        # Replace last user message with multimodal content if images attached
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

        model_a_label = MODEL_REGISTRY.get(model_a, {}).get("label", model_a)
        model_b_label = MODEL_REGISTRY.get(model_b, {}).get("label", model_b)

        # ── Step 1: Model A answers ──
        yield f"\n[STEP:model_a_answer]\n"
        step_text = ""
        async for text in stream_provider(model_a, messages, api_key_a, system_prompt, thinking=thinking):
            step_text += text
            yield text
        step_contents["model_a_answer"] = step_text

        # ── Step 2: Model B answers ──
        yield f"\n[STEP:model_b_answer]\n"
        step_text = ""
        async for text in stream_provider(model_b, messages, api_key_b, system_prompt, thinking=thinking):
            step_text += text
            yield text
        step_contents["model_b_answer"] = step_text

        # ── Step 3: Model A critiques Model B ──
        yield f"\n[STEP:model_a_critique]\n"
        critique_msg_a = messages + [
            {"role": "assistant", "content": step_contents["model_a_answer"]},
            {"role": "user", "content": _critique_prompt(model_b_label, step_contents["model_b_answer"])},
        ]
        step_text = ""
        async for text in stream_provider(model_a, critique_msg_a, api_key_a, system_prompt, thinking=thinking):
            step_text += text
            yield text
        step_contents["model_a_critique"] = step_text

        # ── Step 4: Model B critiques Model A ──
        yield f"\n[STEP:model_b_critique]\n"
        critique_msg_b = messages + [
            {"role": "assistant", "content": step_contents["model_b_answer"]},
            {"role": "user", "content": _critique_prompt(model_a_label, step_contents["model_a_answer"])},
        ]
        step_text = ""
        async for text in stream_provider(model_b, critique_msg_b, api_key_b, system_prompt, thinking=thinking):
            step_text += text
            yield text
        step_contents["model_b_critique"] = step_text

        # ── Step 5: Model A synthesizes final answer ──
        yield f"\n[STEP:final]\n"
        final_msg = messages + [
            {"role": "assistant", "content": "議論を開始します。"},
            {"role": "user", "content": _final_prompt(
                model_a_label, model_b_label,
                step_contents["model_a_answer"], step_contents["model_b_answer"],
                step_contents["model_a_critique"], step_contents["model_b_critique"],
            )},
        ]
        step_text = ""
        async for text in stream_provider(model_a, final_msg, api_key_a, system_prompt, thinking=thinking):
            step_text += text
            yield text
        step_contents["final"] = step_text

        # ── Save to DB ──
        debate_content = (
            f"<!--DEBATE:{model_a}:{model_b}-->\n"
            f"<!--STEP:model_a_answer-->\n{step_contents['model_a_answer']}\n"
            f"<!--STEP:model_b_answer-->\n{step_contents['model_b_answer']}\n"
            f"<!--STEP:model_a_critique-->\n{step_contents['model_a_critique']}\n"
            f"<!--STEP:model_b_critique-->\n{step_contents['model_b_critique']}\n"
            f"<!--STEP:final-->\n{step_contents['final']}"
        )
        assistant_msg = Message(session_id=session_id, role="assistant", content=debate_content, model=f"debate:{model_a}:{model_b}")
        db.add(assistant_msg)

        chat_session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
        if chat_session:
            chat_session.updated_at = datetime.now(timezone.utc)
        db.commit()

        # Context extraction (fire-and-forget)
        extraction_key = anthropic_key or (api_key_a if get_provider(model_a) == "anthropic" else None)
        if user_id and extraction_key and step_contents.get("final"):
            asyncio.create_task(
                extract_contexts(user_id, session_id, content, step_contents["final"], extraction_key)
            )

    except ProviderAuthError:
        db.rollback()
        yield "\n\n⚠️ APIキーが無効です。サイドバーの「API Key 設定」から正しいキーを設定してください。"

    except ProviderRateLimitError:
        db.rollback()
        yield "\n\n⚠️ レート制限に達しました。しばらく待ってから再度お試しください。"

    except ProviderSpendLimitError:
        db.rollback()
        yield "\n\n⚠️ APIの月額利用上限に達しました。プロバイダーのダッシュボードで上限設定を引き上げてください。"

    except ProviderError as e:
        db.rollback()
        logger.error("ProviderError in debate: %s", e)
        yield "\n\n⚠️ メッセージの生成中にエラーが発生しました。しばらく待ってから再度お試しください。"

    except Exception as e:
        db.rollback()
        logger.error("Unexpected error in stream_debate: %s", e, exc_info=True)
        yield "\n\n⚠️ メッセージの生成中にエラーが発生しました。しばらく待ってから再度お試しください。"

    finally:
        db.close()


@router.post("/{session_id}")
@limiter.limit("10/minute")
async def debate(
    request: Request,
    session_id: uuid.UUID,
    req: DebateRequest,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    x_api_key_a: str | None = Header(None),
    x_api_key_b: str | None = Header(None),
    x_anthropic_key: str | None = Header(None),
):
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    if not x_api_key_a or not x_api_key_b:
        raise HTTPException(
            status_code=400,
            detail="議論モードには両方のモデルのAPIキーが必要です。サイドバーの「API Key 設定」からキーを設定してください。",
        )

    model_a = req.model_a if req.model_a in ALLOWED_MODELS else "claude-sonnet-4-6"
    model_b = req.model_b if req.model_b in ALLOWED_MODELS else "gpt-4o"

    # Resolve system prompt
    system_prompt = session.system_prompt
    if not system_prompt:
        user = db.query(User).filter(User.id == current_user_id).first()
        if user:
            system_prompt = user.system_prompt

    # Inject context memory
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
        stream_debate(
            session_id, req.content, req.images,
            model_a=model_a, model_b=model_b,
            api_key_a=x_api_key_a, api_key_b=x_api_key_b,
            system_prompt=system_prompt,
            user_id=current_user_id,
            anthropic_key=x_anthropic_key,
            thinking=req.thinking,
        ),
        media_type="text/plain",
    )
