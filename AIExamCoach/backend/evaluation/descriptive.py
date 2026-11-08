"""Deterministic guards applied around the LLM's descriptive marking.

The LLM proposes marks against a rubric; these checks then:
* measure real keyword coverage in Python,
* detect keyword stuffing (keywords without explanatory sentences),
* cap marks for answers far shorter than the marks demand,
* clamp and round to half marks.
"""
from __future__ import annotations

import re

_SENT = re.compile(r"[.!?]+(?:\s|$)")
_VERBS = re.compile(r"\b(is|are|was|were|means|refers|helps|allows|because|therefore|which|that|leads|results|causes|shows|includes|involves|can|will|must|should|has|have)\b", re.I)


def keyword_coverage(answer: str, keywords: list[str]) -> dict:
    low = answer.lower()
    present, missing = [], []
    for k in keywords:
        k2 = k.strip()
        if not k2:
            continue
        variants = {k2.lower(), k2.lower().rstrip("s"), k2.lower().replace("-", " ")}
        (present if any(v and v in low for v in variants) else missing).append(k2)
    total = len(present) + len(missing)
    return {"present": present, "missing": missing, "ratio": round(len(present) / total, 2) if total else None}


def expected_words(max_marks: float) -> int:
    # Rough exam convention: ~25-30 words per mark for descriptive answers.
    return int(max(20, min(1200, max_marks * 28)))


def structure_signals(answer: str) -> dict:
    words = answer.split()
    sentences = [s for s in _SENT.split(answer) if len(s.split()) >= 4]
    verbs = len(_VERBS.findall(answer))
    lines = [l for l in answer.splitlines() if l.strip()]
    bullet_lines = sum(1 for l in lines if re.match(r"^\s*([-*•]|\d+[.)])\s+", l))
    short_fragment_lines = sum(1 for l in lines if len(l.split()) <= 3)
    return {"words": len(words), "sentences": len(sentences), "verb_density": round(verbs / max(1, len(words)), 3),
            "bullets": bullet_lines, "fragment_ratio": round(short_fragment_lines / max(1, len(lines)), 2),
            "paragraphs": answer.count("\n\n") + 1}


def is_keyword_stuffing(answer: str, keywords: list[str]) -> bool:
    sig = structure_signals(answer)
    cov = keyword_coverage(answer, keywords)
    if sig["words"] == 0:
        return False
    many_keywords = (cov["ratio"] or 0) >= 0.5
    no_explanation = sig["sentences"] <= 1 and (sig["verb_density"] < 0.03 or sig["fragment_ratio"] > 0.6)
    return many_keywords and no_explanation


def apply_guards(llm_marks: float, max_marks: float, answer: str, keywords: list[str]) -> dict:
    notes: list[str] = []
    marks = max(0.0, min(float(llm_marks), float(max_marks)))
    sig = structure_signals(answer)
    if sig["words"] < 3:
        return {"marks": 0.0, "notes": ["Answer is empty or too short to assess."], "signals": sig}
    if is_keyword_stuffing(answer, keywords):
        cap = round(max_marks * 0.3, 2)
        if marks > cap:
            notes.append("Keywords were listed without explanation, so marks are capped at 30%. Explain each concept in full sentences.")
            marks = cap
    exp = expected_words(max_marks)
    if max_marks >= 3 and sig["words"] < exp * 0.25:
        cap = round(max_marks * 0.5, 2)
        if marks > cap:
            notes.append(f"Answer is very brief for {max_marks:g} marks (~{exp} words expected), so marks are capped at 50%.")
            marks = cap
    marks = round(marks * 2) / 2  # half-mark granularity
    return {"marks": marks, "notes": notes, "signals": sig}
