from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.agents import planner
from backend.api.deps import DB, USER
from backend.models.entities import StudyPlan, StudySession, Subject, Topic, User
from backend.security.auth import get_profile

router = APIRouter(prefix="/api/profiles/{profile_id}/plans", tags=["planner"])


class PlanIn(BaseModel):
    start_date: date | None = None
    end_date: date | None = None
    days: int | None = Field(None, ge=1, le=365)
    daily_hours: float | None = Field(None, ge=0.5, le=16)
    weekdays: list[int] | None = None
    subject_ids: list[int] | None = None
    include_revision: bool = True
    title: str | None = Field(None, max_length=200)


def sess_out(s: StudySession, topics: dict, subjects: dict) -> dict:
    return {"id": s.id, "day": s.day.isoformat(), "slot": s.slot, "title": s.title, "kind": s.kind, "minutes": s.minutes, "status": s.status,
            "topic_id": s.topic_id, "topic": topics.get(s.topic_id), "subject_id": s.subject_id, "subject": subjects.get(s.subject_id),
            "actual_minutes": s.actual_minutes}


def plan_out(db: Session, p: StudyPlan, with_sessions: bool = True) -> dict:
    d = {"id": p.id, "title": p.title, "start_date": p.start_date.isoformat(), "end_date": p.end_date.isoformat(), "summary": p.summary,
         "warnings": p.warnings, "active": p.active, "params": p.params, "created_at": p.created_at.isoformat()}
    if with_sessions:
        sessions = db.scalars(select(StudySession).where(StudySession.plan_id == p.id).order_by(StudySession.day, StudySession.slot)).all()
        topics = {t.id: t.name for t in db.scalars(select(Topic).where(Topic.profile_id == p.profile_id))}
        subjects = {s.id: s.name for s in db.scalars(select(Subject).where(Subject.profile_id == p.profile_id))}
        d["sessions"] = [sess_out(s, topics, subjects) for s in sessions]
        done = sum(1 for s in sessions if s.status == "done")
        d["progress"] = {"total": len(sessions), "done": done, "missed": sum(1 for s in sessions if s.status == "missed"),
                         "pct": round(100 * done / len(sessions), 1) if sessions else 0}
    return d


@router.get("")
def list_plans(profile_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    return [plan_out(db, p, False) for p in db.scalars(select(StudyPlan).where(StudyPlan.profile_id == profile_id).order_by(StudyPlan.id.desc()))]


@router.get("/active")
def active(profile_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    p = db.scalar(select(StudyPlan).where(StudyPlan.profile_id == profile_id, StudyPlan.active))
    if not p:
        return None
    planner.mark_missed(db, profile_id)
    return plan_out(db, p)


@router.post("")
def create(profile_id: int, body: PlanIn, db: Session = DB, user: User = USER):
    prof = get_profile(db, user, profile_id)
    start = body.start_date or date.today()
    end = body.end_date or (start + timedelta(days=body.days - 1) if body.days else None)
    if end and prof.exam_date and end >= prof.exam_date:
        end = prof.exam_date - timedelta(days=1)
    if body.subject_ids:
        valid = {s.id for s in db.scalars(select(Subject).where(Subject.profile_id == profile_id))}
        if not set(body.subject_ids) <= valid:
            raise HTTPException(400, "Unknown subject")
    try:
        p = planner.build_plan(db, prof, start=start, end=end, daily_hours=body.daily_hours, weekdays=body.weekdays,
                               subject_ids=body.subject_ids, include_revision=body.include_revision, title=body.title)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return plan_out(db, p)


@router.post("/reschedule")
def reschedule(profile_id: int, db: Session = DB, user: User = USER):
    prof = get_profile(db, user, profile_id)
    try:
        return plan_out(db, planner.reschedule(db, prof))
    except ValueError as e:
        raise HTTPException(400, str(e))


class SessionPatch(BaseModel):
    status: str = Field(pattern="^(done|missed|pending)$")
    actual_minutes: int | None = Field(None, ge=1, le=600)
    topic_completed: bool = False


@router.patch("/sessions/{session_id}")
def update_session(profile_id: int, session_id: int, body: SessionPatch, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    s = db.get(StudySession, session_id)
    if not s or s.profile_id != profile_id:
        raise HTTPException(404, "Session not found")
    if body.status == "pending":
        s.status, s.completed_at, s.actual_minutes = "pending", None, None
        db.commit()
    else:
        planner.complete_session(db, s, body.status == "done", body.actual_minutes, body.topic_completed)
    return {"ok": True, "status": s.status}


@router.delete("/{plan_id}")
def delete_plan(profile_id: int, plan_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    p = db.get(StudyPlan, plan_id)
    if not p or p.profile_id != profile_id:
        raise HTTPException(404, "Plan not found")
    db.delete(p)
    db.commit()
    return {"ok": True}
