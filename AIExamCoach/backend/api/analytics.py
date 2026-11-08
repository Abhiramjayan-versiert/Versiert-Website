from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.agents import analyst, revision
from backend.api.deps import DB, USER
from backend.models.entities import ExamProfile, MockExam, StudyPlan, StudySession, Topic, User
from backend.security.auth import get_profile

router = APIRouter(prefix="/api", tags=["analytics"])


@router.get("/profiles/{profile_id}/readiness")
def readiness(profile_id: int, db: Session = DB, user: User = USER):
    return analyst.readiness(db, get_profile(db, user, profile_id))


@router.get("/profiles/{profile_id}/analytics")
def analytics(profile_id: int, db: Session = DB, user: User = USER):
    return analyst.overview(db, get_profile(db, user, profile_id))


@router.get("/dashboard")
def dashboard(db: Session = DB, user: User = USER):
    profiles = db.scalars(select(ExamProfile).where(ExamProfile.user_id == user.id, ExamProfile.archived.is_(False))).all()
    pid = user.active_profile_id if any(p.id == user.active_profile_id for p in profiles) else (profiles[0].id if profiles else None)
    active = next((p for p in profiles if p.id == pid), None)
    out: dict = {"user": user.display_name or user.username, "active_profile_id": pid, "profiles": [], "today": [], "upcoming_exams": []}
    for p in profiles:
        r = analyst.readiness(db, p)
        out["profiles"].append({"id": p.id, "name": p.name, "exam_type": p.exam_type, "exam_date": p.exam_date.isoformat() if p.exam_date else None,
                                "days_left": (p.exam_date - date.today()).days if p.exam_date else None, "target_pct": p.target_pct,
                                "estimate_pct": r["estimate_pct"], "confidence": r["confidence"],
                                "syllabus_pct": r["indicators"]["syllabus_completion"]["value"]})
        if p.exam_date and p.exam_date >= date.today():
            out["upcoming_exams"].append({"profile_id": p.id, "name": p.name, "date": p.exam_date.isoformat(), "days_left": (p.exam_date - date.today()).days})
    out["upcoming_exams"].sort(key=lambda x: x["date"])
    out["streak_days"] = analyst.streak(db, user_profile_ids=[p.id for p in profiles])
    if active:
        plan = db.scalar(select(StudyPlan).where(StudyPlan.profile_id == active.id, StudyPlan.active))
        if plan:
            sess = db.scalars(select(StudySession).where(StudySession.plan_id == plan.id, StudySession.day == date.today()).order_by(StudySession.slot)).all()
            out["today"] = [{"id": s.id, "title": s.title, "kind": s.kind, "minutes": s.minutes, "status": s.status} for s in sess]
            backlog = db.scalars(select(StudySession).where(StudySession.plan_id == plan.id, StudySession.status == "missed")).all()
            out["backlog"] = len(backlog)
        r = analyst.readiness(db, active)
        out["readiness"] = r
        due = revision.daily_list(db, active.id, limit=200)
        out["pending_revisions"] = len(due)
        out["revision_preview"] = [i.front[:100] for i in due[:5]]
        out["weak_topics"] = [t for t in r["topics_losing_marks"] if t["accuracy"] < active.target_pct][:6]
        mocks = db.scalars(select(MockExam).where(MockExam.profile_id == active.id, MockExam.status == "evaluated").order_by(MockExam.submitted_at.desc()).limit(5)).all()
        out["recent_mocks"] = [{"id": m.id, "title": m.title, "percentage": m.percentage, "date": m.submitted_at.date().isoformat() if m.submitted_at else None,
                                "mode": m.mode} for m in mocks]
        out["overall_progress"] = r["indicators"]["syllabus_completion"]["value"]
    return out
