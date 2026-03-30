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
from backend.flight_search import FLIGHT_SEARCH_TOOL, search_flights, is_available as flights_available
from backend.maps_search import MAPS_SEARCH_TOOL, search_maps, is_available as maps_available
from backend.image_search import IMAGE_SEARCH_TOOL, search_images, is_available as images_available
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

# Models allowed to use free pool keys (Tier 1: only Flash Lite is $0)
GEMINI_FREE_POOL_MODELS = {"gemini-2.5-flash-lite"}


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
    # Anthropic (cheapest first)
    "claude-haiku-4-5-20251001":  {"provider": "anthropic", "label": "Claude Haiku 4.5",   "supports_images": True,  "supports_web_search": True,  "input_price": 0.80,  "output_price": 4.0},
    "claude-sonnet-4-6":          {"provider": "anthropic", "label": "Claude Sonnet 4.6",  "supports_images": True,  "supports_web_search": True,  "input_price": 3.0,   "output_price": 15.0},
    "claude-opus-4-6":            {"provider": "anthropic", "label": "Claude Opus 4.6",    "supports_images": True,  "supports_web_search": True,  "input_price": 15.0,  "output_price": 75.0},
    # OpenAI (cheapest first)
    "gpt-4o-mini":                {"provider": "openai",    "label": "GPT-4o mini",    "supports_images": True,  "supports_web_search": True,  "input_price": 0.15,  "output_price": 0.60},
    "o3-mini":                    {"provider": "openai",    "label": "o3-mini",         "supports_images": False, "supports_web_search": False, "input_price": 1.10,  "output_price": 4.40},
    "gpt-4o":                     {"provider": "openai",    "label": "GPT-4o",         "supports_images": True,  "supports_web_search": True,  "input_price": 2.50,  "output_price": 10.0},
    # Google (cheapest first)
    "gemini-2.5-flash-lite":      {"provider": "google",    "label": "Gemini 2.5 Flash Lite", "supports_images": True, "supports_web_search": True,  "input_price": 0.075, "output_price": 0.30},
    "gemini-2.5-flash":           {"provider": "google",    "label": "Gemini 2.5 Flash", "supports_images": True, "supports_web_search": True,  "input_price": 0.15,  "output_price": 0.60},
    "gemini-2.5-pro":             {"provider": "google",    "label": "Gemini 2.5 Pro",   "supports_images": True, "supports_web_search": True,  "input_price": 1.25,  "output_price": 10.0},
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


# ── Tool filtering ──────────────────────────────────────────

import re

_AMAZON_KEYWORDS = re.compile(
    r'amazon|アマゾン|リンク.{0,5}(探|教|検索|調)|'
    r'(探|教|検索|調).{0,5}リンク|リンク付',
    re.IGNORECASE,
)
_MAPS_KEYWORDS = re.compile(
    r'営業|開い[てる]|閉[まめ店]|やって[るい]|閉業|閉店|'
    r'(確認|チェック).{0,5}(店|レストラン|カフェ|ホテル)|'
    r'(店|レストラン|カフェ|ホテル).{0,5}(確認|チェック)|'
    r'google\s*maps|グーグルマップ',
    re.IGNORECASE,
)
_FLIGHT_KEYWORDS = re.compile(
    r'フライト|飛行機|航空|空港|航空券|チケット|'
    r'flight|plane|ticket|airline|'
    r'行.{0,3}(飛行|便)|便.{0,3}(調|探|検索)',
    re.IGNORECASE,
)
_IMAGE_KEYWORDS = re.compile(
    r'画像.{0,5}(見|探|検索|拾|持|出)|'
    r'(見|探|検索|拾|持|出).{0,5}画像|'
    r'スクリーンショット|スクショ|写真.{0,3}(見|探|検索)|'
    r'image|screenshot|photo.{0,3}(search|find)',
    re.IGNORECASE,
)


