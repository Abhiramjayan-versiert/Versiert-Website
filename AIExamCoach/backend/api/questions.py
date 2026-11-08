from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.agents import questions as qgen
from backend.agents.runtime import Tracker
from backend.api.deps import DB, USER, spawn
from backend.database.session import SessionLocal
from backend.models.entities import Question, Subject, Topic, User
from backend.security.auth import get_profile
from backend.security.ratelimit import limit_ai

router = APIRouter(prefix="/api/profiles/{profile_id}/questions", tags=["questions"])


def q_out(q: Question, reveal: bool = True) -> dict:
    d = {"id": q.id, "qtype": q.qtype, "text": q.text, "options": q.options, "marks": q.marks, "difficulty": q.difficulty, "subject_id": q.subject_id,
         "topic_id": q.topic_id, "source": q.source, "created_at": q.created_at.isoformat(), "negative_marks": q.negative_marks}
    if reveal:
        d.update(answer=q.answer, explanation=q.explanation, rubric=q.rubric, keywords=q.keywords, citations=q.citations)
    return d


@router.get("")
def list_q(profile_id: int, qtype: str | None = None, subject_id: int | None = None, topic_id: int | None = None, limit: int = 200,
           db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    q = select(Question).where(Question.profile_id == profile_id)
    if qtype:
        q = q.where(Question.qtype == qtype)
    if subject_id:
        q = q.where(Question.subject_id == subject_id)
    if topic_id:
        q = q.where(Question.topic_id == topic_id)
    return [q_out(x) for x in db.scalars(q.order_by(Question.id.desc()).limit(min(limit, 500)))]


class GenIn(BaseModel):
    qtype: str
    count: int = Field(5, ge=1, le=30)
    subject_id: int | None = None
    topic_ids: list[int] | None = None
    difficulty: str = Field("medium", pattern="^(easy|medium|hard)$")
    marks: float | None = Field(None, ge=0.5, le=100)


@router.post("/generate", dependencies=[Depends(limit_ai)])
async def generate(profile_id: int, body: GenIn, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    if body.qtype not in qgen.QTYPES:
        raise HTTPException(400, f"qtype must be one of {qgen.QTYPES}")
    tr = Tracker("questions", f"Generating {body.count} {body.qtype.replace('_', ' ')} question(s)", profile_id)

    async def work():
        with SessionLocal() as s:
            prof = get_profile(s, user, profile_id)
            return await qgen.generate(s, prof, tr, qtype=body.qtype, count=body.count, subject_id=body.subject_id, topic_ids=body.topic_ids,
                                       difficulty=body.difficulty, marks=body.marks)

    return {"task_id": spawn(tr, work, lambda qs: {"question_ids": [q.id for q in qs]})}


class QIn(BaseModel):
    qtype: str
    text: str = Field(min_length=5, max_length=10000)
    options: list[str] = Field(default_factory=list)
    answer: dict = Field(default_factory=dict)
    marks: float = Field(1, ge=0.5, le=100)
    negative_marks: float = Field(0, ge=0, le=10)
    difficulty: str = Field("medium", pattern="^(easy|medium|hard)$")
    explanation: str = Field("", max_length=5000)
    rubric: list[dict] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    subject_id: int | None = None
    topic_id: int | None = None


def _check_refs(db: Session, profile_id: int, body: QIn) -> None:
    if body.qtype not in qgen.QTYPES:
        raise HTTPException(400, "Unknown question type")
    if body.subject_id and (not (s := db.get(Subject, body.subject_id)) or s.profile_id != profile_id):
        raise HTTPException(400, "Unknown subject")
    if body.topic_id and (not (t := db.get(Topic, body.topic_id)) or t.profile_id != profile_id):
        raise HTTPException(400, "Unknown topic")
    if body.qtype in ("mcq", "msq", "assertion_reason") and not body.answer.get("correct"):
        raise HTTPException(400, "Specify answer.correct (option indices)")
    if body.qtype == "numerical" and body.answer.get("value") is None and not body.answer.get("expression"):
        raise HTTPException(400, "Specify answer.value or answer.expression")


@router.post("")
def create(profile_id: int, body: QIn, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    _check_refs(db, profile_id, body)
    data = body.model_dump()
    if body.qtype == "numerical" and body.answer.get("expression") and body.answer.get("value") is None:
        from backend.evaluation.numeric import safe_eval

        data["answer"]["value"] = safe_eval(body.answer["expression"])
    q = Question(profile_id=profile_id, source="manual", **data)
    db.add(q)
    db.commit()
    return q_out(q)


@router.put("/{qid}")
def edit(profile_id: int, qid: int, body: QIn, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    q = db.get(Question, qid)
    if not q or q.profile_id != profile_id:
        raise HTTPException(404, "Question not found")
    _check_refs(db, profile_id, body)
    for k, v in body.model_dump().items():
        setattr(q, k, v)
    db.commit()
    return q_out(q)


@router.delete("/{qid}")
def delete(profile_id: int, qid: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    q = db.get(Question, qid)
    if not q or q.profile_id != profile_id:
        raise HTTPException(404, "Question not found")
    from backend.models.entities import MockExamItem

    if db.scalar(select(MockExamItem.id).where(MockExamItem.question_id == qid).limit(1)):
        raise HTTPException(409, "This question is part of a mock exam result and cannot be deleted.")
    db.delete(q)
    db.commit()
    return {"ok": True}
