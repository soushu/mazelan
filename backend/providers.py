"""
Multi-provider abstraction for streaming LLM responses.
Supports Anthropic (Claude), OpenAI (GPT), and Google (Gemini).
"""

import asyncio
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

# Prices: USD per 1M tokens (as of 2026-03)
MODEL_REGISTRY: dict[str, dict] = {
    # Anthropic
    "claude-sonnet-4-6":          {"provider": "anthropic", "label": "Claude Sonnet 4.6",  "supports_images": True,  "supports_web_search": True,  "input_price": 3.0,   "output_price": 15.0},
    "claude-opus-4-6":            {"provider": "anthropic", "label": "Claude Opus 4.6",    "supports_images": True,  "supports_web_search": True,  "input_price": 15.0,  "output_price": 75.0},
    "claude-haiku-4-5-20251001":  {"provider": "anthropic", "label": "Claude Haiku 4.5",   "supports_images": True,  "supports_web_search": True,  "input_price": 0.80,  "output_price": 4.0},
    # OpenAI
    "gpt-4o":                     {"provider": "openai",    "label": "GPT-4o",         "supports_images": True,  "supports_web_search": False, "input_price": 2.50,  "output_price": 10.0},
    "gpt-4o-mini":                {"provider": "openai",    "label": "GPT-4o mini",    "supports_images": True,  "supports_web_search": False, "input_price": 0.15,  "output_price": 0.60},
    "o3-mini":                    {"provider": "openai",    "label": "o3-mini",         "supports_images": False, "supports_web_search": False, "input_price": 1.10,  "output_price": 4.40},
    # Google
    "gemini-2.5-flash":           {"provider": "google",    "label": "Gemini 2.5 Flash", "supports_images": True, "supports_web_search": False, "input_price": 0.15,  "output_price": 0.60},
    "gemini-2.5-pro":             {"provider": "google",    "label": "Gemini 2.5 Pro",   "supports_images": True, "supports_web_search": False, "input_price": 1.25,  "output_price": 10.0},
    "gemini-3.1-flash-lite":      {"provider": "google",    "label": "Gemini 3.1 Flash Lite", "supports_images": True, "supports_web_search": False, "input_price": 0.075, "output_price": 0.30},
}


def calculate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Calculate cost in USD from token counts."""
    info = MODEL_REGISTRY.get(model, {})
    input_price = info.get("input_price", 0)
    output_price = info.get("output_price", 0)
    return (input_tokens * input_price + output_tokens * output_price) / 1_000_000

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
            final = await stream.get_final_message()
            yield {"input_tokens": final.usage.input_tokens, "output_tokens": final.usage.output_tokens}
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
            stream_options={"include_usage": True},
            **{token_param: 4096},
        )
        usage_data = None
        async for chunk in stream:
            if chunk.usage:
                usage_data = {"input_tokens": chunk.usage.prompt_tokens, "output_tokens": chunk.usage.completion_tokens}
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                yield delta.content
        if usage_data:
            yield usage_data
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

    max_retries = 3
    for attempt in range(max_retries):
        try:
            stream = await client.aio.models.generate_content_stream(
                model=model,
                contents=gemini_contents,
                config=config,
            )
            usage_data = None
            async for chunk in stream:
                if chunk.text:
                    yield chunk.text
                if hasattr(chunk, "usage_metadata") and chunk.usage_metadata:
                    um = chunk.usage_metadata
                    usage_data = {
                        "input_tokens": getattr(um, "prompt_token_count", 0) or 0,
                        "output_tokens": getattr(um, "candidates_token_count", 0) or 0,
                    }
            if usage_data:
                yield usage_data
            return  # Success, exit retry loop
        except Exception as e:
            err_str = str(e).lower()
            logger.warning("Gemini error (attempt %d/%d, model=%s): %s", attempt + 1, max_retries, model, e)
            if "api key" in err_str or "permission" in err_str or "401" in err_str or "403" in err_str:
                raise ProviderAuthError("Google API key is invalid")
            # Spending cap exceeded - don't retry, it won't resolve
            if "spending cap" in err_str or "billing" in err_str:
                raise ProviderSpendLimitError("GCPプロジェクトの支出上限に達しています。Google Cloud Consoleで上限を引き上げてください。")
            is_rate_limit = "429" in err_str or "resource_exhausted" in err_str or "rate limit" in err_str
            is_quota = "quota" in err_str and "rate" not in err_str
            if is_rate_limit and attempt < max_retries - 1:
                wait = 2 ** attempt  # 1s, 2s, 4s
                logger.warning("Gemini 429 rate limit, retry %d/%d after %ds", attempt + 1, max_retries, wait)
                await asyncio.sleep(wait)
                continue
            if is_rate_limit:
                raise ProviderRateLimitError(str(e))
            if is_quota:
                raise ProviderRateLimitError(f"日次クオータ超過: {e}")
            raise ProviderError(f"Gemini error: {e}")


# ── Dispatch ────────────────────────────────────────────────

STREAM_TIMEOUT_SECONDS = 300  # 5 minutes per stream


async def stream_provider(
    model: str,
    messages: list[dict],
    api_key: str,
    system_prompt: str | None = None,
    thinking: bool = False,
) -> AsyncGenerator[str | dict, None]:
    """Route to the correct provider's streaming function.
    Yields str chunks for content, and a final dict with usage info.
    """
    provider = get_provider(model)

    if provider == "anthropic":
        gen = stream_anthropic(model, messages, api_key, system_prompt, thinking=thinking)
    elif provider == "openai":
        gen = stream_openai(model, messages, api_key, system_prompt)
    elif provider == "google":
        gen = stream_google(model, messages, api_key, system_prompt, thinking=thinking)
    else:
        raise ProviderError(f"Unsupported provider: {provider}")

    try:
        async for chunk in _timeout_generator(gen, STREAM_TIMEOUT_SECONDS):
            yield chunk
    except asyncio.TimeoutError:
        logger.warning("Stream timed out after %ds for model %s", STREAM_TIMEOUT_SECONDS, model)
        yield "\n\n⚠️ 応答がタイムアウトしました。もう一度お試しください。"


async def _timeout_generator(
    gen: AsyncGenerator[str | dict, None], timeout: float
) -> AsyncGenerator[str | dict, None]:
    """Wrap an async generator with a per-chunk timeout."""
    ait = gen.__aiter__()
    while True:
        try:
            chunk = await asyncio.wait_for(ait.__anext__(), timeout=timeout)
            yield chunk
        except StopAsyncIteration:
            break
