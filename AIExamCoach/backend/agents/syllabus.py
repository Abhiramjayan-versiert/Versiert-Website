"""Agent 2 — Syllabus Analyst.

Extracts subjects → units → topics → subtopics, marks and exam dates from a
syllabus. Output is GROUNDED: every extracted name must appear in the source
text (token overlap check), otherwise it is dropped with a warning. Missing
information is left empty, never guessed. Results are saved as a draft for
the user to edit before applying."""
from __future__ import annotations

import re
from datetime import date

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.agents.common import BASE_RULES, norm_name, token_overlap
from backend.agents.runtime import Tracker
from backend.models.entities import Chunk, Document, Subject, SyllabusDraft, Topic
from backend.services import ollama


class XTopic(BaseModel):
    name: str
    subtopics: list[str] = Field(default_factory=list)
    marks: float | None = None
    key_concepts: list[str] = Field(default_factory=list)
    prerequisites: list[str] = Field(default_factory=list)


class XUnit(BaseModel):
    name: str
    marks: float | None = None
    topics: list[XTopic] = Field(default_factory=list)


class XSubject(BaseModel):
    name: str
    total_marks: float | None = None
    units: list[XUnit] = Field(default_factory=list)


class XSyllabus(BaseModel):
    subjects: list[XSubject] = Field(default_factory=list)
    exam_dates_mentioned: list[str] = Field(default_factory=list)
    marks_distribution_notes: str = ""


PROMPT = (
    "Extract the syllabus structure from the text below. Use ONLY names that appear in the text. "
    "Unit/module/chapter headings are units; items under them are topics; comma-separated items inside a topic are subtopics. "
    "Fill marks only where the text states marks/weightage (otherwise null). "
    "key_concepts/prerequisites only if stated or unambiguous. "
    "If there is a single subject without a name, use the course title from the text. Return JSON.\n\nSYLLABUS TEXT:\n"
)

_MARKS = re.compile(r"(\d{1,3}(?:\.\d)?)\s*(?:marks|mark|m\b|%|weightage)", re.I)
_DATE = re.compile(
    r"\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+\d{4})\b",
    re.I,
)


