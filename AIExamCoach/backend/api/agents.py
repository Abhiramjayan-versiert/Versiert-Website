from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from backend.agents import runtime
from backend.agents.runtime import AGENT_NAMES, Tracker, registry
from backend.api.deps import DB, USER, spawn
from backend.models.entities import AgentTask, ExamProfile, User, utcnow
from backend.security.auth import audit, client_ip

router = APIRouter(prefix="/api/agents", tags=["agents"])


def _owned_profiles(db: Session, user: User) -> list[int]:
    return list(db.scalars(select(ExamProfile.id).where(ExamProfile.user_id == user.id)))


def task_out(t: AgentTask) -> dict:
    return {"id": t.id, "parent_id": t.parent_id, "agent": t.agent, "agent_name": AGENT_NAMES.get(t.agent, t.agent), "summary": t.summary,
            "status": t.status, "model": t.model, "profile_id": t.profile_id,
            "started_at": t.started_at.isoformat() + "Z" if t.started_at else None,
            "finished_at": t.finished_at.isoformat() + "Z" if t.finished_at else None, "duration_ms": t.duration_ms,
            "tool_calls": t.tool_calls, "steps": t.steps, "error": t.error, "approval": t.approval, "result_ref": t.result_ref}


def _task(db: Session, user: User, task_id: int) -> AgentTask:
    t = db.get(AgentTask, task_id)
    if not t or (t.profile_id is None and not user.is_admin) or (t.profile_id is not None and t.profile_id not in _owned_profiles(db, user)):
        raise HTTPException(404, "Task not found")
    return t


@router.get("/tasks")
def tasks(status: str | None = None, limit: int = 100, db: Session = DB, user: User = USER):
    owned = AgentTask.profile_id.in_(_owned_profiles(db, user))
    q = select(AgentTask).where(or_(owned, AgentTask.profile_id.is_(None)) if user.is_admin else owned)
    if status:
        q = q.where(AgentTask.status == status)
    return [task_out(t) for t in db.scalars(q.order_by(AgentTask.id.desc()).limit(min(limit, 500)))]


@router.get("/tasks/{task_id}")
def task(task_id: int, db: Session = DB, user: User = USER):
    t = _task(db, user, task_id)
    children = db.scalars(select(AgentTask).where(AgentTask.parent_id == t.id).order_by(AgentTask.id)).all()
    return {**task_out(t), "children": [task_out(c) for c in children]}


@router.post("/tasks/{task_id}/cancel")
def cancel(task_id: int, db: Session = DB, user: User = USER):
    _task(db, user, task_id)
    return {"cancelled": runtime.cancel(task_id)}


@router.post("/tasks/{task_id}/approve")
async def approve(task_id: int, request: Request, db: Session = DB, user: User = USER):
    t = _task(db, user, task_id)
    if t.status != "awaiting_approval" or not t.approval.get("tool"):
        raise HTTPException(409, "Nothing awaiting approval")
    tool, args, agent = t.approval["tool"], t.approval["detail"]["args"], t.agent
    t.status = "running"
    t.approval = {**t.approval, "approved_at": utcnow().isoformat(), "approved_by": user.username}
    db.commit()
    audit(db, "agent_action_approved", user_id=user.id, detail=f"{task_id}:{tool}", ip=client_ip(request))
    tr = Tracker(agent, f"Approved action: {tool}", t.profile_id, parent_id=t.id)

    async def work():
        return await registry.call(tr, tool, args, approved=True, tracker=tr)

    spawn(tr, work)
    t.status, t.finished_at = "completed", utcnow()
    db.commit()
    return {"ok": True, "task_id": tr.id}


@router.post("/tasks/{task_id}/reject")
def reject(task_id: int, request: Request, db: Session = DB, user: User = USER):
    t = _task(db, user, task_id)
    if t.status != "awaiting_approval":
        raise HTTPException(409, "Nothing awaiting approval")
    t.status, t.finished_at = "rejected", utcnow()
    db.commit()
    audit(db, "agent_action_rejected", user_id=user.id, detail=str(task_id), ip=client_ip(request))
    return {"ok": True}


@router.get("/tools")
def tools(user: User = USER):
    return registry.describe()


@router.get("/catalogue")
def catalogue(user: User = USER):
    return [{"id": k, "name": v} for k, v in AGENT_NAMES.items()]
