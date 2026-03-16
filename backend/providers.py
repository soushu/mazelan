"""
Multi-provider abstraction for streaming LLM responses.
Supports Anthropic (Claude), OpenAI (GPT), and Google (Gemini).
"""

import asyncio
import base64
import json
import logging
import os
import threading
from typing import AsyncGenerator

from anthropic import AsyncAnthropic, AuthenticationError as AnthropicAuthError, BadRequestError as AnthropicBadRequestError, RateLimitError as AnthropicRateLimitError

from backend.amazon_search import AMAZON_SEARCH_TOOL, search_amazon, is_available as amazon_available
from openai import AsyncOpenAI, AuthenticationError as OpenAIAuthError, RateLimitError as OpenAIRateLimitError
from google import genai
from google.genai import types as genai_types

logger = logging.getLogger(__name__)


# ── Gemini Free Key Pool ───────────────────────────────────

class GeminiFreeKeyPool:
    """Round-robin pool of free-tier Gemini API keys."""

    def __init__(self):
        keys_str = os.environ.get("GEMINI_FREE_KEYS", "")
        self._keys = [k.strip() for k in keys_str.split(",") if k.strip()]
        self._index = 0
        self._lock = threading.Lock()
        if self._keys:
            logger.info("Gemini free key pool initialized with %d keys", len(self._keys))

    @property
    def available(self) -> bool:
        return len(self._keys) > 0

    def get_next(self) -> str | None:
        if not self._keys:
            return None
        with self._lock:
            key = self._keys[self._index % len(self._keys)]
            self._index += 1
            return key

    def get_all(self) -> list[str]:
        return list(self._keys)


gemini_free_pool = GeminiFreeKeyPool()


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
    "gemini-2.5-flash-lite":      {"provider": "google",    "label": "Gemini 2.5 Flash Lite", "supports_images": True, "supports_web_search": False, "input_price": 0.075, "output_price": 0.30},
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

async def _execute_tool(name: str, input_data: dict) -> str:
    """Execute a tool call and return the result as a string."""
    if name == "amazon_product_search":
        results = await search_amazon(
            query=input_data.get("query", ""),
            max_results=input_data.get("max_results", 3),
        )
        return json.dumps(results, ensure_ascii=False)
    return json.dumps({"error": f"Unknown tool: {name}"})


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
        messages=list(messages),  # copy to avoid mutating caller's list
    )
    # Extended thinking
    if thinking:
        kwargs["thinking"] = {"type": "enabled", "budget_tokens": 10000}
        kwargs["max_tokens"] = 16000
    # Tools: web search (Claude built-in) + Amazon product search (custom)
    tools: list[dict] = []
    if MODEL_REGISTRY.get(model, {}).get("supports_web_search"):
        tools.append({"type": "web_search_20250305", "name": "web_search", "max_uses": 3})
    if amazon_available():
        tools.append(AMAZON_SEARCH_TOOL)
    if tools:
        kwargs["tools"] = tools
    if system_prompt:
        kwargs["system"] = system_prompt

    total_input_tokens = 0
    total_output_tokens = 0
    max_tool_rounds = 3  # Prevent infinite tool loops

    try:
        for _round in range(max_tool_rounds + 1):
            async with client.messages.stream(**kwargs) as stream:
                async for text in stream.text_stream:
                    yield text
                final = await stream.get_final_message()

            total_input_tokens += final.usage.input_tokens
            total_output_tokens += final.usage.output_tokens

            # Check if the model wants to use a custom tool
            tool_use_blocks = [b for b in final.content if b.type == "tool_use" and b.name != "web_search"]
            if final.stop_reason != "tool_use" or not tool_use_blocks:
                break  # No more tool calls, done

            # Execute tool calls and build tool_result messages
            assistant_content = [{"type": b.type, **({"id": b.id, "name": b.name, "input": b.input} if b.type == "tool_use" else {"text": b.text})} for b in final.content if b.type in ("text", "tool_use")]
            kwargs["messages"].append({"role": "assistant", "content": assistant_content})

            tool_results = []
            for block in tool_use_blocks:
                result = await _execute_tool(block.name, block.input)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result,
                })
            kwargs["messages"].append({"role": "user", "content": tool_results})

        yield {"input_tokens": total_input_tokens, "output_tokens": total_output_tokens}
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


