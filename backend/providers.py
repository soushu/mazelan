"""
Multi-provider abstraction for streaming LLM responses.
Supports Anthropic (Claude), OpenAI (GPT), and Google (Gemini).
"""

import base64
import logging
from typing import AsyncGenerator

from anthropic import AsyncAnthropic, AuthenticationError as AnthropicAuthError, BadRequestError as AnthropicBadRequestError, RateLimitError as AnthropicRateLimitError
from openai import AsyncOpenAI, AuthenticationError as OpenAIAuthError, RateLimitError as OpenAIRateLimitError
from google import genai
from google.genai import types as genai_types

logger = logging.getLogger(__name__)


# ── Exceptions ──────────────────────────────────────────────

class ProviderAuthError(Exception):
    """Invalid or missing API key for the provider."""
    pass


class ProviderRateLimitError(Exception):
    """Per-minute rate limit (429)."""
    pass


class ProviderSpendLimitError(Exception):
    """Monthly spend limit reached."""
    pass


class ProviderError(Exception):
    """Generic provider error."""
    pass


# ── Model Registry ──────────────────────────────────────────

MODEL_REGISTRY: dict[str, dict] = {
    # Anthropic
    "claude-sonnet-4-6":          {"provider": "anthropic", "label": "Claude Sonnet 4.6",  "supports_images": True,  "supports_web_search": True},
    "claude-opus-4-6":            {"provider": "anthropic", "label": "Claude Opus 4.6",    "supports_images": True,  "supports_web_search": True},
    "claude-haiku-4-5-20251001":  {"provider": "anthropic", "label": "Claude Haiku 4.5",   "supports_images": True,  "supports_web_search": True},
    # OpenAI
    "gpt-4o":                     {"provider": "openai",    "label": "GPT-4o",         "supports_images": True,  "supports_web_search": False},
    "gpt-4o-mini":                {"provider": "openai",    "label": "GPT-4o mini",    "supports_images": True,  "supports_web_search": False},
    "o3-mini":                    {"provider": "openai",    "label": "o3-mini",         "supports_images": False, "supports_web_search": False},
    # Google
    "gemini-2.5-flash":           {"provider": "google",    "label": "Gemini 2.5 Flash", "supports_images": True, "supports_web_search": False},
    "gemini-2.5-pro":             {"provider": "google",    "label": "Gemini 2.5 Pro",   "supports_images": True, "supports_web_search": False},
    "gemini-3.1-flash-lite":      {"provider": "google",    "label": "Gemini 3.1 Flash Lite", "supports_images": True, "supports_web_search": False},
}

ALLOWED_MODELS = set(MODEL_REGISTRY.keys())


def get_provider(model_id: str) -> str:
    """Return the provider name for a given model ID."""
    info = MODEL_REGISTRY.get(model_id)
    if not info:
        raise ProviderError(f"Unknown model: {model_id}")
    return info["provider"]


# ── Anthropic (Claude) ──────────────────────────────────────

async def stream_anthropic(
    model: str,
    messages: list[dict],
    api_key: str,
    system_prompt: str | None = None,
    thinking: bool = False,
) -> AsyncGenerator[str, None]:
    client = AsyncAnthropic(api_key=api_key)
    kwargs: dict = dict(
        model=model,
        max_tokens=4096,
        messages=messages,
    )
    # Extended thinking
    if thinking:
        kwargs["thinking"] = {"type": "enabled", "budget_tokens": 10000}
        kwargs["max_tokens"] = 16000
    # Web search tool (Claude only)
    if MODEL_REGISTRY.get(model, {}).get("supports_web_search"):
        kwargs["tools"] = [{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}]
    if system_prompt:
        kwargs["system"] = system_prompt

    try:
        async with client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield text
    except AnthropicAuthError:
        raise ProviderAuthError("Anthropic API key is invalid")
    except AnthropicRateLimitError as e:
        raise ProviderRateLimitError(str(e))
    except AnthropicBadRequestError as e:
        msg = str(e)
        if "usage limit" in msg.lower():
            raise ProviderSpendLimitError(msg)
        raise ProviderError(f"Anthropic error: {msg}")


# ── OpenAI (GPT) ────────────────────────────────────────────

