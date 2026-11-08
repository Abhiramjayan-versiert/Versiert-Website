"""In-memory sliding-window rate limiter (single-process app)."""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

_hits: dict[str, deque] = defaultdict(deque)


def check(key: str, limit: int, window: float = 60.0) -> None:
    now = time.monotonic()
    q = _hits[key]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        retry = int(window - (now - q[0])) + 1
        raise HTTPException(429, f"Too many requests. Try again in {retry}s.", headers={"Retry-After": str(retry)})
    q.append(now)


def reset() -> None:
    _hits.clear()


def limit_ai(request: Request) -> None:
    from backend.config import get_settings

    who = getattr(request.state, "user_id", None) or (request.client.host if request.client else "anon")
    check(f"ai:{who}", get_settings().ai_rate_per_minute)