def _openai_tools() -> list[dict] | None:
    """Return OpenAI-format tool definitions if Amazon search is available."""
    if not amazon_available():
        return None
    return [{
        "type": "function",
        "function": {
            "name": AMAZON_SEARCH_TOOL["name"],
            "description": AMAZON_SEARCH_TOOL["description"],
            "parameters": AMAZON_SEARCH_TOOL["input_schema"],
        },
    }]


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
    tools = _openai_tools()
    max_tool_rounds = 3
    total_input = 0
    total_output = 0

    try:
        for _round in range(max_tool_rounds + 1):
            create_kwargs: dict = dict(
                model=model,
                messages=oai_messages,
                stream=True,
                stream_options={"include_usage": True},
                **{token_param: 4096},
            )
            if tools:
                create_kwargs["tools"] = tools

            stream = await client.chat.completions.create(**create_kwargs)

            usage_data = None
            tool_calls_acc: dict[int, dict] = {}  # index -> {id, name, arguments}
            finish_reason = None

            async for chunk in stream:
                if chunk.usage:
                    usage_data = {"input_tokens": chunk.usage.prompt_tokens, "output_tokens": chunk.usage.completion_tokens}
                delta = chunk.choices[0].delta if chunk.choices else None
                if chunk.choices:
                    finish_reason = chunk.choices[0].finish_reason or finish_reason

                if delta and delta.content:
                    yield delta.content

                # Accumulate tool call chunks
                if delta and delta.tool_calls:
                    for tc in delta.tool_calls:
                        idx = tc.index
                        if idx not in tool_calls_acc:
                            tool_calls_acc[idx] = {"id": tc.id or "", "name": "", "arguments": ""}
                        if tc.id:
                            tool_calls_acc[idx]["id"] = tc.id
                        if tc.function and tc.function.name:
                            tool_calls_acc[idx]["name"] = tc.function.name
                        if tc.function and tc.function.arguments:
                            tool_calls_acc[idx]["arguments"] += tc.function.arguments

            if usage_data:
                total_input += usage_data["input_tokens"]
                total_output += usage_data["output_tokens"]

            # Check if model wants to call tools
            if finish_reason != "tool_calls" or not tool_calls_acc:
                break

            # Build assistant message with tool_calls
            assistant_tool_calls = []
            for idx in sorted(tool_calls_acc.keys()):
                tc = tool_calls_acc[idx]
                assistant_tool_calls.append({
                    "id": tc["id"],
                    "type": "function",
                    "function": {"name": tc["name"], "arguments": tc["arguments"]},
                })
            oai_messages.append({"role": "assistant", "tool_calls": assistant_tool_calls, "content": None})

            # Execute tools and add results
            for tc in assistant_tool_calls:
                try:
                    args = json.loads(tc["function"]["arguments"])
                except json.JSONDecodeError:
                    args = {}
                result = await _execute_tool(tc["function"]["name"], args)
                oai_messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })

        yield {"input_tokens": total_input, "output_tokens": total_output}
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


def _is_gemini_exhausted_error(err_str: str) -> bool:
    """Check if error indicates quota/spending cap exhaustion (not transient rate limit)."""
    return "spending cap" in err_str or "billing" in err_str or ("quota" in err_str and "rate" not in err_str)


def _is_gemini_rate_limit(err_str: str) -> bool:
    """Check if error is a transient rate limit (retryable)."""
    return "429" in err_str or "resource_exhausted" in err_str or "rate limit" in err_str


def _gemini_tools() -> list[genai_types.Tool] | None:
    """Return Gemini-format tool definitions if Amazon search is available."""
    if not amazon_available():
        return None
    return [genai_types.Tool(function_declarations=[
        genai_types.FunctionDeclaration(
            name=AMAZON_SEARCH_TOOL["name"],
            description=AMAZON_SEARCH_TOOL["description"],
            parameters=AMAZON_SEARCH_TOOL["input_schema"],
        ),
    ])]


async def _stream_google_with_key(
    model: str, gemini_contents: list, config: genai_types.GenerateContentConfig, api_key: str,
) -> AsyncGenerator[str | dict, None]:
    """Attempt streaming with a single key, with exponential backoff for transient 429s."""
    client = genai.Client(api_key=api_key)
    max_retries = 3
    max_tool_rounds = 3
    contents = list(gemini_contents)  # copy to avoid mutating caller's list
    total_input = 0
    total_output = 0

    for _round in range(max_tool_rounds + 1):
        for attempt in range(max_retries):
            try:
                stream = await client.aio.models.generate_content_stream(
                    model=model, contents=contents, config=config,
                )
                usage_data = None
                function_calls = []
                async for chunk in stream:
                    if chunk.text:
                        yield chunk.text
                    if hasattr(chunk, "usage_metadata") and chunk.usage_metadata:
                        um = chunk.usage_metadata
                        usage_data = {
                            "input_tokens": getattr(um, "prompt_token_count", 0) or 0,
                            "output_tokens": getattr(um, "candidates_token_count", 0) or 0,
                        }
                    # Detect function calls
                    if chunk.candidates:
                        for candidate in chunk.candidates:
                            if candidate.content and candidate.content.parts:
                                for part in candidate.content.parts:
                                    if hasattr(part, "function_call") and part.function_call and part.function_call.name:
                                        function_calls.append(part.function_call)

                if usage_data:
                    total_input += usage_data["input_tokens"]
                    total_output += usage_data["output_tokens"]

                # If no function calls, we're done
                if not function_calls:
                    yield {"input_tokens": total_input, "output_tokens": total_output}
                    return

                # Execute function calls and build responses
                # Add model's response (with function_call parts) to contents
                fc_parts = [genai_types.Part.from_function_call(name=fc.name, args=dict(fc.args) if fc.args else {}) for fc in function_calls]
                contents.append(genai_types.Content(role="model", parts=fc_parts))

                # Execute and add function responses
                fr_parts = []
                for fc in function_calls:
                    args = dict(fc.args) if fc.args else {}
                    result_str = await _execute_tool(fc.name, args)
                    result_data = json.loads(result_str)
                    fr_parts.append(genai_types.Part.from_function_response(
                        name=fc.name,
                        response={"result": result_data},
                    ))
                contents.append(genai_types.Content(role="user", parts=fr_parts))
                break  # Success for this round, proceed to next tool round

            except Exception as e:
                err_str = str(e).lower()
                logger.warning("Gemini error (attempt %d/%d, model=%s): %s", attempt + 1, max_retries, model, e)
                if "api key" in err_str or "permission" in err_str or "401" in err_str or "403" in err_str:
                    raise ProviderAuthError("Google API key is invalid")
                if _is_gemini_exhausted_error(err_str):
                    raise ProviderSpendLimitError(str(e))
                if _is_gemini_rate_limit(err_str) and attempt < max_retries - 1:
                    wait = 2 ** attempt
                    logger.warning("Gemini 429, retry %d/%d after %ds", attempt + 1, max_retries, wait)
                    await asyncio.sleep(wait)
                    continue
                if _is_gemini_rate_limit(err_str):
                    raise ProviderRateLimitError(str(e))
                raise ProviderError(f"Gemini error: {e}")

    # Exhausted tool rounds
    yield {"input_tokens": total_input, "output_tokens": total_output}


