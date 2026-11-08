from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.agents import revision as coach
from backend.agents.runtime import Tracker
from backend.api.deps import DB, USER, spawn
from backend.database.session import SessionLocal
from backend.evaluation.objective import mark_objective
from backend.models.entities import Question, QuestionAttempt, RevisionItem, Topic, User
from backend.security.auth import get_profile
from backend.security.ratelimit import limit_ai
from backend.services.mocks import public_question

router = APIRouter(prefix="/api/profiles/{profile_id}/revision", tags=["revision"])


def item_out(i: RevisionItem, topics: dict) -> dict:
    return {"id": i.id, "kind": i.kind, "front": i.front, "back": i.back, "topic_id": i.topic_id, "topic": topics.get(i.topic_id),
            "due_date": i.due_date.isoformat(), "interval_days": i.interval_days, "repetitions": i.repetitions, "lapses": i.lapses,
            "ease": round(i.ease, 2), "question_id": i.question_id}


def _topics(db: Session, profile_id: int) -> dict:
    return {t.id: t.name for t in db.scalars(select(Topic).where(Topic.profile_id == profile_id))}


@router.get("/due")
def due(profile_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    t = _topics(db, profile_id)
    items = coach.daily_list(db, profile_id, limit=100)
    upcoming = db.scalar(select(func.count(RevisionItem.id)).where(RevisionItem.profile_id == profile_id, RevisionItem.due_date > date.today())) or 0
    return {"items": [item_out(i, t) for i in items], "upcoming": upcoming, "stats": coach.retention_stats(db, profile_id)}


@router.get("/items")
def all_items(profile_id: int, kind: str | None = None, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    q = select(RevisionItem).where(RevisionItem.profile_id == profile_id)
    if kind:
        q = q.where(RevisionItem.kind == kind)
    t = _topics(db, profile_id)
    return [item_out(i, t) for i in db.scalars(q.order_by(RevisionItem.due_date).limit(500))]


class GradeIn(BaseModel):
    grade: int = Field(ge=0, le=5)


@router.post("/items/{item_id}/review")
def review(profile_id: int, item_id: int, body: GradeIn, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    i = db.get(RevisionItem, item_id)
    if not i or i.profile_id != profile_id:
        raise HTTPException(404, "Item not found")
    coach.review(db, i, body.grade)
    return item_out(i, _topics(db, profile_id))


class CardIn(BaseModel):
    front: str = Field(min_length=2, max_length=4000)
    back: str = Field(min_length=1, max_length=8000)
    kind: str = Field("flashcard", pattern="^(flashcard|definition|formula|concept|topic)$")
    topic_id: int | None = None


@router.post("/items")
def add(profile_id: int, body: CardIn, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    if body.topic_id and (not (t := db.get(Topic, body.topic_id)) or t.profile_id != profile_id):
        raise HTTPException(400, "Unknown topic")
    i = RevisionItem(profile_id=profile_id, due_date=date.today(), **body.model_dump())
    db.add(i)
    db.commit()
    return item_out(i, _topics(db, profile_id))


@router.delete("/items/{item_id}")
def delete(profile_id: int, item_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    i = db.get(RevisionItem, item_id)
    if not i or i.profile_id != profile_id:
        raise HTTPException(404, "Item not found")
    db.delete(i)
    db.commit()
    return {"ok": True}


class GenCardsIn(BaseModel):
    topic_id: int
    count: int = Field(8, ge=1, le=20)


@router.post("/generate", dependencies=[Depends(limit_ai)])
async def generate(profile_id: int, body: GenCardsIn, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    t = db.get(Topic, body.topic_id)
    if not t or t.profile_id != profile_id:
        raise HTTPException(404, "Topic not found")
    tr = Tracker("revision", f"Creating flashcards for '{t.name}'", profile_id)

    async def work():
        with SessionLocal() as s:
            return await coach.generate_cards(s, get_profile(s, user, profile_id), tr, s.get(Topic, body.topic_id), body.count)

    return {"task_id": spawn(tr, work, lambda items: {"items": len(items)})}


@router.get("/quiz")
def quiz(profile_id: int, n: int = 10, only_incorrect: bool = False, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    return [public_question(q, reveal=False) for q in coach.quick_quiz(db, profile_id, min(max(n, 1), 30), only_incorrect)]


class QuizAnswer(BaseModel):
    question_id: int
    response: Any = None
    time_spent_sec: int = Field(0, ge=0, le=36000)


class QuizIn(BaseModel):
    answers: list[QuizAnswer] = Field(min_length=1, max_length=50)


@router.post("/quiz")
def grade_quiz(profile_id: int, body: QuizIn, db: Session = DB, user: User = USER):
    """Objective quick-quiz marking (deterministic). Wrong answers become mistake cards."""
    get_profile(db, user, profile_id)
    results, got, tot = [], 0.0, 0.0
    for a in body.answers:
        q = db.get(Question, a.question_id)
        if not q or q.profile_id != profile_id:
            raise HTTPException(404, "Question not found")
        r = mark_objective(q.qtype, q.answer, a.response, q.marks)
        got += max(0, r["marks"])
        tot += q.marks
        db.add(QuestionAttempt(profile_id=profile_id, question_id=q.id, topic_id=q.topic_id, subject_id=q.subject_id, context="quiz",
                               marks_awarded=r["marks"], max_marks=q.marks, correct=r["correct"], time_spent_sec=a.time_spent_sec))
        if not r["correct"]:
            coach.add_mistake_card(db, q)
        results.append({"question": public_question(q, True), "response": a.response, **r})
    db.commit()
    return {"score": got, "total": tot, "pct": round(100 * got / tot, 1) if tot else 0, "results": results}
