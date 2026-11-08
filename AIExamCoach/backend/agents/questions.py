"""Agent 5 — Question Paper Generator.

Questions are generated in small batches grounded on retrieved passages from
the profile's own documents (syllabus, textbooks, past papers, marking
schemes). Every question is validated (option indices, answer types);
numerical answers are recomputed in Python from the reference expression.
Citations only reference passages that were actually retrieved."""
from __future__ import annotations

import random
import re
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.agents.common import BASE_RULES, LEVELS
from backend.agents.runtime import Tracker
from backend.evaluation.numeric import safe_eval
from backend.models.entities import Document, ExamProfile, MockExam, MockExamItem, Question, Subject, Topic
from backend.rag.retrieve import format_context, retrieve
from backend.services import ollama

QTYPES = ["mcq", "msq", "true_false", "fill_blank", "short_answer", "long_answer", "case_study", "numerical", "assertion_reason", "essay"]
DEFAULT_MARKS = {"mcq": 1, "msq": 2, "true_false": 1, "fill_blank": 1, "short_answer": 3, "long_answer": 10,
                 "case_study": 10, "numerical": 4, "assertion_reason": 1, "essay": 15}
AR_OPTIONS = [
    "Both A and R are true and R is the correct explanation of A",
    "Both A and R are true but R is not the correct explanation of A",
    "A is true but R is false",
    "A is false but R is true",
]
TYPE_GUIDE = {
    "mcq": "4 options, exactly one correct; correct = [index 0-3].",
    "msq": "4-5 options, 2 or more correct; correct = list of indices.",
    "true_false": "a statement; correct_bool true/false.",
    "fill_blank": "sentence with ____ for the blank; accepted = list of acceptable answers.",
    "short_answer": "2-5 mark conceptual question; model_answer + rubric points + keywords.",
    "long_answer": "8-15 mark question; model_answer outline + rubric points summing to marks + keywords.",
    "case_study": "a short business/real-world case (4-8 sentences) followed by the question; model_answer + rubric.",
    "numerical": "calculation problem with given figures; expression = pure arithmetic expression giving the answer (digits and + - * / ( ) only); unit.",
    "assertion_reason": "text as 'Assertion (A): ... Reason (R): ...'; correct = [index into the standard 4 A/R options].",
    "essay": "15+ mark essay question; model_answer outline + rubric.",
}


class GQ(BaseModel):
    text: str
    options: list[str] = Field(default_factory=list)
    correct: list[int] = Field(default_factory=list)
    correct_bool: bool | None = None
    accepted: list[str] = Field(default_factory=list)
    expression: str | None = None
    value: float | None = None
    unit: str = ""
    model_answer: str = ""
    rubric: list[dict] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    explanation: str = ""
    source_ids: list[str] = Field(default_factory=list)


class GQBatch(BaseModel):
    questions: list[GQ]


