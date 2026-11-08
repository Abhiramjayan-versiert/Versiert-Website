"""Agent 7 — Revision Coach: SM-2 spaced repetition with configurable early
intervals, flashcard generation, mistake cards, daily lists and quizzes."""
from __future__ import annotations

import random
from datetime import date, timedelta

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.agents.common import BASE_RULES
from backend.agents.runtime import Tracker
from backend.config import get_settings
from backend.models.entities import ExamProfile, Question, QuestionAttempt, RevisionItem, RevisionLog, Topic, utcnow
from backend.rag.retrieve import format_context, retrieve
from backend.services import ollama


def schedule(item: RevisionItem, grade: int, today: date | None = None) -> RevisionItem:
    """SM-2. grade 0-5 (0-2 = forgotten, 3 = hard, 4 = good, 5 = easy)."""
    today = today or date.today()
    grade = max(0, min(5, int(grade)))
    intervals = get_settings().srs_initial_intervals or [1, 3, 7]
    if grade < 3:
        item.repetitions = 0
        item.lapses += 1
        item.interval_days = 1
    else:
        item.repetitions += 1
        if item.repetitions <= len(intervals):
            item.interval_days = intervals[item.repetitions - 1]
            if grade == 5 and item.repetitions < len(intervals):
                item.interval_days = intervals[item.repetitions]
        else:
            item.interval_days = max(1, round(item.interval_days * item.ease))
    item.ease = max(1.3, item.ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)))
    item.due_date = today + timedelta(days=item.interval_days)
    item.last_reviewed = utcnow()
    return item


def review(db: Session, item: RevisionItem, grade: int) -> RevisionItem:
    schedule(item, grade)
    db.add(RevisionLog(item_id=item.id, profile_id=item.profile_id, topic_id=item.topic_id, grade=grade))
    db.commit()
    return item


def weak_topic_ids(db: Session, profile_id: int, threshold: float = 0.6) -> dict[int, float]:
    rows = db.execute(select(QuestionAttempt.topic_id, func.sum(QuestionAttempt.marks_awarded), func.sum(QuestionAttempt.max_marks))
                      .where(QuestionAttempt.profile_id == profile_id, QuestionAttempt.topic_id.is_not(None))
                      .group_by(QuestionAttempt.topic_id)).all()
    return {t: a / m for t, a, m in rows if m and a / m < threshold}


def daily_list(db: Session, profile_id: int, limit: int = 40, today: date | None = None) -> list[RevisionItem]:
    today = today or date.today()
    due = db.scalars(select(RevisionItem).where(RevisionItem.profile_id == profile_id, RevisionItem.due_date <= today,
                                                RevisionItem.suspended.is_(False))).all()
    weak = weak_topic_ids(db, profile_id)

    def prio(i: RevisionItem) -> tuple:
        overdue = (today - i.due_date).days
        return (-(i.kind == "mistake"), -(i.topic_id in weak), -i.lapses, -overdue, i.ease)

    return sorted(due, key=prio)[:limit]


def add_mistake_card(db: Session, q: Question, response_text: str = "") -> RevisionItem | None:
    """Previously-incorrect questions become revision cards automatically."""
    exists = db.scalar(select(RevisionItem).where(RevisionItem.question_id == q.id, RevisionItem.kind == "mistake"))
    if exists:
        exists.due_date = date.today() + timedelta(days=1)
        exists.repetitions = 0
        return exists
    if q.qtype in ("mcq", "msq", "assertion_reason"):
        idx = q.answer.get("correct", [])
        back = "; ".join(q.options[i] for i in idx if i < len(q.options))
    elif q.qtype == "true_false":
        back = "True" if q.answer.get("correct") else "False"
    elif q.qtype == "fill_blank":
        back = q.answer.get("correct", "")
    elif q.qtype == "numerical":
        back = f"{q.answer.get('value')} {q.answer.get('unit', '')}".strip()
    else:
        back = q.answer.get("model_answer", "")[:1500]
    if q.explanation:
        back += f"\n\nWhy: {q.explanation[:600]}"
    item = RevisionItem(profile_id=q.profile_id, topic_id=q.topic_id, question_id=q.id, kind="mistake",
                        front=q.text[:2000], back=back, due_date=date.today() + timedelta(days=1))
    db.add(item)
    return item


class Card(BaseModel):
    kind: str  # definition | formula | concept
    front: str
    back: str


class Cards(BaseModel):
    cards: list[Card]


async def generate_cards(db: Session, profile: ExamProfile, tracker: Tracker, topic: Topic, n: int = 8) -> list[RevisionItem]:
    tracker.step(f"Retrieving notes for '{topic.name}'")
    passages = await retrieve(db, profile.id, f"{topic.name} {topic.key_concepts}", k=3, subject_id=topic.subject_id)
    ctx = format_context(passages, 2500)
    tracker.step(f"Creating {n} active-recall flashcards")
    out, _ = await ollama.chat_json([
        {"role": "system", "content": BASE_RULES},
        {"role": "user", "content": f"Create {n} active-recall flashcards for '{topic.name}' ({profile.name}). Mix definitions, formulas (if the topic has any) "
                                    "and concept questions. front = question/prompt, back = concise exact answer. kind = definition|formula|concept."
                                    + (f"\nBase them on these SOURCES:\n{ctx}" if ctx else "")},
    ], Cards, temperature=0.4)
    items = []
    for c in out.cards[:n]:
        if len(c.front.strip()) < 5 or len(c.back.strip()) < 2:
            continue
        kind = c.kind if c.kind in ("definition", "formula", "concept") else "flashcard"
        it = RevisionItem(profile_id=profile.id, topic_id=topic.id, kind=kind, front=c.front.strip(), back=c.back.strip(), due_date=date.today())
        db.add(it)
        items.append(it)
    db.commit()
    return items


def quick_quiz(db: Session, profile_id: int, n: int = 10, only_incorrect: bool = False, since_days: int | None = None) -> list[Question]:
    """Objective questions focused on weak topics and past mistakes."""
    wrong_q = select(QuestionAttempt.question_id).where(QuestionAttempt.profile_id == profile_id, QuestionAttempt.correct.is_(False))
    if since_days is not None:
        wrong_q = wrong_q.where(QuestionAttempt.at >= utcnow() - timedelta(days=since_days))
    wrong_ids = set(x for x in db.scalars(wrong_q) if x)
    objective = ("mcq", "msq", "true_false", "fill_blank", "assertion_reason", "numerical")
    pool = db.scalars(select(Question).where(Question.profile_id == profile_id, Question.qtype.in_(objective))).all()
    weak = weak_topic_ids(db, profile_id)
    if only_incorrect:
        pool = [q for q in pool if q.id in wrong_ids]
    random.shuffle(pool)
    pool.sort(key=lambda q: (q.id not in wrong_ids, q.topic_id not in weak))
    return pool[:n]


def retention_stats(db: Session, profile_id: int, days: int = 30) -> dict:
    since = utcnow() - timedelta(days=days)
    logs = db.scalars(select(RevisionLog).where(RevisionLog.profile_id == profile_id, RevisionLog.at >= since)).all()
    if not logs:
        return {"reviews": 0, "recall_rate": None}
    ok = sum(1 for l in logs if l.grade >= 3)
    forgotten_topics = {l.topic_id for l in logs if l.grade < 3 and l.topic_id}
    return {"reviews": len(logs), "recall_rate": round(100 * ok / len(logs), 1), "forgotten_topic_ids": sorted(forgotten_topics)}
