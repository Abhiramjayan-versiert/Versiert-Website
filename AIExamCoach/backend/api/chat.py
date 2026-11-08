from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.agents import orchestrator
from backend.agents.runtime import register_running
from backend.api.deps import DB, USER
from backend.models.entities import ChatMessage, ChatThread, Document, ExamProfile, User, utcnow
from backend.security.auth import get_profile
from backend.security.ratelimit import limit_ai

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _thread(db: Session, user: User, thread_id: int) -> ChatThread:
    t = db.get(ChatThread, thread_id)
    if not t:
        raise HTTPException(404, "Conversation not found")
    if t.profile_id:
        get_profile(db, user, t.profile_id)
    return t


class ThreadIn(BaseModel):
    profile_id: int
    title: str = Field("New conversation", max_length=200)
    kind: str = Field("coach", pattern="^(coach|tutor)$")


@router.get("/threads")
def threads(profile_id: int, kind: str | None = None, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    rows = db.scalars(select(ChatThread).where(ChatThread.profile_id == profile_id).order_by(ChatThread.updated_at.desc()).limit(100)).all()
    out = [{"id": t.id, "title": t.title, "updated_at": t.updated_at.isoformat(), "kind": (t.context or {}).get("kind", "coach"),
            "lesson": (t.context or {}).get("lesson")} for t in rows]
    return [o for o in out if not kind or o["kind"] == kind]


@router.post("/threads")
def new_thread(body: ThreadIn, db: Session = DB, user: User = USER):
    get_profile(db, user, body.profile_id)
    t = ChatThread(profile_id=body.profile_id, title=body.title, context={"kind": body.kind})
    db.add(t)
    db.commit()
    return {"id": t.id, "title": t.title}


@router.delete("/threads/{thread_id}")
def delete_thread(thread_id: int, db: Session = DB, user: User = USER):
    t = _thread(db, user, thread_id)
    db.delete(t)
    db.commit()
    return {"ok": True}


@router.get("/threads/{thread_id}/messages")
def messages(thread_id: int, after_id: int = 0, db: Session = DB, user: User = USER):
    t = _thread(db, user, thread_id)
    rows = db.scalars(select(ChatMessage).where(ChatMessage.thread_id == t.id, ChatMessage.id > after_id).order_by(ChatMessage.id)).all()
    return {"thread": {"id": t.id, "title": t.title, "context": t.context},
            "messages": [{"id": m.id, "role": m.role, "content": m.content, "agent": m.agent, "citations": m.citations, "actions": m.actions,
                          "task_id": m.task_id, "created_at": m.created_at.isoformat()} for m in rows]}


class MessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=20000)
    subject_id: int | None = None
    document_id: int | None = None
    level: str | None = Field(None, pattern="^(beginner|intermediate|advanced|mba|ssc|short|long)$")


@router.post("/threads/{thread_id}/messages", dependencies=[Depends(limit_ai)])
async def send(thread_id: int, body: MessageIn, db: Session = DB, user: User = USER):
    t = _thread(db, user, thread_id)
    if body.document_id:
        d = db.get(Document, body.document_id)
        if not d or d.profile_id != t.profile_id:
            raise HTTPException(400, "Attached document is not in this exam profile")
    m = ChatMessage(thread_id=t.id, role="user", content=body.content)
    db.add(m)
    if t.title == "New conversation":
        t.title = body.content[:60] + ("…" if len(body.content) > 60 else "")
    t.updated_at = utcnow()
    db.commit()
    holder: dict = {}
    task = asyncio.create_task(orchestrator.handle_message(t.id, holder, body.content, t.profile_id, body.subject_id, body.document_id, body.level))
    for _ in range(100):  # wait until the root agent task row exists
        if "id" in holder or task.done():
            break
        await asyncio.sleep(0.01)
    if "id" in holder:
        register_running(holder["id"], task)
    m.task_id = holder.get("id")
    db.commit()
    return {"message_id": m.id, "task_id": holder.get("id")}