def _validate(qtype: str, g: GQ, marks: float) -> tuple[dict | None, str]:
    """Return (question fields, problem)."""
    text = g.text.strip()
    if len(text) < 10:
        return None, "question too short"
    q: dict = {"qtype": qtype, "text": text, "marks": marks, "explanation": g.explanation.strip()[:2000],
               "keywords": [k for k in g.keywords if k.strip()][:12]}
    if qtype in ("mcq", "msq"):
        opts = [o.strip() for o in g.options if o.strip()]
        if len(opts) < 3 or len(set(o.lower() for o in opts)) != len(opts):
            return None, "bad options"
        idx = sorted({i for i in g.correct if 0 <= i < len(opts)})
        if qtype == "mcq" and len(idx) != 1:
            return None, "mcq needs exactly one correct option"
        if qtype == "msq" and not idx:
            return None, "msq needs correct options"
        q.update(options=opts, answer={"correct": idx})
    elif qtype == "assertion_reason":
        idx = [i for i in g.correct if 0 <= i < 4][:1]
        if not idx or "assertion" not in text.lower():
            return None, "bad assertion-reason"
        q.update(options=AR_OPTIONS, answer={"correct": idx})
    elif qtype == "true_false":
        if g.correct_bool is None:
            return None, "missing truth value"
        q.update(options=["True", "False"], answer={"correct": g.correct_bool})
    elif qtype == "fill_blank":
        acc = [a.strip() for a in g.accepted if a.strip()]
        if not acc or "__" not in text:
            return None, "bad blank"
        q.update(answer={"correct": acc[0], "accepted": acc})
    elif qtype == "numerical":
        val = None
        if g.expression:
            try:
                val = safe_eval(g.expression)  # Python-verified answer
            except Exception:  # noqa: BLE001
                val = None
        if val is None:
            return None, "numerical answer could not be verified in Python"
        if g.value is not None and abs(val - g.value) > max(0.01, abs(val) * 0.01):
            q["explanation"] = (q["explanation"] + f"\n(Answer recomputed in Python: {val:g}; model suggested {g.value:g}.)").strip()
        q.update(answer={"value": round(val, 6), "expression": g.expression, "unit": g.unit, "tolerance_pct": 1.0,
                         "model_answer": g.model_answer})
        q["rubric"] = g.rubric or [{"point": "Correct method/formula", "marks": round(marks * 0.5, 1)},
                                   {"point": "Correct final answer with unit", "marks": round(marks * 0.5, 1)}]
    else:
        if len(g.model_answer.strip()) < 20:
            return None, "missing model answer"
        rubric = [r for r in g.rubric if isinstance(r, dict) and r.get("point")]
        total = sum(float(r.get("marks", 0) or 0) for r in rubric)
        if rubric and total > 0 and abs(total - marks) > 0.01:
            for r in rubric:  # rescale rubric to the question's marks
                r["marks"] = round(float(r.get("marks", 0) or 0) * marks / total, 1)
        q.update(answer={"model_answer": g.model_answer.strip()}, rubric=rubric)
    return q, ""


