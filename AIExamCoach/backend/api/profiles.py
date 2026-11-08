from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.api.deps import DB, USER
from backend.models.entities import Document, ExamProfile, MockExam, Subject, Topic, User
from backend.rag import ingest, store
from backend.rag.retrieve import clear_cache
from backend.security.auth import audit, client_ip, get_profile

router = APIRouter(prefix="/api/profiles", tags=["profiles"])


class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    exam_type: str = Field("other", pattern="^(mba|ssc|other)$")
    exam_date: date | None = None
    target_pct: float = Field(75.0, ge=1, le=100)
    daily_hours: float = Field(3.0, ge=0.5, le=16)
    study_days: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4, 5])
    notes: str = Field("", max_length=10000)


class ProfilePatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=128)
    exam_type: str | None = Field(None, pattern="^(mba|ssc|other)$")
    exam_date: date | None = None
    clear_exam_date: bool = False
    target_pct: float | None = Field(None, ge=1, le=100)
    daily_hours: float | None = Field(None, ge=0.5, le=16)
    study_days: list[int] | None = None
    notes: str | None = Field(None, max_length=10000)
    archived: bool | None = None


def out(db: Session, p: ExamProfile) -> dict:
    n_topics = db.scalar(select(func.count(Topic.id)).where(Topic.profile_id == p.id, Topic.kind != "unit")) or 0
    done = db.scalar(select(func.count(Topic.id)).where(Topic.profile_id == p.id, Topic.kind != "unit", Topic.status == "completed")) or 0
    return {"id": p.id, "name": p.name, "exam_type": p.exam_type, "exam_date": p.exam_date.isoformat() if p.exam_date else None,
            "days_left": (p.exam_date - date.today()).days if p.exam_date else None, "target_pct": p.target_pct, "daily_hours": p.daily_hours,
            "study_days": p.study_days, "notes": p.notes, "archived": p.archived, "created_at": p.created_at.isoformat(),
            "subjects": db.scalar(select(func.count(Subject.id)).where(Subject.profile_id == p.id)) or 0,
            "topics": n_topics, "topics_completed": done,
            "documents": db.scalar(select(func.count(Document.id)).where(Document.profile_id == p.id)) or 0,
            "mocks": db.scalar(select(func.count(MockExam.id)).where(MockExam.profile_id == p.id)) or 0}


def _days(v: list[int]) -> list[int]:
    v = sorted({int(d) for d in v if 0 <= int(d) <= 6})
    if not v:
        raise HTTPException(400, "Choose at least one study day")
    return v


@router.get("")
def list_profiles(include_archived: bool = False, db: Session = DB, user: User = USER):
    q = select(ExamProfile).where(ExamProfile.user_id == user.id)
    if not include_archived:
        q = q.where(ExamProfile.archived.is_(False))
    return [out(db, p) for p in db.scalars(q.order_by(ExamProfile.archived, ExamProfile.exam_date.is_(None), ExamProfile.exam_date, ExamProfile.id))]


@router.post("")
def create(body: ProfileIn, db: Session = DB, user: User = USER):
    p = ExamProfile(user_id=user.id, **{**body.model_dump(), "study_days": _days(body.study_days)})
    db.add(p)
    db.commit()
    if not user.active_profile_id:
        user.active_profile_id = p.id
        db.commit()
    return out(db, p)


@router.get("/{profile_id}")
def get(profile_id: int, db: Session = DB, user: User = USER):
    return out(db, get_profile(db, user, profile_id))


@router.patch("/{profile_id}")
def update(profile_id: int, body: ProfilePatch, db: Session = DB, user: User = USER):
    p = get_profile(db, user, profile_id)
    data = body.model_dump(exclude_unset=True)
    if data.pop("clear_exam_date", False):
        p.exam_date = None
    for k, v in data.items():
        if v is None and k != "exam_date":
            continue
        if k == "study_days":
            v = _days(v)
        setattr(p, k, v)
    db.commit()
    return out(db, p)


@router.delete("/{profile_id}")
def delete(profile_id: int, request: Request, confirm: str = "", db: Session = DB, user: User = USER):
    p = get_profile(db, user, profile_id)
    if confirm != p.name:
        raise HTTPException(400, "To delete, pass confirm=<exact profile name>. This permanently deletes all data in this profile.")
    for d in db.scalars(select(Document).where(Document.profile_id == p.id)):
        ingest.doc_path(d).unlink(missing_ok=True)
    store.delete_profile(p.id)
    clear_cache(p.id)
    db.delete(p)
    if user.active_profile_id == profile_id:
        user.active_profile_id = db.scalar(select(ExamProfile.id).where(ExamProfile.user_id == user.id, ExamProfile.id != profile_id))
    db.commit()
    audit(db, "profile_deleted", user_id=user.id, detail=p.name, ip=client_ip(request))
    return {"deleted": profile_id}