def _filter_tools_by_message(messages: list[dict]) -> set[str]:
    """Determine which custom tools to include based on the latest user message."""
    # Get last user message text
    last_msg = ""
    for m in reversed(messages):
        if m.get("role") == "user":
            content = m.get("content", "")
            if isinstance(content, str):
                last_msg = content
            elif isinstance(content, list):
                last_msg = " ".join(b.get("text", "") for b in content if b.get("type") == "text")
            break

    active = set()
    if _FLIGHT_KEYWORDS.search(last_msg):
        active.add("flight_search")
    if _AMAZON_KEYWORDS.search(last_msg):
        active.add("amazon_product_search")
    if _MAPS_KEYWORDS.search(last_msg):
        active.add("google_maps_search")
    if _IMAGE_KEYWORDS.search(last_msg):
        active.add("image_search")
    return active


# ── Anthropic (Claude) ──────────────────────────────────────

def _tool_status_message(name: str, input_data: dict) -> str:
    """Generate a human-readable status message for a tool call."""
    if name == "flight_search":
        origin = input_data.get("origin", "")
        dest = input_data.get("destination", "")
        month = input_data.get("departure_month", "")
        return f"<!--STATUS:🔍 {origin}→{dest} {month} のフライトを検索中...-->"
    if name == "amazon_product_search":
        query = input_data.get("query", "")
        return f"<!--STATUS:🔍 「{query}」をAmazonで検索中...-->"
    if name == "google_maps_search":
        query = input_data.get("query", "")
        return f"<!--STATUS:📍 「{query}」をGoogle Mapsで確認中...-->"
    if name == "image_search":
        query = input_data.get("query", "")
        return f"<!--STATUS:🖼️ 「{query}」の画像を検索中...-->"
    return ""


async def _execute_tool(name: str, input_data: dict) -> str:
    """Execute a tool call and return the result as a string."""
    try:
        from backend.serpapi_monitor import record_usage
        if name in ("amazon_product_search", "flight_search", "google_maps_search"):
            record_usage(name)
        if name == "amazon_product_search":
            results = await search_amazon(
                query=input_data.get("query", ""),
                max_results=int(input_data.get("max_results", 3)),
            )
            return json.dumps(results, ensure_ascii=False)
        if name == "flight_search":
            results = await search_flights(
                origin=input_data.get("origin", ""),
                destination=input_data.get("destination", ""),
                departure_month=input_data.get("departure_month", ""),
                departure_day_from=int(input_data.get("departure_day_from", 1)),
                departure_day_to=int(input_data.get("departure_day_to", 10)),
                return_month=input_data.get("return_month", ""),
                return_day_from=int(input_data.get("return_day_from", 0)),
                return_day_to=int(input_data.get("return_day_to", 0)),
                trip_weeks=int(input_data.get("trip_weeks", 2)),
                adults=int(input_data.get("adults", 1)),
                # Legacy support
                departure_date=input_data.get("departure_date", ""),
                return_date=input_data.get("return_date"),
            )
            return json.dumps(results, ensure_ascii=False)
        if name == "google_maps_search":
            results = await search_maps(query=input_data.get("query", ""))
            return json.dumps(results, ensure_ascii=False)
        if name == "image_search":
            results = await search_images(
                query=input_data.get("query", ""),
                max_results=int(input_data.get("max_results", 3)),
            )
            return json.dumps(results, ensure_ascii=False)
        return json.dumps({"error": f"Unknown tool: {name}"})
    except Exception as e:
        logger.error("Tool execution error (%s): %s", name, repr(e), exc_info=True)
        return json.dumps({"error": f"Tool execution failed: {repr(e)}"})


