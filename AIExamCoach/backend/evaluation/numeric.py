"""Python-verified numerical checking. The LLM never decides whether a number
is right: expressions are evaluated with a restricted SymPy parser (no
arbitrary code execution) and compared with a tolerance."""
from __future__ import annotations

import re
from typing import Any

from sympy import Float, N
from sympy.parsing.sympy_parser import parse_expr, standard_transformations

_NUM = re.compile(r"[-+]?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?(?:[eE][-+]?\d+)?")
_ALLOWED_EXPR = re.compile(r"^[0-9+\-*/().%^ eE,]+$")
_MAX_LEN = 200


def parse_number(s: str | None) -> float | None:
    if s is None:
        return None
    s = str(s).replace("₹", "").replace("$", "").replace("Rs.", "").replace("Rs", "")
    m = _NUM.findall(s)
    if not m:
        return None
    raw = m[-1].replace(",", "")
    try:
        v = float(raw)
    except ValueError:
        return None
    if "%" in s[s.rfind(m[-1]):s.rfind(m[-1]) + len(m[-1]) + 2]:
        return v  # keep percentage as given (e.g. 12.5 for 12.5%)
    return v


def safe_eval(expr: str) -> float:
    """Evaluate a purely arithmetic expression safely."""
    e = expr.strip().replace("×", "*").replace("÷", "/").replace("^", "**").replace(",", "")
    if len(e) > _MAX_LEN or not _ALLOWED_EXPR.match(e.replace("**", "^")):
        raise ValueError("Expression contains disallowed characters")
    e = re.sub(r"(\d+(?:\.\d+)?)%", r"(\1/100)", e)
    val = parse_expr(e, transformations=standard_transformations, evaluate=True, local_dict={}, global_dict={"Float": Float, "Integer": __import__("sympy").Integer})
    return float(N(val))


def compare_numeric(given: float, expected: float, tolerance_pct: float = 1.0) -> dict:
    if expected == 0:
        ok = abs(given) <= 1e-9 + tolerance_pct / 100
    else:
        ok = abs(given - expected) / abs(expected) * 100 <= tolerance_pct
    return {"match": bool(ok), "given": given, "expected": expected, "tolerance_pct": tolerance_pct}


_ARITH = re.compile(r"^[0-9+\-*/().%^ ×÷,]+$")


def check_working(text: str, max_steps: int = 30) -> list[dict]:
    """Find steps like ``2500 * 12 / 100 = 300`` (including chained
    ``SI = 5000*8*3/100 = 1200``) and verify each arithmetic step."""
    out = []
    for line in text.splitlines():
        parts = [p.strip() for p in line.split("=")]
        for lhs, rhs in zip(parts, parts[1:]):
            m = re.match(r"^([-+]?[0-9][0-9,]*(?:\.\d+)?)", rhs)
            if not m or not _ARITH.match(lhs) or not re.search(r"[+\-*/×÷^%]", lhs.lstrip("-+")):
                continue
            try:
                val = safe_eval(lhs)
                claimed = float(m.group(1).replace(",", ""))
            except Exception:  # noqa: BLE001
                continue
            ok = compare_numeric(claimed, val, 0.5)["match"]
            out.append({"step": f"{lhs} = {m.group(1)}", "correct": ok, "computed": round(val, 6)})
            if len(out) >= max_steps:
                return out
    return out


def verify_numerical(student_text: str, expected: Any, expression: str | None = None, tolerance_pct: float = 1.0) -> dict:
    """Determine the true answer (from the stored value, or by evaluating the
    reference expression) and compare with the student's final number."""
    truth = None
    source = "answer key"
    if expression:
        try:
            truth = safe_eval(expression)
            source = f"computed from {expression}"
        except Exception:  # noqa: BLE001
            truth = None
    if truth is None and expected is not None:
        truth = float(expected)
    final = None
    m = re.search(r"(?:answer|ans|result|=)\s*[:=]?\s*([^\n]*)$", student_text.strip(), re.I)
    final = parse_number(m.group(1)) if m else None
    if final is None:
        final = parse_number(student_text)
    steps = check_working(student_text)
    res: dict = {"expected": truth, "expected_source": source, "student_final": final, "steps": steps,
                 "arithmetic_errors": [s for s in steps if not s["correct"]]}
    if truth is not None and final is not None:
        res.update(compare_numeric(final, truth, tolerance_pct))
    else:
        res["match"] = False
    return res
