"""Agent 6 — Answer Evaluator.

* Objective questions: deterministic marking (evaluation/objective.py).
* Numerical: final answer and arithmetic steps verified with Python/SymPy;
  the LLM only assesses method.
* Descriptive: rubric-based LLM marking, grounded on the uploaded marking
  scheme (if any), then deterministic guards (keyword stuffing, length caps,
  clamping, half-mark rounding)."""
from __future__ import annotations

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.agents.common import BASE_RULES
from backend.agents.runtime import Tracker
from backend.evaluation.descriptive import apply_guards, keyword_coverage
from backend.evaluation.numeric import verify_numerical
from backend.evaluation.objective import DESCRIPTIVE_TYPES, OBJECTIVE_TYPES, mark_objective
from backend.models.entities import Document, Question
from backend.rag.retrieve import format_context, retrieve
from backend.services import ollama


class Criteria(BaseModel):
    correctness: int = Field(ge=0, le=10)
    understanding: int = Field(ge=0, le=10)
    structure: int = Field(ge=0, le=10)
    completeness: int = Field(ge=0, le=10)
    examples: int = Field(ge=0, le=10)
    presentation: int = Field(ge=0, le=10)


class RubricScore(BaseModel):
    point: str
    awarded: float
    max: float


class LLMEval(BaseModel):
    marks_awarded: float
    rubric_scores: list[RubricScore] = Field(default_factory=list)
    criteria: Criteria
    what_was_correct: list[str] = Field(default_factory=list)
    what_was_missing: list[str] = Field(default_factory=list)
    what_was_incorrect: list[str] = Field(default_factory=list)
    expected_keywords: list[str] = Field(default_factory=list)
    how_to_improve: list[str] = Field(default_factory=list)
    model_answer: str
    expected_answer_explanation: str


async def _scheme_context(db: Session, profile_id: int, question: str) -> tuple[str, list[dict]]:
    has_scheme = db.scalar(select(Document.id).where(Document.profile_id == profile_id, Document.category == "marking_scheme").limit(1))
    if not has_scheme:
        return "", []
    passages = [p for p in await retrieve(db, profile_id, question, k=4)]
    scheme_docs = set(db.scalars(select(Document.id).where(Document.profile_id == profile_id, Document.category == "marking_scheme")))
    passages = [p for p in passages if p.document_id in scheme_docs][:3]
    return format_context(passages, 2500), [p.citation() for p in passages]


async def evaluate_descriptive(
    db: Session, profile_id: int, tracker: Tracker, *, question: str, max_marks: float, answer: str,
    model_answer: str = "", rubric: list[dict] | None = None, keywords: list[str] | None = None, qtype: str = "long_answer",
) -> dict:
    tracker.step(f"Evaluating answer against {max_marks:g}-mark rubric")
    scheme, scheme_cites = await _scheme_context(db, profile_id, question)
    rubric_txt = "\n".join(f"- {r.get('point')} ({r.get('marks')} marks)" for r in (rubric or []))
    prompt = (
        f"Mark this {qtype.replace('_', ' ')} answer out of {max_marks:g}. Be a strict but fair university examiner. Give partial marks "
        "for partially correct points. Do NOT reward answers that merely list keywords without explaining them. "
        "Assess correctness, conceptual understanding, relevant keywords, structure, completeness, examples and presentation. "
        "If a marking scheme or rubric is given, follow it exactly.\n\n"
        f"QUESTION ({max_marks:g} marks):\n{question}\n\n"
        + (f"RUBRIC:\n{rubric_txt}\n\n" if rubric_txt else "")
        + (f"REFERENCE ANSWER:\n{model_answer[:1800]}\n\n" if model_answer else "")
        + (f"MARKING SCHEME (from uploaded document):\n{scheme}\n\n" if scheme else "")
        + f"STUDENT ANSWER:\n{answer[:5000]}\n\nReturn JSON. model_answer must be a complete answer worth full marks."
    )
    ev, res = await ollama.chat_json([{"role": "system", "content": BASE_RULES}, {"role": "user", "content": prompt}], LLMEval, temperature=0.1)
    kws = [k for k in (keywords or []) if k.strip()] or ev.expected_keywords
    cov = keyword_coverage(answer, kws)
    guard = apply_guards(ev.marks_awarded, max_marks, answer, kws)
    marks = guard["marks"]
    return {
        "marks_awarded": marks, "max_marks": max_marks, "percentage": round(100 * marks / max_marks, 1) if max_marks else 0,
        "what_was_correct": ev.what_was_correct, "what_was_missing": ev.what_was_missing, "what_was_incorrect": ev.what_was_incorrect,
        "missing_keywords": cov["missing"], "keywords_present": cov["present"], "how_to_improve": ev.how_to_improve,
        "model_answer": ev.model_answer, "expected_answer_explanation": ev.expected_answer_explanation,
        "criteria": ev.criteria.model_dump(), "rubric_scores": [r.model_dump() for r in ev.rubric_scores],
        "guard_notes": guard["notes"], "llm_marks": ev.marks_awarded, "signals": guard["signals"],
        "marking_scheme_citations": scheme_cites, "used_marking_scheme": bool(scheme), "model": res.model,
    }


