"""Deterministic marking for objective questions (no LLM involved)."""
from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher
from typing import Any

from backend.evaluation.numeric import compare_numeric, parse_number

OBJECTIVE_TYPES = {"mcq", "msq", "true_false", "fill_blank", "assertion_reason", "numerical"}
DESCRIPTIVE_TYPES = {"short_answer", "long_answer", "case_study", "essay"}


def _norm(s: Any) -> str:
    s = unicodedata.normalize("NFKC", str(s)).lower().strip()
    s = re.sub(r"[^\w\s.%-]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _as_index_list(v: Any) -> list[int]:
    if v is None or v == "":
        return []
    if isinstance(v, (int, float)):
        return [int(v)]
    if isinstance(v, str):
        v = [x for x in re.split(r"[,\s]+", v) if x]
    out = []
    for x in v:
        if isinstance(x, str) and len(x) == 1 and x.isalpha():
            out.append(ord(x.upper()) - 65)
        else:
            try:
                out.append(int(x))
            except (TypeError, ValueError):
                continue
    return sorted(set(out))


def mark_objective(qtype: str, answer_key: dict, response: Any, marks: float, negative: float = 0.0) -> dict:
    """Return {"marks", "correct", "detail"}; ``response`` is what the student gave."""
    if response is None or response == "" or response == []:
        return {"marks": 0.0, "correct": False, "attempted": False, "detail": "Not attempted"}

    if qtype in ("mcq", "assertion_reason"):
        correct = _as_index_list(answer_key.get("correct"))
        given = _as_index_list(response)
        ok = len(given) == 1 and given == correct[:1]
        return {"marks": marks if ok else -abs(negative), "correct": ok, "attempted": True,
                "detail": "Correct" if ok else "Incorrect option"}

    if qtype == "msq":
        correct = set(_as_index_list(answer_key.get("correct")))
        given = set(_as_index_list(response))
        if given - correct:  # any wrong option selected → no credit (standard MSQ rule)
            return {"marks": 0.0, "correct": False, "attempted": True, "detail": "Included an incorrect option"}
        frac = len(given & correct) / len(correct) if correct else 0
        return {"marks": round(marks * frac, 2), "correct": frac == 1.0, "attempted": True,
                "detail": "All correct options selected" if frac == 1 else f"Partially correct ({len(given & correct)}/{len(correct)})"}

    if qtype == "true_false":
        key = answer_key.get("correct")
        key_b = key if isinstance(key, bool) else str(key).strip().lower() in ("true", "t", "1", "yes")
        resp_b = response if isinstance(response, bool) else str(response).strip().lower() in ("true", "t", "1", "yes")
        ok = key_b == resp_b
        return {"marks": marks if ok else -abs(negative), "correct": ok, "attempted": True, "detail": "Correct" if ok else "Incorrect"}

    if qtype == "fill_blank":
        accepted = answer_key.get("accepted") or [answer_key.get("correct", "")]
        r = _norm(response)
        best = 0.0
        for a in accepted:
            a_n = _norm(a)
            if not a_n:
                continue
            na, nr = parse_number(a_n), parse_number(r)
            if na is not None and nr is not None:
                best = max(best, 1.0 if compare_numeric(nr, na, 0.01)["match"] else 0.0)
            else:
                best = max(best, SequenceMatcher(None, a_n, r).ratio())
        ok = best >= 0.9  # tolerate small spelling slips only
        return {"marks": marks if ok else 0.0, "correct": ok, "attempted": True,
                "detail": "Correct" if ok else f"Expected: {accepted[0]}"}

    if qtype == "numerical":
        target = answer_key.get("value")
        tol = float(answer_key.get("tolerance_pct", 1.0))
        val = parse_number(str(response))
        if val is None or target is None:
            return {"marks": 0.0, "correct": False, "attempted": True, "detail": "Could not read a numeric answer"}
        cmp = compare_numeric(val, float(target), tol)
        return {"marks": marks if cmp["match"] else 0.0, "correct": cmp["match"], "attempted": True,
                "detail": f"Your value {val:g} vs expected {float(target):g} (tolerance {tol}%)"}

    raise ValueError(f"{qtype} is not an objective type")
