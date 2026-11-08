from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.agents import syllabus as analyst
from backend.agents.runtime import Tracker
from backend.api.deps import DB, USER, spawn
from backend.database.session import SessionLocal
from backend.models.entities import Document, Subject, SyllabusDraft, Topic, User, utcnow
from backend.security.auth import get_profile

router = APIRouter(prefix="/api/profiles/{profile_id}/syllabus", tags=["syllabus"])


class SubjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    total_marks: float | None = Field(None, ge=0, le=10000)
    exam_date: date | None = None


class TopicIn(BaseModel):
    subject_id: int
    name: str = Field(min_length=1, max_length=300)
    parent_id: int | None = None
    kind: str = Field("topic", pattern="^(unit|topic|subtopic)$")
    marks_weight: float | None = Field(None, ge=0, le=1000)
    difficulty: int = Field(3, ge=1, le=5)
    importance: str = Field("normal", pattern="^(high|normal|low)$")
    prerequisites: str = Field("", max_length=2000)
    key_concepts: str = Field("", max_length=4000)
    est_hours: float = Field(2.0, ge=0.25, le=100)


class TopicPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=300)
    marks_weight: float | None = Field(None, ge=0, le=1000)
    difficulty: int | None = Field(None, ge=1, le=5)
    importance: str | None = Field(None, pattern="^(high|normal|low)$")
    prerequisites: str | None = Field(None, max_length=2000)
    key_concepts: str | None = Field(None, max_length=4000)
    est_hours: float | None = Field(None, ge=0.25, le=100)
    status: str | None = Field(None, pattern="^(pending|in_progress|completed)$")
    parent_id: int | None = None


def topic_out(t: Topic) -> dict:
    return {"id": t.id, "subject_id": t.subject_id, "parent_id": t.parent_id, "name": t.name, "kind": t.kind, "marks_weight": t.marks_weight,
            "difficulty": t.difficulty, "importance": t.importance, "prerequisites": t.prerequisites, "key_concepts": t.key_concepts,
            "est_hours": t.est_hours, "status": t.status, "order": t.order}


@router.get("")
def tree(profile_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    subs = db.scalars(select(Subject).where(Subject.profile_id == profile_id).order_by(Subject.order, Subject.id)).all()
    topics = db.scalars(select(Topic).where(Topic.profile_id == profile_id).order_by(Topic.order, Topic.id)).all()
    return [{"id": s.id, "name": s.name, "total_marks": s.total_marks, "exam_date": s.exam_date.isoformat() if s.exam_date else None,
             "topics": [topic_out(t) for t in topics if t.subject_id == s.id]} for s in subs]


@router.post("/subjects")
def add_subject(profile_id: int, body: SubjectIn, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    s = Subject(profile_id=profile_id, **body.model_dump())
    db.add(s)
    db.commit()
    return {"id": s.id}


@router.patch("/subjects/{subject_id}")
def edit_subject(profile_id: int, subject_id: int, body: SubjectIn, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    s = db.get(Subject, subject_id)
    if not s or s.profile_id != profile_id:
        raise HTTPException(404, "Subject not found")
    for k, v in body.model_dump().items():
        setattr(s, k, v)
    db.commit()
    return {"ok": True}


@router.delete("/subjects/{subject_id}")
def del_subject(profile_id: int, subject_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    s = db.get(Subject, subject_id)
    if not s or s.profile_id != profile_id:
        raise HTTPException(404, "Subject not found")
    db.delete(s)
    db.commit()
    return {"ok": True}


@router.post("/topics")
def add_topic(profile_id: int, body: TopicIn, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    s = db.get(Subject, body.subject_id)
    if not s or s.profile_id != profile_id:
        raise HTTPException(404, "Subject not found")
    t = Topic(profile_id=profile_id, **body.model_dump())
    db.add(t)
    db.commit()
    return topic_out(t)


@router.patch("/topics/{topic_id}")
def edit_topic(profile_id: int, topic_id: int, body: TopicPatch, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    t = db.get(Topic, topic_id)
    if not t or t.profile_id != profile_id:
        raise HTTPException(404, "Topic not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(t, k, v)
    if body.status == "completed":
        t.completed_at = utcnow()
    db.commit()
    return topic_out(t)


@router.delete("/topics/{topic_id}")
def del_topic(profile_id: int, topic_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    t = db.get(Topic, topic_id)
    if not t or t.profile_id != profile_id:
        raise HTTPException(404, "Topic not found")
    db.delete(t)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- drafts
@router.post("/analyze/{document_id}")
async def analyze(profile_id: int, document_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    d = db.get(Document, document_id)
    if not d or d.profile_id != profile_id:
        raise HTTPException(404, "Document not found")
    if d.status in ("queued", "processing"):
        raise HTTPException(409, "Document is still being processed")
    tr = Tracker("syllabus", f"Analysing uploaded syllabus '{d.display_name}'", profile_id)

    async def work():
        with SessionLocal() as s:
            return await analyst.analyze_document(s, profile_id, document_id, tr)

    return {"task_id": spawn(tr, work, lambda dr: {"draft_id": dr.id})}


@router.get("/drafts")
def drafts(profile_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    return [{"id": d.id, "document_id": d.document_id, "status": d.status, "created_at": d.created_at.isoformat(), "warnings": d.warnings,
             "data": d.data} for d in db.scalars(select(SyllabusDraft).where(SyllabusDraft.profile_id == profile_id).order_by(SyllabusDraft.id.desc()).limit(20))]


class ApplyIn(BaseModel):
    data: dict | None = None
    set_exam_date: str | None = None


@router.post("/drafts/{draft_id}/apply")
def apply(profile_id: int, draft_id: int, body: ApplyIn, db: Session = DB, user: User = USER):
    p = get_profile(db, user, profile_id)
    d = db.get(SyllabusDraft, draft_id)
    if not d or d.profile_id != profile_id:
        raise HTTPException(404, "Draft not found")
    if d.status == "applied":
        raise HTTPException(409, "Draft already applied")
    created = analyst.apply_draft(db, d, body.data)
    if body.set_exam_date:
        dt = analyst.parse_date(body.set_exam_date)
        if not dt:
            raise HTTPException(400, "Could not read that date")
        p.exam_date = dt
        db.commit()
    return created


@router.post("/drafts/{draft_id}/discard")
def discard(profile_id: int, draft_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    d = db.get(SyllabusDraft, draft_id)
    if not d or d.profile_id != profile_id:
        raise HTTPException(404, "Draft not found")
    d.status = "discarded"
    db.commit()
    return {"ok": True}