async def stream_google(
    model: str,
    messages: list[dict],
    api_key: str | None,
    system_prompt: str | None = None,
    thinking: bool = False,
    fallback_key: str | None = None,
) -> AsyncGenerator[str, None]:
    gemini_contents = _convert_messages_for_gemini(messages)
    if not gemini_contents:
        return

    config = genai_types.GenerateContentConfig(max_output_tokens=4096)
    if thinking:
        config.thinking_config = genai_types.ThinkingConfig(thinking_budget=10000)
    if system_prompt:
        config.system_instruction = system_prompt
    gemini_tool_defs = _gemini_tools()
    if gemini_tool_defs:
        config.tools = gemini_tool_defs

    # Build key chain: user key (if provided) → free pool keys → fallback (paid) key
    keys_to_try: list[tuple[str, str]] = []  # (key, label)
    if api_key:
        keys_to_try.append((api_key, "user"))
    if not api_key and gemini_free_pool.available:
        # No user key: use free pool keys
        for i, k in enumerate(gemini_free_pool.get_all()):
            keys_to_try.append((k, f"free-pool-{i+1}"))
    if fallback_key:
        keys_to_try.append((fallback_key, "paid-fallback"))

    if not keys_to_try:
        raise ProviderError("Google APIキーが設定されていません。")

    last_error = None
    for key, label in keys_to_try:
        try:
            logger.info("Gemini: trying key [%s] for model %s", label, model)
            async for chunk in _stream_google_with_key(model, gemini_contents, config, key):
                yield chunk
            return  # Success
        except (ProviderSpendLimitError, ProviderRateLimitError) as e:
            logger.warning("Gemini key [%s] exhausted: %s", label, e)
            last_error = e
            continue  # Try next key
        except ProviderAuthError:
            logger.warning("Gemini key [%s] auth error, skipping", label)
            last_error = ProviderAuthError("Google API key is invalid")
            continue

    # All keys exhausted
    if isinstance(last_error, ProviderSpendLimitError):
        raise ProviderSpendLimitError("すべてのGoogle APIキーの利用上限に達しました。しばらく待ってから再度お試しください。")
    if isinstance(last_error, ProviderRateLimitError):
        raise ProviderRateLimitError("すべてのGoogle APIキーがレート制限に達しました。しばらく待ってから再度お試しください。")
    raise last_error or ProviderError("Google APIエラー")


# ── Dispatch ────────────────────────────────────────────────

STREAM_TIMEOUT_SECONDS = 300  # 5 minutes per stream


async def stream_provider(
    model: str,
    messages: list[dict],
    api_key: str,
    system_prompt: str | None = None,
    thinking: bool = False,
    google_fallback: str | None = None,
) -> AsyncGenerator[str | dict, None]:
    """Route to the correct provider's streaming function.
    Yields str chunks for content, and a final dict with usage info.
    For Google models, falls back to google_fallback key on quota/spending errors.
    """
    provider = get_provider(model)

    if provider == "anthropic":
        gen = stream_anthropic(model, messages, api_key, system_prompt, thinking=thinking)
    elif provider == "openai":
        gen = stream_openai(model, messages, api_key, system_prompt)
    elif provider == "google":
        gen = stream_google(model, messages, api_key, system_prompt, thinking=thinking, fallback_key=google_fallback)
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
