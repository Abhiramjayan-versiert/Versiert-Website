"""Shared API dependencies and the background-task helper."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from backend.agents.runtime import ApprovalRequired, TaskCancelled, Tracker, register_running
from backend.database.session import get_db
from backend.models.entities import ExamProfile, User
from backend.security.auth import current_user, get_profile
from backend.services import ollama

log = logging.getLogger("aec.tasks")

DB = Depends(get_db)
USER = Depends(current_user)


def profile_dep(profile_id: int, db: Session = DB, user: User = USER) -> ExamProfile:
    return get_profile(db, user, profile_id)


def spawn(tracker: Tracker, work: Callable[[], Awaitable[Any]], on_result: Callable[[Any], dict] | None = None) -> int:
    """Run agent work in the background; status is visible on Agent Activity
    and the task can be cancelled."""

    async def runner():
        try:
            res = await work()
            tracker.finish("completed", result_ref=on_result(res) if on_result else None)
        except (TaskCancelled, asyncio.CancelledError):
            tracker.finish("cancelled", "Cancelled by user")
        except ApprovalRequired:
            pass
        except (ollama.OllamaUnavailable, ollama.QueueFull) as e:
            tracker.finish("failed", str(e))
        except Exception as e:  # noqa: BLE001
            log.exception("task %s failed", tracker.id)
            tracker.finish("failed", str(e) or repr(e))

    task = asyncio.create_task(runner())
    register_running(tracker.id, task)
    return tracker.id


def require(cond: bool, status: int, msg: str) -> None:
    if not cond:
        raise HTTPException(status, msg)
