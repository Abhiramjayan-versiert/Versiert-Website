"""Local Ollama client.

* Only loopback URLs are accepted (enforced in config + re-checked here).
* All generation goes through a single-slot async queue, matching
  OLLAMA_NUM_PARALLEL=1 so the 6 GB GPU is never oversubscribed.
* The queue is bounded (llm_queue_limit); overflow raises QueueFull.
* Model "thinking" (qwen3 reasoning) is requested in a separate field and
  DISCARDED — it is never stored or shown to the user.
* There is no cloud fallback of any kind.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Type, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from backend.config import get_settings, is_cloud_model, is_loopback_url

log = logging.getLogger("aec.ollama")
T = TypeVar("T", bound=BaseModel)

_THINK_RE = re.compile(r"<think>.*?</think>", re.S)


class OllamaError(RuntimeError):
    """Ollama is unreachable or returned an error."""


class OllamaUnavailable(OllamaError):
    pass


class QueueFull(OllamaError):
    pass


class LocalOnlyViolation(OllamaError):
    pass


@dataclass
class LLMResult:
    content: str
    model: str
    prompt_tokens: int = 0
    output_tokens: int = 0
    duration_ms: int = 0
    tokens_per_sec: float = 0.0
    data: Any = None


@dataclass
class _QueueState:
    sem: asyncio.Semaphore | None = None
    waiting: int = 0
    running: int = 0
    capabilities: dict[str, list[str]] = field(default_factory=dict)


_state = _QueueState()


def _sem() -> asyncio.Semaphore:
    if _state.sem is None:
        _state.sem = asyncio.Semaphore(1)
    return _state.sem


def queue_status() -> dict:
    return {"running": _state.running, "waiting": _state.waiting, "limit": get_settings().llm_queue_limit}


def strip_thinking(text: str) -> str:
    text = _THINK_RE.sub("", text)
    if "</think>" in text:  # thinking leaked without an opening tag
        text = text.split("</think>", 1)[1]
    return text.strip()


def _base_url() -> str:
    url = get_settings().ollama_url
    if not is_loopback_url(url):
        raise LocalOnlyViolation("Configured Ollama URL is not local; refusing to send data.")
    return url


def _client(timeout: float | None = None) -> httpx.AsyncClient:
    # trust_env=False: never route local inference through a system proxy.
    return httpx.AsyncClient(base_url=_base_url(), timeout=timeout or get_settings().llm_timeout_seconds, trust_env=False)


def _check_model(model: str) -> None:
    if is_cloud_model(model):
        raise LocalOnlyViolation(f"Model '{model}' is a cloud model and is blocked in local-only mode.")


# ------------------------------------------------------------------ basic API
async def version() -> str:
    try:
        async with _client(5) as c:
            r = await c.get("/api/version")
            r.raise_for_status()
            return r.json().get("version", "unknown")
    except (httpx.HTTPError, OSError) as e:
        raise OllamaUnavailable(f"Ollama is not reachable at {get_settings().ollama_url}: {e}") from e


async def list_models() -> list[dict]:
    async with _client(10) as c:
        r = await c.get("/api/tags")
        r.raise_for_status()
        return r.json().get("models", [])


async def running_models() -> list[dict]:
    async with _client(10) as c:
        r = await c.get("/api/ps")
        r.raise_for_status()
        return r.json().get("models", [])


async def show_model(model: str) -> dict:
    async with _client(15) as c:
        r = await c.post("/api/show", json={"model": model})
        if r.status_code == 404:
            raise OllamaError(f"Model '{model}' is not installed. Install it from the Model Manager.")
        r.raise_for_status()
        return r.json()


async def capabilities(model: str) -> list[str]:
    if model not in _state.capabilities:
        try:
            info = await show_model(model)
            _state.capabilities[model] = info.get("capabilities", []) or []
        except OllamaError:
            raise
        except Exception:  # noqa: BLE001
            _state.capabilities[model] = []
    return _state.capabilities[model]


def forget_capabilities() -> None:
    _state.capabilities.clear()


async def unload(model: str) -> None:
    async with _client(30) as c:
        await c.post("/api/generate", json={"model": model, "keep_alive": 0})


# ------------------------------------------------------------------ generation
async def _acquire() -> None:
    s = get_settings()
    if _state.waiting + _state.running >= s.llm_queue_limit:
        raise QueueFull(f"The local AI queue is full ({s.llm_queue_limit} requests). Please wait for current tasks to finish.")
    _state.waiting += 1
    try:
        await _sem().acquire()
    finally:
        _state.waiting -= 1
    _state.running += 1


def _release() -> None:
    _state.running -= 1
    _sem().release()


async def chat(
    messages: list[dict],
    *,
    model: str | None = None,
    schema: dict | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
    num_ctx: int | None = None,
    think: bool | None = None,
) -> LLMResult:
    """Policy for thinking models (qwen3):
    * structured calls (schema) run with thinking OFF — output is grammar-
      constrained JSON, so it is fast and bounded (thinking could otherwise
      consume thousands of tokens on a 4k context);
    * free-text calls run with thinking ON (kept in a separate field and
      discarded), capped by num_predict; if the cap is hit before any answer,
      the call is retried once with thinking off."""
    s = get_settings()
    model = model or s.chat_model
    _check_model(model)
    caps = await capabilities(model)
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": False,
        "keep_alive": s.keep_alive,
        "options": {
            "num_ctx": num_ctx or s.context_length,
            "temperature": s.temperature if temperature is None else temperature,
        },
    }
    use_think = ("thinking" in caps) and (think if think is not None else schema is None)
    if "thinking" in caps:
        payload["think"] = use_think  # reasoning (if any) arrives in a separate field and is discarded
    payload["options"]["num_predict"] = max_tokens or (s.context_length // 2 if use_think else s.context_length // 2)
    if schema is not None:
        payload["format"] = schema
    await _acquire()
    t0 = time.perf_counter()
    try:
        async with _client() as c:
            try:
                r = await c.post("/api/chat", json=payload)
            except (httpx.ConnectError, httpx.ConnectTimeout) as e:
                raise OllamaUnavailable(f"Ollama is not reachable at {s.ollama_url}. Start Ollama and retry.") from e
            if r.status_code != 200:
                raise OllamaError(f"Ollama error {r.status_code}: {r.text[:300]}")
            d = r.json()
    finally:
        _release()
    content = strip_thinking(d.get("message", {}).get("content", "") or "")
    if use_think and not content and d.get("done_reason") == "length":
        log.info("thinking exhausted the token budget; retrying without thinking")
        return await chat(messages, model=model, schema=schema, temperature=temperature, max_tokens=max_tokens, num_ctx=num_ctx, think=False)
    ev = d.get("eval_count", 0) or 0
    evd = (d.get("eval_duration", 0) or 0) / 1e9
    return LLMResult(
        content=content,
        model=model,
        prompt_tokens=d.get("prompt_eval_count", 0) or 0,
        output_tokens=ev,
        duration_ms=int((time.perf_counter() - t0) * 1000),
        tokens_per_sec=round(ev / evd, 2) if evd else 0.0,
    )


def _extract_json(text: str) -> Any:
    text = strip_thinking(text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    for open_c, close_c in (("{", "}"), ("[", "]")):
        a, b = text.find(open_c), text.rfind(close_c)
        if a != -1 and b > a:
            try:
                return json.loads(text[a : b + 1])
            except json.JSONDecodeError:
                continue
    raise ValueError("Model did not return valid JSON")


async def chat_json(
    messages: list[dict],
    out_model: Type[T],
    *,
    retries: int = 1,
    **kw: Any,
) -> tuple[T, LLMResult]:
    """Structured output: JSON schema is enforced by Ollama, then validated by
    Pydantic. One repair retry on validation failure."""
    schema = out_model.model_json_schema()
    msgs = list(messages)
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        res = await chat(msgs, schema=schema, **kw)
        try:
            obj = out_model.model_validate(_extract_json(res.content))
            res.data = obj
            return obj, res
        except (ValueError, ValidationError) as e:
            last_err = e
            log.warning("JSON validation failed (attempt %s): %s", attempt + 1, str(e)[:200])
            msgs = msgs + [
                {"role": "assistant", "content": res.content[:2000]},
                {"role": "user", "content": "That output did not match the required JSON schema. Return ONLY valid JSON matching the schema."},
            ]
    raise OllamaError(f"Model output could not be parsed after {retries + 1} attempts: {last_err}")


async def embed(texts: list[str], model: str | None = None) -> list[list[float]]:
    s = get_settings()
    model = model or s.embedding_model
    _check_model(model)
    await _acquire()
    try:
        async with _client() as c:
            try:
                r = await c.post("/api/embed", json={"model": model, "input": texts, "keep_alive": s.keep_alive, "truncate": True})
            except (httpx.ConnectError, httpx.ConnectTimeout) as e:
                raise OllamaUnavailable(f"Ollama is not reachable at {s.ollama_url}.") from e
            if r.status_code != 200:
                raise OllamaError(f"Embedding error {r.status_code}: {r.text[:300]}")
            return r.json()["embeddings"]
    finally:
        _release()


async def pull(model: str) -> AsyncIterator[dict]:
    _check_model(model)
    async with httpx.AsyncClient(base_url=_base_url(), timeout=None, trust_env=False) as c:
        async with c.stream("POST", "/api/pull", json={"model": model, "stream": True}) as r:
            async for line in r.aiter_lines():
                if line.strip():
                    yield json.loads(line)


async def delete(model: str) -> None:
    async with _client(60) as c:
        r = await c.request("DELETE", "/api/delete", json={"model": model})
        if r.status_code not in (200, 404):
            raise OllamaError(f"Delete failed: {r.text[:200]}")