async def stream_anthropic(
    model: str,
    messages: list[dict],
    api_key: str,
    system_prompt: str | None = None,
    thinking: bool = False,
    disable_tools: bool = False,
    web_search_only: bool = False,
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
    # Tools: web search (Claude built-in) + custom tools
    if not disable_tools:
        tools: list[dict] = []
        if MODEL_REGISTRY.get(model, {}).get("supports_web_search"):
            tools.append({"type": "web_search_20250305", "name": "web_search", "max_uses": 3})
        if not web_search_only:
            active = _filter_tools_by_message(messages)
            if amazon_available() and "amazon_product_search" in active:
                tools.append(AMAZON_SEARCH_TOOL)
            if flights_available() and "flight_search" in active:
                tools.append(FLIGHT_SEARCH_TOOL)
            if maps_available() and "google_maps_search" in active:
                tools.append(MAPS_SEARCH_TOOL)
            if images_available() and "image_search" in active:
                tools.append(IMAGE_SEARCH_TOOL)
        if tools:
            kwargs["tools"] = tools
    if system_prompt:
        kwargs["system"] = system_prompt

    total_input_tokens = 0
    total_output_tokens = 0
    max_tool_rounds = 3  # Prevent infinite tool loops
    has_web_search = any(t.get("type", "").startswith("web_search") for t in kwargs.get("tools", []))

    try:
        for _round in range(max_tool_rounds + 1):
            try:
                async with client.messages.stream(**kwargs) as stream:
                    async for text in stream.text_stream:
                        yield text
                    final = await stream.get_final_message()
            except Exception as e:
                if has_web_search and _round == 0:
                    # Web search may have caused the error — retry without it
                    logger.warning("Anthropic stream error with web_search, retrying without: %s", repr(e))
                    kwargs["tools"] = [t for t in kwargs.get("tools", []) if not t.get("type", "").startswith("web_search")]
                    if not kwargs["tools"]:
                        del kwargs["tools"]
                    has_web_search = False
                    kwargs["messages"] = list(messages)  # reset messages
                    async with client.messages.stream(**kwargs) as stream:
                        async for text in stream.text_stream:
                            yield text
                        final = await stream.get_final_message()
                else:
                    raise

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
                status = _tool_status_message(block.name, block.input)
                if status:
                    yield status
                result = await _execute_tool(block.name, block.input)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result,
                })
            yield "<!--STATUS:-->"  # Clear status
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


def _openai_tools(messages: list[dict]) -> list[dict] | None:
    """Return OpenAI-format tool definitions for available tools."""
    active = _filter_tools_by_message(messages)
    tools = []
    if amazon_available() and "amazon_product_search" in active:
        tools.append({"type": "function", "function": {"name": AMAZON_SEARCH_TOOL["name"], "description": AMAZON_SEARCH_TOOL["description"], "parameters": AMAZON_SEARCH_TOOL["input_schema"]}})
    if flights_available() and "flight_search" in active:
        tools.append({"type": "function", "function": {"name": FLIGHT_SEARCH_TOOL["name"], "description": FLIGHT_SEARCH_TOOL["description"], "parameters": FLIGHT_SEARCH_TOOL["input_schema"]}})
    if maps_available() and "google_maps_search" in active:
        tools.append({"type": "function", "function": {"name": MAPS_SEARCH_TOOL["name"], "description": MAPS_SEARCH_TOOL["description"], "parameters": MAPS_SEARCH_TOOL["input_schema"]}})
    if images_available() and "image_search" in active:
        tools.append({"type": "function", "function": {"name": IMAGE_SEARCH_TOOL["name"], "description": IMAGE_SEARCH_TOOL["description"], "parameters": IMAGE_SEARCH_TOOL["input_schema"]}})
    return tools or None


