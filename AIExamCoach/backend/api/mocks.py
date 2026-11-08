from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.agents import questions as qgen
from backend.agents.evaluator import evaluate_question
from backend.agents.runtime import Tracker
from backend.api.deps import DB, USER, spawn
from backend.database.session import SessionLocal
from backend.models.entities import MockExam, MockExamItem, Question, User
from backend.security.auth import get_profile
from backend.security.ratelimit import limit_ai
from backend.services import mocks as svc

router = APIRouter(prefix="/api/profiles/{profile_id}/mocks", tags=["mocks"])


def _exam(db: Session, profile_id: int, exam_id: int) -> MockExam:
    e = db.get(MockExam, exam_id)
    if not e or e.profile_id != profile_id:
        raise HTTPException(404, "Mock exam not found")
    return e


@router.get("")
def list_mocks(profile_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    return [{"id": m.id, "title": m.title, "mode": m.mode, "status": m.status, "duration_min": m.duration_min, "total_marks": m.total_marks,
             "marks_awarded": m.marks_awarded, "percentage": m.percentage, "created_at": m.created_at.isoformat(),
             "submitted_at": m.submitted_at.isoformat() if m.submitted_at else None, "questions": len(m.items)}
            for m in db.scalars(select(MockExam).where(MockExam.profile_id == profile_id).order_by(MockExam.id.desc()))]


class BuildIn(BaseModel):
    title: str | None = Field(None, max_length=200)
    total_marks: float = Field(50, ge=5, le=300)
    duration_min: int = Field(90, ge=5, le=360)
    pattern: str = Field("mixed", pattern="^(objective|mixed|descriptive|mba|ssc|numerical)$")
    subject_id: int | None = None
    topic_ids: list[int] | None = None
    difficulty: str = Field("medium", pattern="^(easy|medium|hard)$")
    mode: str = Field("exam", pattern="^(exam|practice)$")
    reuse_bank: bool = True


@router.post("/build", dependencies=[Depends(limit_ai)])
async def build(profile_id: int, body: BuildIn, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    tr = Tracker("questions", f"Building a {body.total_marks:g}-mark mock paper ({body.duration_min} min)", profile_id)

    async def work():
        with SessionLocal() as s:
            prof = get_profile(s, user, profile_id)
            return await qgen.build_paper(s, prof, tr, total_marks=body.total_marks, duration_min=body.duration_min, pattern=body.pattern,
                                          subject_id=body.subject_id, topic_ids=body.topic_ids, difficulty=body.difficulty, mode=body.mode,
                                          reuse_bank=body.reuse_bank, title=body.title)

    return {"task_id": spawn(tr, work, lambda e: {"mock_id": e.id})}


class FromBankIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    question_ids: list[int] = Field(min_length=1, max_length=200)
    duration_min: int = Field(60, ge=5, le=360)
    mode: str = Field("exam", pattern="^(exam|practice)$")


@router.post("/from-bank")
def from_bank(profile_id: int, body: FromBankIn, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    qs = db.scalars(select(Question).where(Question.id.in_(body.question_ids), Question.profile_id == profile_id)).all()
    if len(qs) != len(set(body.question_ids)):
        raise HTTPException(400, "Some questions are not in this profile")
    order = {qid: i for i, qid in enumerate(body.question_ids)}
    e = MockExam(profile_id=profile_id, title=body.title, mode=body.mode, duration_min=body.duration_min, total_marks=sum(q.marks for q in qs))
    db.add(e)
    db.flush()
    for q in sorted(qs, key=lambda q: order[q.id]):
        db.add(MockExamItem(exam_id=e.id, question_id=q.id, order=order[q.id]))
    db.commit()
    return {"id": e.id}


@router.get("/{exam_id}")
def view(profile_id: int, exam_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    e = _exam(db, profile_id, exam_id)
    if e.status == "in_progress" and svc.expired(e):
        svc.submit(db, e)
    return svc.exam_view(e)


@router.post("/{exam_id}/start")
def start(profile_id: int, exam_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    return svc.exam_view(svc.start(db, _exam(db, profile_id, exam_id)))


class AnswerIn(BaseModel):
    response: Any = None
    marked_review: bool | None = None
    time_spent_sec: int | None = Field(None, ge=0)


@router.put("/{exam_id}/items/{item_id}")
def answer(profile_id: int, exam_id: int, item_id: int, body: AnswerIn, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    e = _exam(db, profile_id, exam_id)
    it = db.get(MockExamItem, item_id)
    if not it or it.exam_id != e.id:
        raise HTTPException(404, "Question not in this exam")
    if isinstance(body.response, str) and len(body.response) > 30000:
        raise HTTPException(413, "Answer too long")
    try:
        svc.save_answer(db, e, it, body.response, body.marked_review, body.time_spent_sec)
    except ValueError as ex:
        raise HTTPException(409, str(ex))
    return {"saved": True}


@router.post("/{exam_id}/items/{item_id}/check", dependencies=[Depends(limit_ai)])
async def practice_check(profile_id: int, exam_id: int, item_id: int, db: Session = DB, user: User = USER):
    """Practice mode only: mark one answer immediately and reveal the key."""
    get_profile(db, user, profile_id)
    e = _exam(db, profile_id, exam_id)
    if e.mode != "practice":
        raise HTTPException(403, "Answers are only revealed after submission in exam mode")
    it = db.get(MockExamItem, item_id)
    if not it or it.exam_id != e.id:
        raise HTTPException(404, "Question not in this exam")
    tr = Tracker("evaluator", "Checking a practice answer", profile_id)
    try:
        ev = await evaluate_question(db, profile_id, tr, it.question, it.response)
        tr.finish()
    except Exception as ex:
        tr.finish("failed", str(ex))
        raise HTTPException(503, str(ex))
    return {"feedback": ev, "question": svc.public_question(it.question, True)}


@router.post("/{exam_id}/submit")
async def submit(profile_id: int, exam_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    e = _exam(db, profile_id, exam_id)
    if e.status in ("evaluating", "evaluated"):
        raise HTTPException(409, "Already submitted")
    svc.submit(db, e)
    tr = Tracker("evaluator", f"Evaluating mock exam '{e.title}'", profile_id)

    async def work():
        with SessionLocal() as s:
            ex = s.get(MockExam, exam_id)
            return await svc.evaluate(s, ex, tr)

    return {"task_id": spawn(tr, work, lambda ex: {"mock_id": ex.id})}


@router.post("/{exam_id}/reevaluate")
async def reevaluate(profile_id: int, exam_id: int, db: Session = DB, user: User = USER):
    """Retry evaluation (e.g. if Ollama was offline when the exam was submitted)."""
    get_profile(db, user, profile_id)
    e = _exam(db, profile_id, exam_id)
    if e.status not in ("submitted", "evaluating"):
        raise HTTPException(409, "Only submitted, unevaluated exams can be re-evaluated")
    tr = Tracker("evaluator", f"Evaluating mock exam '{e.title}'", profile_id)

    async def work():
        with SessionLocal() as s:
            return await svc.evaluate(s, s.get(MockExam, exam_id), tr)

    return {"task_id": spawn(tr, work, lambda ex: {"mock_id": ex.id})}


@router.delete("/{exam_id}")
def delete(profile_id: int, exam_id: int, confirm: bool = False, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    e = _exam(db, profile_id, exam_id)
    if e.status == "evaluated" and not confirm:
        raise HTTPException(400, "This exam has saved results. Resend with confirm=true to delete them permanently.")
    db.delete(e)
    db.commit()
    return {"ok": True}
