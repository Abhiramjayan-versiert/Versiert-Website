"""Agent runtime: task tracking, controlled tool registry, cancellation and
approvals.

Agents never get a shell. They can only call tools registered here; each
tool declares its purpose, a Pydantic input model, a permission level, a
timeout, and is logged on the AgentTask that invoked it. Destructive tools
cannot run without an explicit user approval recorded on the task."""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from pydantic import BaseModel, ValidationError

from backend.config import get_settings
from backend.database.session import db_session
from backend.models.entities import AgentTask, utcnow

log = logging.getLogger("aec.agents")

AGENT_NAMES = {
    "orchestrator": "Master Orchestrator",
    "syllabus": "Syllabus Analyst",
    "tutor": "AI Tutor",
    "planner": "Study Planner",
    "questions": "Question Paper Generator",
    "evaluator": "Answer Evaluator",
    "revision": "Revision Coach",
    "analyst": "Performance Analyst",
    "librarian": "Document Librarian",
}

# ------------------------------------------------------------------ task tracking
_running: dict[int, asyncio.Task] = {}


class TaskCancelled(Exception):
    pass


class ApprovalRequired(Exception):
    def __init__(self, task_id: int, action: str, detail: dict):
        super().__init__(action)
        self.task_id, self.action, self.detail = task_id, action, detail


class Tracker:
    """Records a concise, user-facing activity log for one agent task.
    Only short summaries are stored — never model reasoning."""

    def __init__(self, agent: str, summary: str, profile_id: int | None = None, parent_id: int | None = None):
        with db_session() as db:
            t = AgentTask(agent=agent, summary=summary[:300], profile_id=profile_id, parent_id=parent_id,
                          status="running", started_at=utcnow(), model=get_settings().chat_model)
            db.add(t)
            db.flush()
            self.id = t.id
        self.agent = agent
        self.profile_id = profile_id
        self._t0 = time.perf_counter()

    def step(self, message: str) -> None:
        with db_session() as db:
            t = db.get(AgentTask, self.id)
            if t.status == "cancelled":
                raise TaskCancelled()
            t.steps = [*t.steps, {"at": utcnow().isoformat(timespec="seconds"), "message": message[:200]}]

    def tool_call(self, name: str, args: dict, ok: bool, ms: int, error: str = "") -> None:
        with db_session() as db:
            t = db.get(AgentTask, self.id)
            safe_args = {k: (v if isinstance(v, (int, float, bool)) or v is None else str(v)[:120]) for k, v in args.items()}
            t.tool_calls = [*t.tool_calls, {"tool": name, "args": safe_args, "ok": ok, "ms": ms, "error": error[:200]}]

    def child(self, agent: str, summary: str) -> "Tracker":
        return Tracker(agent, summary, self.profile_id, parent_id=self.id)

    def finish(self, status: str = "completed", error: str = "", result_ref: dict | None = None) -> None:
        with db_session() as db:
            t = db.get(AgentTask, self.id)
            if t.status == "cancelled" and status == "completed":
                status = "cancelled"
            t.status = status
            t.error = error[:2000]
            t.finished_at = utcnow()
            t.duration_ms = int((time.perf_counter() - self._t0) * 1000)
            if result_ref:
                t.result_ref = result_ref

    def request_approval(self, action: str, detail: dict) -> None:
        with db_session() as db:
            t = db.get(AgentTask, self.id)
            t.status = "awaiting_approval"
            t.approval = {"action": action, "detail": detail, "requested_at": utcnow().isoformat()}
        raise ApprovalRequired(self.id, action, detail)


def register_running(task_id: int, task: asyncio.Task) -> None:
    _running[task_id] = task
    task.add_done_callback(lambda _: _running.pop(task_id, None))


def cancel(task_id: int) -> bool:
    with db_session() as db:
        t = db.get(AgentTask, task_id)
        if not t or t.status not in ("running", "queued", "awaiting_approval"):
            return False
        t.status = "cancelled"
        t.finished_at = utcnow()
        t.error = "Cancelled by user"
        # cascade to children
        for c in db.query(AgentTask).filter(AgentTask.parent_id == task_id, AgentTask.status.in_(["running", "queued"])):
            c.status, c.finished_at = "cancelled", utcnow()
    at = _running.get(task_id)
    if at and not at.done():
        at.cancel()  # closes the HTTP stream to Ollama → generation stops
    return True


# ------------------------------------------------------------------ tool registry
@dataclass
class Tool:
    name: str
    purpose: str
    input_model: type[BaseModel]
    handler: Callable[..., Awaitable[Any]]
    permission: str = "read"  # read | write | destructive
    timeout_s: float = 120.0
    agents: tuple[str, ...] = ()  # which agents may use it (empty = all)


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"duplicate tool {tool.name}")
        self._tools[tool.name] = tool

    def describe(self) -> list[dict]:
        return [{"name": t.name, "purpose": t.purpose, "permission": t.permission, "timeout_s": t.timeout_s,
                 "agents": list(t.agents) or ["all"], "input_schema": t.input_model.model_json_schema()} for t in self._tools.values()]

    async def call(self, caller: Tracker, name: str, args: dict, *, approved: bool = False, **ctx: Any) -> Any:
        tracker = caller
        ctx.setdefault("tracker", caller)
        tool = self._tools.get(name)
        if not tool:
            tracker.tool_call(name, args, False, 0, "unknown tool")
            raise PermissionError(f"Tool '{name}' is not registered")
        if tool.agents and tracker.agent not in tool.agents:
            tracker.tool_call(name, args, False, 0, "agent not permitted")
            raise PermissionError(f"Agent '{tracker.agent}' may not use tool '{name}'")
        try:
            parsed = tool.input_model.model_validate(args)
        except ValidationError as e:
            tracker.tool_call(name, args, False, 0, "invalid input")
            raise ValueError(f"Invalid input for tool {name}: {e.errors()[:3]}") from e
        if tool.permission == "destructive" and not approved:
            tracker.tool_call(name, args, False, 0, "approval required")
            tracker.request_approval(name, {"tool": name, "args": parsed.model_dump(mode="json"), "purpose": tool.purpose})
        t0 = time.perf_counter()
        try:
            result = await asyncio.wait_for(tool.handler(parsed, **ctx), timeout=tool.timeout_s)
        except asyncio.TimeoutError:
            tracker.tool_call(name, args, False, int((time.perf_counter() - t0) * 1000), "timeout")
            raise
        except Exception as e:
            tracker.tool_call(name, args, False, int((time.perf_counter() - t0) * 1000), str(e))
            raise
        tracker.tool_call(name, args, True, int((time.perf_counter() - t0) * 1000))
        return result


registry = ToolRegistry()