async def stream_openai(
    model: str,
    messages: list[dict],
    api_key: str,
    system_prompt: str | None = None,
    disable_tools: bool = False,
    web_search_only: bool = False,
) -> AsyncGenerator[str, None]:
    client = AsyncOpenAI(api_key=api_key)
    oai_messages = _convert_messages_for_openai(messages, model, system_prompt)

    # o-series models (o1, o3, etc.) require max_completion_tokens instead of max_tokens
    token_param = "max_completion_tokens" if model.startswith("o") else "max_tokens"
    tools = None if disable_tools else _openai_tools(oai_messages)
    max_tool_rounds = 3
    total_input = 0
    total_output = 0

    # Web search setup
    has_web_search_support = MODEL_REGISTRY.get(model, {}).get("supports_web_search", False)
    has_images = any(isinstance(m.get("content"), list) and any(b.get("type") == "image_url" for b in m["content"] if isinstance(b, dict)) for m in oai_messages)
    search_model_map = {"gpt-4o": "gpt-4o-search-preview", "gpt-4o-mini": "gpt-4o-mini-search-preview"}
    can_web_search = has_web_search_support and model in search_model_map and not disable_tools and not has_images

    # Flight search: web_search first (airport code verification), then function_calling
    active_tools = _filter_tools_by_message(oai_messages) if not disable_tools else set()
    has_flight = "flight_search" in active_tools
    flight_phase = "search" if has_flight and tools and can_web_search else None  # "search" → "tools"

    # Determine initial web_search state
    use_web_search = can_web_search and (not tools or flight_phase == "search")

    try:
        # 2-step image handling for OpenAI (same as Gemini)
        if has_images and has_web_search_support and model in search_model_map and not disable_tools:
            # Step 1: Image recognition with regular model (no web search)
            img_kwargs: dict = dict(
                model=model, messages=oai_messages,
                stream=False, **{token_param: 1024},
            )
            img_response = await client.chat.completions.create(**img_kwargs)
            image_description = img_response.choices[0].message.content or ""
            total_input += img_response.usage.prompt_tokens if img_response.usage else 0
            total_output += img_response.usage.completion_tokens if img_response.usage else 0

            # Step 2: Search with text-only query
            last_user_text = ""
            for m in reversed(messages):
                if m.get("role") == "user":
                    c = m.get("content", "")
                    last_user_text = c if isinstance(c, str) else " ".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")
                    break
            combined_query = f"[画像の内容: {image_description}]\n\nユーザーの質問: {last_user_text}"
            search_messages = [{"role": "system", "content": system_prompt}] if system_prompt else []
            search_messages.append({"role": "user", "content": combined_query})

            search_kwargs: dict = dict(
                model=search_model_map[model], messages=search_messages,
                stream=True, stream_options={"include_usage": True},
                web_search_options={"search_context_size": "medium"},
                **{token_param: 4096},
            )
            stream = await client.chat.completions.create(**search_kwargs)
            async for chunk in stream:
                if chunk.usage:
                    total_input += chunk.usage.prompt_tokens
                    total_output += chunk.usage.completion_tokens
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta and delta.content:
                    yield delta.content
            yield {"input_tokens": total_input, "output_tokens": total_output}
            return

        # For flight search phase, use airport-specific system prompt
        airport_search_messages = None
        if flight_phase == "search":
            from datetime import date as _date
            _today = _date.today()
            airport_prompt = (
                f"今日は{_today.isoformat()}です。年は{_today.year}年です。"
                "あなたはフライト検索アシスタントです。ユーザーのメッセージに含まれる目的地の都市について、"
                "その都市にある全ての空港名とIATAコードをWeb検索で調べてください。"
                "もし空港が2つ以上ある場合は、全ての空港名とコードを一覧にして「どちらの空港をご希望ですか？」と質問してください。"
                "空港が1つだけの場合は、その空港名とコードを回答してください。"
                "注意: カンボジアのプノンペンはPNHではなくKTI、シェムリアップはREPではなくSAIです。"
                "東京(NRT/HND)と大阪(KIX/ITM)の場合は質問せず、両方のコードを回答してください。"
            )
            # Extract last user message
            last_user_msg = ""
            for m in reversed(oai_messages):
                if m.get("role") == "user":
                    c = m.get("content", "")
                    last_user_msg = c if isinstance(c, str) else str(c)
                    break
            airport_search_messages = [
                {"role": "system", "content": airport_prompt},
                {"role": "user", "content": last_user_msg},
            ]

        for _round in range(max_tool_rounds + 1):
            active_model = search_model_map.get(model, model) if use_web_search else model
            create_kwargs: dict = dict(
                model=active_model,
                messages=airport_search_messages if (flight_phase == "search" and use_web_search and airport_search_messages) else oai_messages,
                stream=True,
                stream_options={"include_usage": True},
                **{token_param: 4096},
            )
            if tools and not use_web_search:
                create_kwargs["tools"] = tools
            if use_web_search:
                create_kwargs["web_search_options"] = {"search_context_size": "medium"}

            stream = await client.chat.completions.create(**create_kwargs)

            usage_data = None
            tool_calls_acc: dict[int, dict] = {}  # index -> {id, name, arguments}
            finish_reason = None
            streamed_text = []  # Accumulate text for question detection

            async for chunk in stream:
                if chunk.usage:
                    usage_data = {"input_tokens": chunk.usage.prompt_tokens, "output_tokens": chunk.usage.completion_tokens}
                delta = chunk.choices[0].delta if chunk.choices else None
                if chunk.choices:
                    finish_reason = chunk.choices[0].finish_reason or finish_reason

                if delta and delta.content:
                    yield delta.content
                    if flight_phase == "search":
                        streamed_text.append(delta.content)

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
                # Flight search 2-step: check if model asked about airports
                if flight_phase == "search":
                    search_response = "".join(streamed_text)
                    if "？" in search_response or "?" in search_response:
                        break  # Model asked about airports → stop, wait for user
                    flight_phase = "tools"
                    use_web_search = False
                    airport_search_messages = None  # Use original messages for tools phase
                    continue  # Next round with function_calling tools
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
                    logger.warning("Failed to parse tool arguments for %s: %s", tc["function"]["name"], tc["function"]["arguments"][:200])
                    args = {}
                status = _tool_status_message(tc["function"]["name"], args)
                if status:
                    yield status
                result = await _execute_tool(tc["function"]["name"], args)
                oai_messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })
            yield "<!--STATUS:-->"  # Clear status

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
    """Check if error is a transient rate limit or temporary unavailability (retryable)."""
    return "429" in err_str or "resource_exhausted" in err_str or "rate limit" in err_str or "503" in err_str or "unavailable" in err_str