def _convert_messages_for_openai(
    messages: list[dict],
    model: str,
    system_prompt: str | None = None,
) -> list[dict]:
    """Convert Anthropic-style messages to OpenAI format."""
    oai_messages: list[dict] = []

    if system_prompt:
        oai_messages.append({"role": "system", "content": system_prompt})

    supports_images = MODEL_REGISTRY.get(model, {}).get("supports_images", False)

    for msg in messages:
        role = msg["role"]
        content = msg["content"]

        # Handle multimodal content (list of blocks)
        if isinstance(content, list):
            if not supports_images:
                # Strip images for models that don't support them
                text_parts = [b["text"] for b in content if b.get("type") == "text"]
                oai_messages.append({"role": role, "content": " ".join(text_parts) or ""})
            else:
                # Convert Anthropic image format to OpenAI format
                oai_parts = []
                for block in content:
                    if block.get("type") == "text":
                        oai_parts.append({"type": "text", "text": block["text"]})
                    elif block.get("type") == "image":
                        source = block.get("source", {})
                        media_type = source.get("media_type", "image/png")
                        data = source.get("data", "")
                        oai_parts.append({
                            "type": "image_url",
                            "image_url": {"url": f"data:{media_type};base64,{data}"},
                        })
                oai_messages.append({"role": role, "content": oai_parts})
        else:
            oai_messages.append({"role": role, "content": content})

    return oai_messages


async def stream_openai(
    model: str,
    messages: list[dict],
    api_key: str,
    system_prompt: str | None = None,
) -> AsyncGenerator[str, None]:
    client = AsyncOpenAI(api_key=api_key)
    oai_messages = _convert_messages_for_openai(messages, model, system_prompt)

    # o-series models (o1, o3, etc.) require max_completion_tokens instead of max_tokens
    token_param = "max_completion_tokens" if model.startswith("o") else "max_tokens"
    try:
        stream = await client.chat.completions.create(
            model=model,
            messages=oai_messages,
            stream=True,
            **{token_param: 4096},
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                yield delta.content
    except OpenAIAuthError:
        raise ProviderAuthError("OpenAI API key is invalid")
    except OpenAIRateLimitError as e:
        raise ProviderRateLimitError(str(e))


# ── Google (Gemini) ─────────────────────────────────────────

def _build_gemini_parts(content) -> list[genai_types.Part]:
    """Convert Anthropic-style content to Gemini Part list."""
    parts: list[genai_types.Part] = []
    if isinstance(content, list):
        for block in content:
            if block.get("type") == "text":
                parts.append(genai_types.Part.from_text(text=block["text"]))
            elif block.get("type") == "image":
                source = block.get("source", {})
                parts.append(genai_types.Part.from_bytes(
                    data=base64.b64decode(source.get("data", "")),
                    mime_type=source.get("media_type", "image/png"),
                ))
    else:
        parts.append(genai_types.Part.from_text(text=content))
    return parts


def _convert_messages_for_gemini(
    messages: list[dict],
) -> list[genai_types.Content]:
    """Convert Anthropic-style messages to Gemini Content list.
    Gemini requires alternating user/model roles; consecutive same-role messages are merged.
    """
    gemini_history: list[genai_types.Content] = []

    for msg in messages:
        role = "user" if msg["role"] == "user" else "model"
        parts = _build_gemini_parts(msg["content"])

        # Merge consecutive same-role messages
        if gemini_history and gemini_history[-1].role == role:
            gemini_history[-1].parts.extend(parts)
        else:
            gemini_history.append(genai_types.Content(role=role, parts=parts))

    return gemini_history


async def stream_google(
    model: str,
    messages: list[dict],
    api_key: str,
    system_prompt: str | None = None,
    thinking: bool = False,
) -> AsyncGenerator[str, None]:
    client = genai.Client(api_key=api_key)

    gemini_contents = _convert_messages_for_gemini(messages)
    if not gemini_contents:
        return

    config = genai_types.GenerateContentConfig(max_output_tokens=4096)
    if thinking:
        config.thinking_config = genai_types.ThinkingConfig(thinking_budget=10000)
    if system_prompt:
        config.system_instruction = system_prompt

    try:
        stream = await client.aio.models.generate_content_stream(
            model=model,
            contents=gemini_contents,
            config=config,
        )
        async for chunk in stream:
            if chunk.text:
                yield chunk.text
    except Exception as e:
        err_str = str(e).lower()
        if "api key" in err_str or "permission" in err_str or "401" in err_str or "403" in err_str:
            raise ProviderAuthError("Google API key is invalid")
        if "rate limit" in err_str or "quota" in err_str or "429" in err_str or "resource_exhausted" in err_str:
            raise ProviderRateLimitError(str(e))
        raise ProviderError(f"Gemini error: {e}")


# ── Dispatch ────────────────────────────────────────────────

async def stream_provider(
    model: str,
    messages: list[dict],
    api_key: str,
    system_prompt: str | None = None,
    thinking: bool = False,
) -> AsyncGenerator[str, None]:
    """Route to the correct provider's streaming function."""
    provider = get_provider(model)

    if provider == "anthropic":
        gen = stream_anthropic(model, messages, api_key, system_prompt, thinking=thinking)
    elif provider == "openai":
        gen = stream_openai(model, messages, api_key, system_prompt)
    elif provider == "google":
        gen = stream_google(model, messages, api_key, system_prompt, thinking=thinking)
    else:
        raise ProviderError(f"Unsupported provider: {provider}")

    async for text in gen:
        yield text
