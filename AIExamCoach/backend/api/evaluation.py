from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.agents.common import find_topic
from backend.agents.evaluator import evaluate_descriptive, evaluate_numerical
from backend.agents.runtime import Tracker
from backend.api.deps import DB, USER, spawn
from backend.config import UPLOADS_DIR, get_settings
from backend.database.session import SessionLocal
from backend.models.entities import Evaluation, Question, QuestionAttempt, Topic, User
from backend.rag.extract import extract_all_text
from backend.security.auth import get_profile
from backend.security.files import save_upload
from backend.security.ratelimit import limit_ai

router = APIRouter(prefix="/api/profiles/{profile_id}/evaluations", tags=["evaluation"])
ANSWER_TYPES = {"pdf", "docx", "txt", "jpg", "jpeg", "png"}


@router.post("/extract")
async def extract_answer(profile_id: int, file: UploadFile = File(...), db: Session = DB, user: User = USER):
    """Step 1 for files/photos: extract text (local OCR for images/scans) so
    the student can review and correct it before evaluation."""
    get_profile(db, user, profile_id)
    info = await save_upload(file, UPLOADS_DIR, get_settings().max_upload_mb, ANSWER_TYPES)
    try:
        text, conf = await asyncio.to_thread(extract_all_text, info["path"], info["ext"], get_settings().ocr_language)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"Could not read the file: {e}")
    finally:
        info["path"].unlink(missing_ok=True)  # answer files are not kept; only the confirmed text is stored
    low = conf is not None and conf < get_settings().ocr_low_confidence
    return {"text": text, "ocr_confidence": conf, "ocr_used": conf is not None, "low_confidence": low, "input_kind": "image" if info["ext"] in ("jpg", "jpeg", "png") else info["ext"],
            "message": ("OCR confidence is low — please check and correct the text before evaluating." if low else
                        "Check the extracted text, then evaluate.")}


class EvalIn(BaseModel):
    question_text: str = Field(min_length=5, max_length=10000)
    max_marks: float = Field(ge=0.5, le=100)
    answer_text: str = Field(min_length=1, max_length=40000)
    qtype: str = Field("long_answer", pattern="^(short_answer|long_answer|case_study|essay|numerical)$")
    model_answer: str = Field("", max_length=10000)
    keywords: list[str] = Field(default_factory=list)
    rubric: list[dict] = Field(default_factory=list)
    expected_value: float | None = None
    expression: str | None = Field(None, max_length=200)
    tolerance_pct: float = Field(1.0, ge=0, le=50)
    question_id: int | None = None
    topic_id: int | None = None
    input_kind: str = Field("text", max_length=16)
    ocr_confidence: float | None = None
    ocr_confirmed: bool = False


@router.post("", dependencies=[Depends(limit_ai)])
async def evaluate(profile_id: int, body: EvalIn, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    if body.ocr_confidence is not None and body.ocr_confidence < get_settings().ocr_low_confidence and not body.ocr_confirmed:
        raise HTTPException(409, "OCR confidence is low. Review the extracted text and confirm it before evaluation.")
    q = None
    if body.question_id:
        q = db.get(Question, body.question_id)
        if not q or q.profile_id != profile_id:
            raise HTTPException(404, "Question not found")
    if body.topic_id and (not (t := db.get(Topic, body.topic_id)) or t.profile_id != profile_id):
        raise HTTPException(400, "Unknown topic")
    tr = Tracker("evaluator", f"Evaluating answer against {body.max_marks:g}-mark rubric", profile_id)

    async def work():
        with SessionLocal() as s:
            topic = s.get(Topic, body.topic_id) if body.topic_id else (s.get(Topic, q.topic_id) if q and q.topic_id else find_topic(s, profile_id, body.question_text))
            if body.qtype == "numerical":
                res = await evaluate_numerical(s, profile_id, tr, question=body.question_text, max_marks=body.max_marks, answer=body.answer_text,
                                               expected=body.expected_value if body.expected_value is not None else (q.answer.get("value") if q else None),
                                               expression=body.expression or (q.answer.get("expression") if q else None),
                                               tolerance_pct=body.tolerance_pct, model_answer=body.model_answer)
            else:
                res = await evaluate_descriptive(s, profile_id, tr, question=body.question_text, max_marks=body.max_marks, answer=body.answer_text,
                                                 model_answer=body.model_answer or (q.answer.get("model_answer", "") if q else ""),
                                                 rubric=body.rubric or (q.rubric if q else None), keywords=body.keywords or (q.keywords if q else None),
                                                 qtype=body.qtype)
            ev = Evaluation(profile_id=profile_id, topic_id=topic.id if topic else None, subject_id=topic.subject_id if topic else None,
                            question_text=body.question_text, max_marks=body.max_marks, answer_text=body.answer_text, input_kind=body.input_kind,
                            ocr_confidence=body.ocr_confidence, marks_awarded=res["marks_awarded"], percentage=res["percentage"], result=res)
            s.add(ev)
            s.add(QuestionAttempt(profile_id=profile_id, question_id=q.id if q else None, topic_id=topic.id if topic else None,
                                  subject_id=topic.subject_id if topic else None, context="practice", marks_awarded=res["marks_awarded"],
                                  max_marks=body.max_marks, correct=res["percentage"] >= 60))
            s.commit()
            return ev

    return {"task_id": spawn(tr, work, lambda ev: {"evaluation_id": ev.id})}


def ev_out(e: Evaluation) -> dict:
    return {"id": e.id, "question_text": e.question_text, "max_marks": e.max_marks, "answer_text": e.answer_text, "input_kind": e.input_kind,
            "ocr_confidence": e.ocr_confidence, "marks_awarded": e.marks_awarded, "percentage": e.percentage, "result": e.result,
            "topic_id": e.topic_id, "created_at": e.created_at.isoformat()}


@router.get("")
def list_evals(profile_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    return [ev_out(e) for e in db.scalars(select(Evaluation).where(Evaluation.profile_id == profile_id).order_by(Evaluation.id.desc()).limit(100))]


@router.get("/{eval_id}")
def get_eval(profile_id: int, eval_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    e = db.get(Evaluation, eval_id)
    if not e or e.profile_id != profile_id:
        raise HTTPException(404, "Evaluation not found")
    return ev_out(e)