def _gemini_function_tools(messages: list) -> list[genai_types.Tool] | None:
    """Return Gemini function calling tools filtered by user message content."""
    # Convert Gemini Content objects to dicts for keyword filtering
    msg_dicts = []
    for c in messages:
        if hasattr(c, "role") and hasattr(c, "parts"):
            text = " ".join(getattr(p, "text", "") or "" for p in c.parts if hasattr(p, "text"))
            msg_dicts.append({"role": c.role, "content": text})
        elif isinstance(c, dict):
            msg_dicts.append(c)
    active = _filter_tools_by_message(msg_dicts) if msg_dicts else set()

    declarations = []
    if amazon_available() and "amazon_product_search" in active:
        declarations.append(genai_types.FunctionDeclaration(name=AMAZON_SEARCH_TOOL["name"], description=AMAZON_SEARCH_TOOL["description"], parameters=AMAZON_SEARCH_TOOL["input_schema"]))
    if flights_available() and "flight_search" in active:
        declarations.append(genai_types.FunctionDeclaration(name=FLIGHT_SEARCH_TOOL["name"], description=FLIGHT_SEARCH_TOOL["description"], parameters=FLIGHT_SEARCH_TOOL["input_schema"]))
    if maps_available() and "google_maps_search" in active:
        declarations.append(genai_types.FunctionDeclaration(name=MAPS_SEARCH_TOOL["name"], description=MAPS_SEARCH_TOOL["description"], parameters=MAPS_SEARCH_TOOL["input_schema"]))
    if images_available() and "image_search" in active:
        declarations.append(genai_types.FunctionDeclaration(name=IMAGE_SEARCH_TOOL["name"], description=IMAGE_SEARCH_TOOL["description"], parameters=IMAGE_SEARCH_TOOL["input_schema"]))
    return [genai_types.Tool(function_declarations=declarations)] if declarations else None


