import json
import logging
import uuid

from anthropic import AsyncAnthropic
from sqlalchemy.orm import Session as DBSession

from backend.database import SessionLocal
from backend.models import Context

logger = logging.getLogger(__name__)

CATEGORIES = ["preferences", "skills", "projects", "personal", "general"]

EXTRACTION_PROMPT = """You are a context extraction assistant. Analyze the conversation and extract important facts about the user that would be useful to remember for future conversations.

Extract ONLY concrete, specific facts. Do NOT extract:
- Temporary states (e.g., "user is currently working on X")
- Conversation-specific context
- Vague or generic statements
- Facts that are already in the existing context list

Categories:
- preferences: User's preferences, likes, dislikes, communication style
- skills: Technical skills, expertise, tools they use
- projects: Projects they're working on, their goals
- personal: Name, location, job, background
- general: Other useful facts

Existing context (DO NOT duplicate these):
{existing_contexts}

Return a JSON array of objects with "content" and "category" fields. If nothing new to extract, return an empty array [].

Example output:
[{{"content": "Prefers Python over JavaScript", "category": "preferences"}}, {{"content": "Works at a startup in Tokyo", "category": "personal"}}]

IMPORTANT: Return ONLY the JSON array, no other text.
IMPORTANT: Write the "content" field in the SAME LANGUAGE the user is using in the conversation. If the user writes in Japanese, extract facts in Japanese. If in English, use English."""

MAX_INPUT_CHARS = 2000


def _is_duplicate(new_content: str, existing: list[str]) -> bool:
    new_lower = new_content.lower().strip()
    for existing_content in existing:
        existing_lower = existing_content.lower().strip()
        # Bidirectional substring match
        if new_lower in existing_lower or existing_lower in new_lower:
            return True
    return False


async def extract_contexts(
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    user_message: str,
    assistant_message: str,
    api_key: str,
) -> None:
    """Extract context facts from a conversation turn. Fire-and-forget; errors are logged only."""
    db: DBSession | None = None
    try:
        db = SessionLocal()

        # Get existing contexts for dedup
        existing = (
            db.query(Context)
            .filter(Context.user_id == user_id, Context.is_active == True)
            .all()
        )
        existing_contents = [c.content for c in existing]
        existing_text = "\n".join(f"- {c.content} [{c.category}]" for c in existing) or "(none)"

        # Truncate inputs for cost control
        user_msg_truncated = user_message[:MAX_INPUT_CHARS]
        assistant_msg_truncated = assistant_message[:MAX_INPUT_CHARS]

        conversation = f"User: {user_msg_truncated}\n\nAssistant: {assistant_msg_truncated}"

        client = AsyncAnthropic(api_key=api_key)
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system=EXTRACTION_PROMPT.format(existing_contexts=existing_text),
            messages=[{"role": "user", "content": conversation}],
        )

        raw = response.content[0].text.strip()
        # Handle potential markdown code blocks
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]
            raw = raw.strip()

        facts = json.loads(raw)
        if not isinstance(facts, list):
            return

        added = 0
        for fact in facts:
            content = fact.get("content", "").strip()
            category = fact.get("category", "general")
            if not content:
                continue
            if category not in CATEGORIES:
                category = "general"
            if _is_duplicate(content, existing_contents):
                continue

            ctx = Context(
                user_id=user_id,
                session_id=session_id,
                content=content,
                category=category,
                source="auto",
            )
            db.add(ctx)
            existing_contents.append(content)
            added += 1

        if added > 0:
            db.commit()
            logger.info(f"Extracted {added} new contexts for user {user_id}")

    except Exception:
        logger.exception("Context extraction failed (non-fatal)")
        if db:
            db.rollback()
    finally:
        if db:
            db.close()