def _windows(text: str, size: int = 2800, overlap: int = 200) -> list[str]:
    text = text.strip()
    if len(text) <= size:
        return [text]
    out, i = [], 0
    while i < len(text):
        end = min(len(text), i + size)
        nl = text.rfind("\n", i + size // 2, end)
        if nl != -1 and end < len(text):
            end = nl
        out.append(text[i:end])
        if end >= len(text):
            break
        i = max(end - overlap, i + 1)
    return out


def _merge(acc: dict, x: XSyllabus) -> None:
    for s in x.subjects:
        key = norm_name(s.name)
        if not key:
            continue
        sub = acc.setdefault(key, {"name": s.name.strip(), "total_marks": s.total_marks, "units": {}})
        if sub["total_marks"] is None and s.total_marks:
            sub["total_marks"] = s.total_marks
        for u in s.units:
            uk = norm_name(u.name) or "_general"
            unit = sub["units"].setdefault(uk, {"name": u.name.strip() or "General", "marks": u.marks, "topics": {}})
            if unit["marks"] is None and u.marks:
                unit["marks"] = u.marks
            for t in u.topics:
                tk = norm_name(t.name)
                if not tk:
                    continue
                top = unit["topics"].setdefault(tk, {"name": t.name.strip(), "subtopics": [], "marks": t.marks, "key_concepts": [], "prerequisites": []})
                for f in ("subtopics", "key_concepts", "prerequisites"):
                    for v in getattr(t, f):
                        if v.strip() and v.strip() not in top[f]:
                            top[f].append(v.strip())
                if top["marks"] is None and t.marks:
                    top["marks"] = t.marks


def _ground(acc: dict, source: str) -> tuple[list[dict], list[str]]:
    """Drop anything not supported by the source text."""
    src = norm_name(source)
    warnings: list[str] = []
    subjects = []
    for s in acc.values():
        units = []
        for u in s["units"].values():
            topics = []
            for t in u["topics"].values():
                if token_overlap(t["name"], src) < 0.6:
                    warnings.append(f"Dropped topic not found in the document: '{t['name']}'")
                    continue
                t["subtopics"] = [st for st in t["subtopics"] if token_overlap(st, src) >= 0.6]
                t["key_concepts"] = [k for k in t["key_concepts"] if token_overlap(k, src) >= 0.5]
                topics.append(t)
            if u["name"] != "General" and token_overlap(u["name"], src) < 0.5:
                warnings.append(f"Unit name '{u['name']}' not found verbatim; kept as a grouping only.")
            if topics:
                units.append({**u, "topics": topics})
        if units:
            if token_overlap(s["name"], src) < 0.5:
                warnings.append(f"Subject name '{s['name']}' is not stated clearly in the document — please check it.")
            subjects.append({**s, "units": units})
    return subjects, warnings


def _derive_importance(subjects: list[dict]) -> None:
    """High-weightage areas from stated marks only (never guessed)."""
    for s in subjects:
        unit_marks = [u["marks"] for u in s["units"] if u.get("marks")]
        avg = sum(unit_marks) / len(unit_marks) if unit_marks else None
        for u in s["units"]:
            u_imp = "high" if (avg and u.get("marks") and u["marks"] >= avg * 1.2) else "normal"
            for t in u["topics"]:
                t["importance"] = "high" if (u_imp == "high" or (t.get("marks") and avg and t["marks"] >= avg)) else "normal"
                t["difficulty"] = 3


_UNIT_MARKS = re.compile(r"\(?\s*(\d{1,3}(?:\.\d)?)\s*(?:marks?|m)\s*\)?", re.I)
_TOTAL = re.compile(r"(?:total|maximum|max\.?)\s*(?:marks)?\s*[:\-]?\s*(\d{2,4})\s*(?:marks)?", re.I)


def fill_marks_from_text(subjects: list[dict], source: str) -> None:
    """Deterministically read marks written next to a unit/topic heading
    (e.g. 'Unit 2: Capital Budgeting (25 marks)'). Never invents marks."""
    lines = [l.strip() for l in source.splitlines() if l.strip()]

    def marks_for(name: str) -> float | None:
        n = norm_name(re.sub(r"^(unit|module|chapter|part|section)\s*[\divx]+\s*[:.\-]?\s*", "", name, flags=re.I))
        if not n:
            return None
        for l in lines:
            if n in norm_name(l):
                m = _UNIT_MARKS.search(l)
                if m:
                    return float(m.group(1))
        return None

    total = _TOTAL.search(source)
    for s in subjects:
        if s.get("total_marks") is None and total and len(subjects) == 1:
            s["total_marks"] = float(total.group(1))
        for u in s["units"]:
            if u.get("marks") is None:
                u["marks"] = marks_for(u["name"])
            for t in u["topics"]:
                if t.get("marks") is None:
                    t["marks"] = marks_for(t["name"]) if len(t["name"]) > 12 else None


def find_exam_dates(text: str) -> list[str]:
    return sorted({m.group(1) for m in _DATE.finditer(text)})


async def analyze_text(text: str, tracker: Tracker) -> dict:
    if len(text.strip()) < 30:
        raise ValueError("The syllabus text is too short to analyse.")
    acc: dict = {}
    wins = _windows(text)
    notes = []
    for i, w in enumerate(wins, 1):
        tracker.step(f"Reading syllabus section {i} of {len(wins)}")
        x, _ = await ollama.chat_json(
            [{"role": "system", "content": BASE_RULES}, {"role": "user", "content": PROMPT + w}],
            XSyllabus, temperature=0.1,
        )
        _merge(acc, x)
        if x.marks_distribution_notes:
            notes.append(x.marks_distribution_notes)
    tracker.step("Verifying every extracted item against the document text")
    subjects, warnings = _ground(acc, text)
    fill_marks_from_text(subjects, text)
    _derive_importance(subjects)
    dates_in_text = find_exam_dates(text)
    if not subjects:
        warnings.append("No syllabus structure could be verified in this document.")
    if not dates_in_text:
        warnings.append("No exam date found in the document — set it on the exam profile.")
    return {"subjects": subjects, "exam_dates_in_text": dates_in_text,
            "marks_notes": " ".join(notes)[:1000] if _MARKS.search(text) else "", "warnings": warnings}


def document_text(db: Session, document_id: int, max_chars: int = 40000) -> str:
    rows = db.scalars(select(Chunk).where(Chunk.document_id == document_id).order_by(Chunk.idx)).all()
    # chunks overlap; de-duplicate paragraphs while preserving order
    seen, parts = set(), []
    for r in rows:
        for para in r.text.split("\n\n"):
            k = para.strip()
            if k and k not in seen:
                seen.add(k)
                parts.append(k)
    return "\n\n".join(parts)[:max_chars]


async def analyze_document(db: Session, profile_id: int, document_id: int, tracker: Tracker) -> SyllabusDraft:
    doc = db.get(Document, document_id)
    if not doc or doc.profile_id != profile_id:
        raise ValueError("Document not found in this exam profile")
    tracker.step(f"Analysing uploaded syllabus '{doc.display_name}'")
    text = document_text(db, document_id)
    if not text:
        raise ValueError("This document has no extracted text yet. Wait for processing to finish.")
    result = await analyze_text(text, tracker)
    draft = SyllabusDraft(profile_id=profile_id, document_id=document_id, data=result, warnings=result["warnings"])
    db.add(draft)
    db.commit()
    return draft


def apply_draft(db: Session, draft: SyllabusDraft, data: dict | None = None) -> dict:
    """Write (possibly user-edited) draft into Subjects/Topics, merging with existing items."""
    data = data or draft.data
    created = {"subjects": 0, "topics": 0}
    existing_subs = {norm_name(s.name): s for s in db.scalars(select(Subject).where(Subject.profile_id == draft.profile_id))}
    for si, s in enumerate(data.get("subjects", [])):
        key = norm_name(s["name"])
        sub = existing_subs.get(key)
        if not sub:
            sub = Subject(profile_id=draft.profile_id, name=s["name"][:160], total_marks=s.get("total_marks"), order=len(existing_subs) + si)
            db.add(sub)
            db.flush()
            existing_subs[key] = sub
            created["subjects"] += 1
        existing_topics = {norm_name(t.name): t for t in db.scalars(select(Topic).where(Topic.subject_id == sub.id))}
        order = len(existing_topics)
        for u in s.get("units", []):
            ukey = norm_name(u["name"])
            unit = existing_topics.get(ukey)
            if not unit:
                unit = Topic(subject_id=sub.id, profile_id=draft.profile_id, name=u["name"][:300], kind="unit", marks_weight=u.get("marks"), order=order)
                db.add(unit)
                db.flush()
                existing_topics[ukey] = unit
                order += 1
            for t in u.get("topics", []):
                tkey = norm_name(t["name"])
                if tkey in existing_topics:
                    continue
                n_sub = len(t.get("subtopics", []))
                topic = Topic(
                    subject_id=sub.id, profile_id=draft.profile_id, parent_id=unit.id, name=t["name"][:300], kind="topic",
                    marks_weight=t.get("marks"), importance=t.get("importance", "normal"), difficulty=int(t.get("difficulty", 3)),
                    key_concepts="; ".join(t.get("key_concepts", []) + t.get("subtopics", []))[:4000],
                    prerequisites="; ".join(t.get("prerequisites", []))[:2000],
                    est_hours=round(min(8.0, 1.5 + 0.5 * n_sub), 1), order=order,
                )
                db.add(topic)
                existing_topics[tkey] = topic
                order += 1
                created["topics"] += 1
    draft.status = "applied"
    draft.data = data
    db.commit()
    return created


def parse_date(s: str) -> date | None:
    from datetime import datetime

    s = s.strip().replace(",", "")
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%d %B %Y", "%d %b %Y"):
        try:
            return datetime.strptime(re.sub(r"(\d)(st|nd|rd|th)", r"\1", s), fmt).date()
        except ValueError:
            continue
    return None