def _gemini_search_tool() -> list[genai_types.Tool]:
    """Return Gemini Google Search Grounding tool."""
    return [genai_types.Tool(google_search=genai_types.GoogleSearch())]


async def _stream_google_with_key(
    model: str, gemini_contents: list, config: genai_types.GenerateContentConfig, api_key: str,
    enable_search: bool = False, has_tool_keywords: bool = False,
    func_tools_for_later: list | None = None,
) -> AsyncGenerator[str | dict, None]:
    """Attempt streaming with a single key, with exponential backoff for transient 429s."""
    client = genai.Client(api_key=api_key)
    max_retries = 3
    max_tool_rounds = 3
    contents = list(gemini_contents)  # copy to avoid mutating caller's list
    total_input = 0
    total_output = 0
    used_function_calling = False
    is_first_round = True
    tool_retry_done = False
    switched_to_function_calling = False
    for _round in range(max_tool_rounds + 1):
        for attempt in range(max_retries):
            try:
                stream = await client.aio.models.generate_content_stream(
                    model=model, contents=contents, config=config,
                )
                usage_data = None
                function_calls = []
                buffered_text = []
                async for chunk in stream:
                    if chunk.text:
                        if is_first_round and enable_search:
                            # Buffer text on first round — may discard if switching to google_search
                            buffered_text.append(chunk.text)
                        else:
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

                # If no function calls, done or switch tools
                if not function_calls:
                    if not used_function_calling and enable_search:
                        if func_tools_for_later and not switched_to_function_calling:
                            # google_search phase done → check if model is asking a question
                            buffered_str = "".join(buffered_text)
                            if "？" in buffered_str or "?" in buffered_str:
                                # Model is asking user a question (e.g. which airport)
                                # Show the question and stop — don't proceed to flight_search
                                for t in buffered_text:
                                    yield t
                                yield {"input_tokens": total_input, "output_tokens": total_output}
                                return
                            # No question — switch to function_calling
                            config.tools = func_tools_for_later
                            switched_to_function_calling = True
                            is_first_round = False
                            enable_search = False
                            break  # Retry with function_calling tools
                        if has_tool_keywords and not tool_retry_done:
                            # Tool keywords detected but model didn't call tools — retry once
                            tool_retry_done = True
                            is_first_round = False
                            break  # Retry with same function_calling tools
                        # No tool use at all → discard buffered text, switch to google_search
                        config.tools = _gemini_search_tool()
                        enable_search = False
                        is_first_round = False
                        break  # Retry with google_search
                    # Done — flush any buffered text
                    for t in buffered_text:
                        yield t
                    yield {"input_tokens": total_input, "output_tokens": total_output}
                    return

                # Function calls found — flush buffered text before executing
                for t in buffered_text:
                    yield t
                is_first_round = False

                # Execute function calls and build responses
                used_function_calling = True
                fc_parts = [genai_types.Part.from_function_call(name=fc.name, args=dict(fc.args) if fc.args else {}) for fc in function_calls]
                contents.append(genai_types.Content(role="model", parts=fc_parts))

                # Execute and add function responses
                fr_parts = []
                for fc in function_calls:
                    args = dict(fc.args) if fc.args else {}
                    status = _tool_status_message(fc.name, args)
                    if status:
                        yield status
                    result_str = await _execute_tool(fc.name, args)
                    result_data = json.loads(result_str)
                    fr_parts.append(genai_types.Part.from_function_response(
                        name=fc.name,
                        response={"result": result_data},
                    ))
                contents.append(genai_types.Content(role="user", parts=fr_parts))
                yield "<!--STATUS:-->"  # Clear status
                break  # Success for this round, proceed to next tool round

            except Exception as e:
                err_str = str(e).lower()
                logger.warning("Gemini error (attempt %d/%d, model=%s): %s", attempt + 1, max_retries, model, e)
                if "api key" in err_str or "permission" in err_str or "401" in err_str or "403" in err_str:
                    raise ProviderAuthError("Google API key is invalid")
                # If combining google_search + function_calling is not supported,
                # fall back to google_search only and retry
                if "google_search" in err_str and "function" in err_str:
                    logger.warning("Gemini: combined tools not supported, falling back to google_search only")
                    config.tools = _gemini_search_tool()
                    continue
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
    disable_tools: bool = False,
    web_search_only: bool = False,
) -> AsyncGenerator[str, None]:
    gemini_contents = _convert_messages_for_gemini(messages)
    if not gemini_contents:
        return

    config = genai_types.GenerateContentConfig(max_output_tokens=4096)
    if thinking:
        config.thinking_config = genai_types.ThinkingConfig(thinking_budget=10000)
    if system_prompt:
        config.system_instruction = system_prompt
    enable_search = False
    has_flight = False
    func_tools = None
    # Detect if message contains images (google_search grounding is incompatible with images)
    has_images = any(
        hasattr(p, "inline_data") and p.inline_data
        for c in gemini_contents if hasattr(c, "parts")
        for p in c.parts
    )
    if not disable_tools:
        if has_images:
            # google_search grounding is incompatible with image inputs.
            # 2-step approach: first recognize image (no tools), then search with text.
            # Image recognition happens in the streaming loop below.
            pass
        elif web_search_only:
            config.tools = _gemini_search_tool()
        else:
            msg_dicts = []
            for c in gemini_contents:
                if hasattr(c, "role") and hasattr(c, "parts"):
                    text = " ".join(getattr(p, "text", "") or "" for p in c.parts if hasattr(p, "text"))
                    msg_dicts.append({"role": c.role, "content": text})
            active_tools = _filter_tools_by_message(msg_dicts)
            has_flight = "flight_search" in active_tools
            func_tools = _gemini_function_tools(gemini_contents)

            if has_flight and func_tools:
                config.tools = _gemini_search_tool()
                enable_search = True
                # Override system prompt for airport search phase
                # Extract destination city from user message for targeted search
                last_text = ""
                for m in reversed(msg_dicts):
                    if m.get("role") == "user":
                        last_text = m.get("content", "")
                        break
                from datetime import date as _date
                _today = _date.today()
                config.system_instruction = (
                    f"今日は{_today.isoformat()}です。年は{_today.year}年です。"
                    "あなたはフライト検索アシスタントです。ユーザーのメッセージに含まれる目的地の都市について、"
                    "その都市にある全ての空港名とIATAコードをWeb検索で調べてください。"
                    "もし空港が2つ以上ある場合は、全ての空港名とコードを一覧にして「どちらの空港をご希望ですか？」と質問してください。"
                    "空港が1つだけの場合は、その空港名とコードを回答してください。"
                    "注意: カンボジアのプノンペンはPNHではなくKTI（テチョー国際空港）、シェムリアップはREPではなくSAI（シェムリアップ・アンコール国際空港）です。"
                    "東京(NRT/HND)と大阪(KIX/ITM)の場合は質問せず、両方のコードを回答してください。"
                )
            elif func_tools:
                config.tools = func_tools
                enable_search = True
            else:
                config.tools = _gemini_search_tool()

    has_tool_keywords = enable_search

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

            # 2-step image handling: recognize image first, then search with text
            if has_images and not disable_tools:
                try:
                    client = genai.Client(api_key=key)
                    # Step 1: Image recognition (no tools, with image)
                    img_config = genai_types.GenerateContentConfig(max_output_tokens=1024)
                    img_config.system_instruction = "Describe what you see in the image concisely in the same language as the user's message."
                    img_response = await client.aio.models.generate_content(
                        model=model, contents=gemini_contents, config=img_config,
                    )
                    image_description = img_response.text or ""
                    logger.info("Gemini image recognition: %s", image_description[:100])

                    # Step 2: Build text-only query with image description + user question
                    last_user_text = ""
                    for c in reversed(gemini_contents):
                        if hasattr(c, "role") and c.role == "user":
                            for p in c.parts:
                                if hasattr(p, "text") and p.text:
                                    last_user_text = p.text
                                    break
                            break

                    combined_query = f"[画像の内容: {image_description}]\n\nユーザーの質問: {last_user_text}"
                    text_contents = [genai_types.Content(role="user", parts=[genai_types.Part.from_text(text=combined_query)])]
                    text_config = genai_types.GenerateContentConfig(max_output_tokens=4096)
                    if system_prompt:
                        text_config.system_instruction = system_prompt
                    text_config.tools = _gemini_search_tool()

                    # Stream the search-enhanced response
                    stream = await client.aio.models.generate_content_stream(
                        model=model, contents=text_contents, config=text_config,
                    )
                    total_input = 0
                    total_output = 0
                    async for chunk in stream:
                        if chunk.text:
                            yield chunk.text
                        if hasattr(chunk, "usage_metadata") and chunk.usage_metadata:
                            um = chunk.usage_metadata
                            total_input += getattr(um, "prompt_token_count", 0) or 0
                            total_output += getattr(um, "candidates_token_count", 0) or 0
                    yield {"input_tokens": total_input, "output_tokens": total_output}
                    return  # Success
                except Exception as e:
                    # Fallback: answer with image directly, no web search
                    logger.warning("Gemini 2-step image processing failed, falling back: %s", repr(e))
                    fallback_config = genai_types.GenerateContentConfig(max_output_tokens=4096)
                    if system_prompt:
                        fallback_config.system_instruction = system_prompt
                    client = genai.Client(api_key=key)
                    stream = await client.aio.models.generate_content_stream(
                        model=model, contents=gemini_contents, config=fallback_config,
                    )
                    total_input = 0
                    total_output = 0
                    async for chunk in stream:
                        if chunk.text:
                            yield chunk.text
                        if hasattr(chunk, "usage_metadata") and chunk.usage_metadata:
                            um = chunk.usage_metadata
                            total_input += getattr(um, "prompt_token_count", 0) or 0
                            total_output += getattr(um, "candidates_token_count", 0) or 0
                    yield {"input_tokens": total_input, "output_tokens": total_output}
                    return

            async for chunk in _stream_google_with_key(model, gemini_contents, config, key, enable_search=enable_search, has_tool_keywords=has_tool_keywords, func_tools_for_later=func_tools if has_flight else None):
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
    disable_tools: bool = False,
    web_search_only: bool = False,
) -> AsyncGenerator[str | dict, None]:
    """Route to the correct provider's streaming function.
    Yields str chunks for content, and a final dict with usage info.
    For Google models, falls back to google_fallback key on quota/spending errors.
    """
    provider = get_provider(model)

    if provider == "anthropic":
        gen = stream_anthropic(model, messages, api_key, system_prompt, thinking=thinking, disable_tools=disable_tools, web_search_only=web_search_only)
    elif provider == "openai":
        gen = stream_openai(model, messages, api_key, system_prompt, disable_tools=disable_tools, web_search_only=web_search_only)
    elif provider == "google":
        gen = stream_google(model, messages, api_key, system_prompt, thinking=thinking, fallback_key=google_fallback, disable_tools=disable_tools, web_search_only=web_search_only)
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
