"""Mock examination lifecycle: start → autosave → submit → evaluate → results.

In ``exam`` mode the answer key is never sent to the client before
submission and the server enforces the deadline (with a short grace period
for network latency). ``practice`` mode allows checking answers per question."""
from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

from sqlalchemy.orm import Session

from backend.agents.evaluator import evaluate_question
from backend.agents.revision import add_mistake_card
from backend.agents.runtime import Tracker
from backend.models.entities import MockExam, MockExamItem, Question, QuestionAttempt, Subject, Topic, utcnow

GRACE = timedelta(seconds=30)


def public_question(q: Question, reveal: bool) -> dict:
    d = {"id": q.id, "qtype": q.qtype, "text": q.text, "options": q.options, "marks": q.marks, "difficulty": q.difficulty,
         "topic_id": q.topic_id, "subject_id": q.subject_id}
    if reveal:
        d.update(answer=q.answer, explanation=q.explanation, rubric=q.rubric, keywords=q.keywords, citations=q.citations)
    return d


def exam_view(exam: MockExam) -> dict:
    reveal = exam.status == "evaluated" or exam.mode == "practice"
    return {
        "id": exam.id, "title": exam.title, "mode": exam.mode, "status": exam.status, "duration_min": exam.duration_min,
        "total_marks": exam.total_marks, "started_at": exam.started_at.isoformat() + "Z" if exam.started_at else None,
        "deadline": exam.deadline.isoformat() + "Z" if exam.deadline else None,
        "server_now": utcnow().isoformat() + "Z",
        "submitted_at": exam.submitted_at.isoformat() + "Z" if exam.submitted_at else None,
        "marks_awarded": exam.marks_awarded, "percentage": exam.percentage, "result": exam.result if exam.status == "evaluated" else {},
        "items": [{"id": it.id, "order": it.order, "response": it.response, "marked_review": it.marked_review, "time_spent_sec": it.time_spent_sec,
                   "marks_awarded": it.marks_awarded if exam.status == "evaluated" else None,
                   "feedback": it.feedback if exam.status == "evaluated" else {},
                   "question": public_question(it.question, reveal)} for it in exam.items],
    }


def start(db: Session, exam: MockExam) -> MockExam:
    if exam.status == "ready":
        exam.status = "in_progress"
        exam.started_at = utcnow()
        exam.deadline = exam.started_at + timedelta(minutes=exam.duration_min)
        db.commit()
    return exam


def expired(exam: MockExam) -> bool:
    return exam.mode == "exam" and exam.deadline is not None and utcnow() > exam.deadline + GRACE


def save_answer(db: Session, exam: MockExam, item: MockExamItem, response, marked_review: bool | None, time_spent_sec: int | None) -> None:
    if exam.status != "in_progress":
        raise ValueError("This exam is not in progress.")
    if expired(exam):
        raise ValueError("Time is up — the exam must be submitted.")
    item.response = response
    if marked_review is not None:
        item.marked_review = marked_review
    if time_spent_sec is not None:
        item.time_spent_sec = max(0, min(int(time_spent_sec), exam.duration_min * 60 * 2))
    db.commit()


def submit(db: Session, exam: MockExam) -> MockExam:
    if exam.status not in ("in_progress", "ready"):
        return exam
    exam.status = "submitted"
    exam.submitted_at = utcnow()
    db.commit()
    return exam


async def evaluate(db: Session, exam: MockExam, tracker: Tracker) -> MockExam:
    exam.status = "evaluating"
    db.commit()
    total, awarded = 0.0, 0.0
    by_subject: dict = defaultdict(lambda: [0.0, 0.0])
    by_topic: dict = defaultdict(lambda: [0.0, 0.0])
    incorrect = []
    n = len(exam.items)
    for i, it in enumerate(exam.items, 1):
        q = it.question
        tracker.step(f"Marking question {i} of {n} ({q.qtype.replace('_', ' ')}, {q.marks:g} marks)")
        ev = await evaluate_question(db, exam.profile_id, tracker, q, it.response)
        it.marks_awarded = ev["marks_awarded"]
        it.feedback = ev
        total += q.marks
        awarded += max(0.0, ev["marks_awarded"]) if q.negative_marks == 0 else ev["marks_awarded"]
        by_subject[q.subject_id][0] += ev["marks_awarded"]
        by_subject[q.subject_id][1] += q.marks
        if q.topic_id:
            by_topic[q.topic_id][0] += ev["marks_awarded"]
            by_topic[q.topic_id][1] += q.marks
        db.add(QuestionAttempt(profile_id=exam.profile_id, question_id=q.id, topic_id=q.topic_id, subject_id=q.subject_id, mock_id=exam.id,
                               context="mock" if exam.mode == "exam" else "practice", marks_awarded=ev["marks_awarded"], max_marks=q.marks,
                               correct=bool(ev.get("correct")), time_spent_sec=it.time_spent_sec))
        if not ev.get("correct"):
            incorrect.append(it.id)
            add_mistake_card(db, q)
        db.commit()
    awarded = max(0.0, awarded)
    subj_names = {s.id: s.name for s in db.query(Subject).filter(Subject.profile_id == exam.profile_id)}
    topic_names = {t.id: t.name for t in db.query(Topic).filter(Topic.id.in_(list(by_topic)))} if by_topic else {}
    weak = sorted([{"topic_id": k, "topic": topic_names.get(k, "?"), "pct": round(100 * max(0, a) / m, 1)} for k, (a, m) in by_topic.items() if m],
                  key=lambda x: x["pct"])
    used = (exam.submitted_at - exam.started_at).total_seconds() / 60 if exam.started_at and exam.submitted_at else None
    exam.marks_awarded = round(awarded, 2)
    exam.percentage = round(100 * awarded / total, 1) if total else 0
    exam.result = {
        "by_subject": [{"subject_id": k, "subject": subj_names.get(k, "General"), "marks": round(a, 2), "max": m, "pct": round(100 * max(0, a) / m, 1)}
                       for k, (a, m) in by_subject.items() if m],
        "weak_topics": [w for w in weak if w["pct"] < 60],
        "incorrect_item_ids": incorrect,
        "time_used_min": round(used, 1) if used is not None else None,
        "recommendation": ("Revise: " + ", ".join(w["topic"] for w in weak[:3] if w["pct"] < 60)) if any(w["pct"] < 60 for w in weak) else
                          "Good work — keep revising with spaced repetition and try a harder mock.",
    }
    exam.status = "evaluated"
    db.commit()
    return exam
