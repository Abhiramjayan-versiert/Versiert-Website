"""Helpers shared by agents."""
from __future__ import annotations

import re
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.models.entities import ExamProfile, Subject, Topic

BASE_RULES = (
    "You are part of a private, offline exam-coaching system. Be accurate and exam-focused. "
    "Never invent facts, page numbers, citations, syllabus items or exam dates. "
    "If information is missing, say so. Never claim generated questions are real or guaranteed exam questions. "
    "Use clear British/Indian academic English."
)

LEVELS = {
    "beginner": "Explain from first principles with simple language and everyday analogies. Assume no prior knowledge.",
    "intermediate": "Assume basic familiarity; focus on clear reasoning and standard textbook depth.",
    "advanced": "Go deep: nuances, edge cases, critiques and links between concepts.",
    "mba": "Pitch at MBA semester-exam level: frameworks, managerial implications, Indian business examples, structured answers.",
    "ssc": "Pitch at SSC competitive-exam level: crisp facts, shortcuts, common traps and objective-question focus.",
    "short": "Keep everything brief, suitable for a 2-5 mark short answer.",
    "long": "Structure as a 10-15 mark long answer: introduction, headed body sections, examples, conclusion.",
}


def norm_name(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s.lower())).strip()


def token_overlap(name: str, text_norm: str) -> float:
    toks = [t for t in norm_name(name).split() if len(t) > 2]
    if not toks:
        return 1.0 if norm_name(name) in text_norm else 0.0
    return sum(1 for t in toks if t in text_norm) / len(toks)


def profile_brief(db: Session, profile: ExamProfile) -> str:
    subs = db.scalars(select(Subject).where(Subject.profile_id == profile.id).order_by(Subject.order)).all()
    days = (profile.exam_date - date.today()).days if profile.exam_date else None
    parts = [f"Exam: {profile.name} ({profile.exam_type}); target {profile.target_pct:g}%"]
    if days is not None:
        parts.append(f"exam in {days} days")
    if subs:
        parts.append("subjects: " + ", ".join(s.name for s in subs[:12]))
    return "; ".join(parts)


def find_topic(db: Session, profile_id: int, text: str) -> Topic | None:
    """Best fuzzy match of free text against the profile's topics."""
    tn = norm_name(text)
    if not tn:
        return None
    best, best_s = None, 0.0
    for t in db.scalars(select(Topic).where(Topic.profile_id == profile_id)):
        n = norm_name(t.name)
        if not n:
            continue
        if n == tn:
            return t
        s = token_overlap(t.name, tn) if n not in tn else 1.0
        s2 = token_overlap(text, n)
        sc = max(s * 0.7 + s2 * 0.3, 0)
        if sc > best_s:
            best, best_s = t, sc
    return best if best_s >= 0.6 else None


def find_subject(db: Session, profile_id: int, text: str) -> Subject | None:
    tn = norm_name(text)
    for s in db.scalars(select(Subject).where(Subject.profile_id == profile_id)):
        n = norm_name(s.name)
        if n and (n in tn or (tn and tn in n)):
            return s
    return None