async def evaluate_numerical(db: Session, profile_id: int, tracker: Tracker, *, question: str, max_marks: float, answer: str,
                             expected: float | None, expression: str | None, tolerance_pct: float = 1.0, model_answer: str = "") -> dict:
    tracker.step("Verifying calculations with Python")
    check = verify_numerical(answer, expected, expression, tolerance_pct)
    llm = await evaluate_descriptive(db, profile_id, tracker, question=question, max_marks=max_marks, answer=answer,
                                     model_answer=model_answer or (f"Final answer: {check['expected']:g}" if check.get("expected") is not None else ""),
                                     qtype="numerical")
    notes = list(llm["guard_notes"])
    marks = llm["marks_awarded"]
    if check["expected"] is not None:
        if check.get("match"):
            floor = max_marks * (0.7 if not check["arithmetic_errors"] else 0.5)
            marks = max(marks, floor)
            notes.append(f"Python check: final answer {check['student_final']:g} is correct (expected {check['expected']:g}).")
        else:
            marks = min(marks, max_marks * 0.5)
            notes.append(f"Python check: final answer {check['student_final'] if check['student_final'] is not None else 'not found'} "
                         f"does not match expected {check['expected']:g}; only method marks awarded (max 50%).")
    for e in check["arithmetic_errors"]:
        notes.append(f"Arithmetic error: {e['step']} (correct value {e['computed']:g}).")
    marks = round(min(marks, max_marks) * 2) / 2
    llm.update(marks_awarded=marks, percentage=round(100 * marks / max_marks, 1), guard_notes=notes, python_verification=check)
    return llm


async def evaluate_question(db: Session, profile_id: int, tracker: Tracker, q: Question, response) -> dict:
    """Mark a stored question (used by mock exams and quizzes)."""
    if q.qtype in OBJECTIVE_TYPES and q.qtype != "numerical":
        r = mark_objective(q.qtype, q.answer, response, q.marks, q.negative_marks)
        return {"marks_awarded": r["marks"], "max_marks": q.marks, "correct": r["correct"], "attempted": r["attempted"], "detail": r["detail"]}
    text = response if isinstance(response, str) else ("" if response is None else str(response))
    if not text.strip():
        return {"marks_awarded": 0.0, "max_marks": q.marks, "correct": False, "attempted": False, "detail": "Not attempted"}
    if q.qtype == "numerical":
        # pure number response → deterministic; working shown → full evaluation
        if len(text.split()) <= 3:
            r = mark_objective("numerical", q.answer, text, q.marks)
            return {"marks_awarded": r["marks"], "max_marks": q.marks, "correct": r["correct"], "attempted": True, "detail": r["detail"]}
        ev = await evaluate_numerical(db, profile_id, tracker, question=q.text, max_marks=q.marks, answer=text,
                                      expected=q.answer.get("value"), expression=q.answer.get("expression"),
                                      tolerance_pct=q.answer.get("tolerance_pct", 1.0), model_answer=q.answer.get("model_answer", ""))
    else:
        assert q.qtype in DESCRIPTIVE_TYPES
        ev = await evaluate_descriptive(db, profile_id, tracker, question=q.text, max_marks=q.marks, answer=text,
                                        model_answer=q.answer.get("model_answer", ""), rubric=q.rubric, keywords=q.keywords, qtype=q.qtype)
    ev["correct"] = ev["percentage"] >= 60
    ev["attempted"] = True
    return ev