async def generate(
    db: Session, profile: ExamProfile, tracker: Tracker, *, qtype: str, count: int, subject_id: int | None = None,
    topic_ids: list[int] | None = None, difficulty: str = "medium", marks: float | None = None, level: str | None = None,
) -> list[Question]:
    if qtype not in QTYPES:
        raise ValueError(f"Unknown question type {qtype}")
    count = max(1, min(count, 30))
    marks = marks or DEFAULT_MARKS[qtype]
    topics: list[Topic] = []
    if topic_ids:
        topics = db.scalars(select(Topic).where(Topic.id.in_(topic_ids), Topic.profile_id == profile.id)).all()
    elif subject_id:
        topics = db.scalars(select(Topic).where(Topic.subject_id == subject_id, Topic.kind != "unit")).all()
    subject = db.get(Subject, subject_id) if subject_id else (db.get(Subject, topics[0].subject_id) if topics else None)
    focus = [t for t in topics] or [None]
    has_past = db.scalar(select(func.count(Document.id)).where(Document.profile_id == profile.id, Document.category == "past_paper")) or 0

    created: list[Question] = []
    batch_size = 4 if qtype in ("mcq", "true_false", "fill_blank", "assertion_reason", "msq") else (2 if qtype in ("short_answer", "numerical") else 1)
    attempts = 0
    while len(created) < count and attempts < count + 4:
        attempts += 1
        topic = focus[(len(created) // batch_size) % len(focus)] if focus else None
        n = min(batch_size, count - len(created))
        subj_name = subject.name if subject else profile.name
        query = f"{topic.name if topic else subj_name} {topic.key_concepts if topic else ''}"[:300]
        tracker.step(f"Retrieving material for {topic.name if topic else subj_name}")
        passages = await retrieve(db, profile.id, query, k=4, subject_id=subject.id if subject else None)
        ctx = format_context(passages, 3200) if passages else ""
        tracker.step(f"Generating {n} {qtype.replace('_', ' ')} question(s) ({difficulty})")
        prompt = (
            f"Write {n} original {qtype.replace('_', ' ')} question(s) for: {profile.name}, subject {subj_name}"
            + (f", topic '{topic.name}'" if topic else "")
            + f". Difficulty: {difficulty}. Marks each: {marks:g}. Format rules: {TYPE_GUIDE[qtype]} "
            + (LEVELS.get(level or profile.exam_type, "") + " ")
            + ("Mirror the style of past papers in the sources where relevant. " if has_past else "")
            + ("Base questions on the SOURCES; put the [S#] ids you used in source_ids. " if ctx else "Use standard syllabus knowledge; leave source_ids empty. ")
            + "Include a brief explanation of the correct answer."
            + (f"\n\nSOURCES:\n{ctx}" if ctx else "")
        )
        batch, _ = await ollama.chat_json([{"role": "system", "content": BASE_RULES}, {"role": "user", "content": prompt}], GQBatch, temperature=0.6)
        for g in batch.questions[:n]:
            fields, problem = _validate(qtype, g, marks)
            if not fields:
                tracker.step(f"Discarded one invalid question ({problem})")
                continue
            cites = []
            for sid in g.source_ids:
                m = re.match(r"\[?S(\d+)\]?", sid.strip())
                if m and 1 <= int(m.group(1)) <= len(passages):
                    cites.append(passages[int(m.group(1)) - 1].citation())
            q = Question(profile_id=profile.id, subject_id=subject.id if subject else None, topic_id=topic.id if topic else None,
                         difficulty=difficulty, citations=cites, source="generated", **fields)
            db.add(q)
            created.append(q)
        db.commit()
    return created


PATTERNS = {
    "objective": [("mcq", 1.0)],
    "mixed": [("mcq", 0.3), ("short_answer", 0.3), ("long_answer", 0.4)],
    "descriptive": [("short_answer", 0.4), ("long_answer", 0.6)],
    "mba": [("short_answer", 0.3), ("long_answer", 0.4), ("case_study", 0.3)],
    "ssc": [("mcq", 0.85), ("assertion_reason", 0.15)],
    "numerical": [("numerical", 0.6), ("short_answer", 0.4)],
}


async def build_paper(
    db: Session, profile: ExamProfile, tracker: Tracker, *, total_marks: float, duration_min: int, pattern: str = "mixed",
    subject_id: int | None = None, topic_ids: list[int] | None = None, difficulty: str = "medium", mode: str = "exam",
    reuse_bank: bool = True, title: str | None = None,
) -> MockExam:
    """Assemble a mock paper to the requested marks: reuse unseen bank questions
    first, then generate the remainder."""
    mix = PATTERNS.get(pattern, PATTERNS["mixed"])
    chosen: list[Question] = []
    for qtype, share in mix:
        target = total_marks * share
        per = DEFAULT_MARKS[qtype]
        need = max(1, round(target / per))
        pool: list[Question] = []
        if reuse_bank:
            q = select(Question).where(Question.profile_id == profile.id, Question.qtype == qtype)
            if subject_id:
                q = q.where(Question.subject_id == subject_id)
            if topic_ids:
                q = q.where(Question.topic_id.in_(topic_ids))
            used_ids = set(db.scalars(select(MockExamItem.question_id).join(MockExam).where(MockExam.profile_id == profile.id)))
            pool = [x for x in db.scalars(q) if x.id not in used_ids]
            random.shuffle(pool)
        take = pool[:need]
        if len(take) < need:
            tracker.step(f"Question bank has {len(take)} unused {qtype.replace('_', ' ')} question(s); generating {need - len(take)} more")
            take += await generate(db, profile, tracker, qtype=qtype, count=need - len(take), subject_id=subject_id,
                                   topic_ids=topic_ids, difficulty=difficulty, marks=per)
        chosen += take
    if not chosen:
        raise ValueError("Could not assemble any questions.")
    total = round(sum(q.marks for q in chosen), 2)
    exam = MockExam(profile_id=profile.id, subject_id=subject_id, title=title or f"Mock exam — {total:g} marks",
                    mode=mode if mode in ("exam", "practice") else "exam", duration_min=duration_min, total_marks=total)
    db.add(exam)
    db.flush()
    order = {t: i for i, (t, _) in enumerate(mix)}
    for i, q in enumerate(sorted(chosen, key=lambda x: order.get(x.qtype, 9))):
        db.add(MockExamItem(exam_id=exam.id, question_id=q.id, order=i))
    db.commit()
    if abs(total - total_marks) > 0.5:
        tracker.step(f"Paper totals {total:g} marks (requested {total_marks:g}) because of fixed per-question marks")
    return exam
