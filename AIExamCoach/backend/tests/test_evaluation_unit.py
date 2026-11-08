"""Objective marking, Python numeric verification and descriptive guards (no LLM)."""
import pytest

from backend.evaluation.descriptive import apply_guards, is_keyword_stuffing, keyword_coverage
from backend.evaluation.numeric import check_working, parse_number, safe_eval, verify_numerical
from backend.evaluation.objective import mark_objective


def test_mcq():
    assert mark_objective("mcq", {"correct": [2]}, 2, 1)["marks"] == 1
    assert mark_objective("mcq", {"correct": [2]}, "C", 1)["marks"] == 1
    assert mark_objective("mcq", {"correct": [2]}, 1, 1, negative=0.25)["marks"] == -0.25
    assert mark_objective("mcq", {"correct": [2]}, None, 1)["attempted"] is False


def test_msq_partial_and_wrong_option():
    key = {"correct": [0, 2, 3]}
    assert mark_objective("msq", key, [0, 2, 3], 3)["marks"] == 3
    assert mark_objective("msq", key, [0, 2], 3)["marks"] == 2
    assert mark_objective("msq", key, [0, 1], 3)["marks"] == 0  # any wrong option → 0


def test_true_false_and_fill_blank():
    assert mark_objective("true_false", {"correct": True}, "true", 1)["correct"]
    assert not mark_objective("true_false", {"correct": False}, True, 1)["correct"]
    key = {"correct": "Liquidity", "accepted": ["liquidity", "liquidity ratio"]}
    assert mark_objective("fill_blank", key, " Liquidity ", 1)["correct"]
    assert mark_objective("fill_blank", key, "liquidty", 1)["correct"]  # small slip tolerated
    assert not mark_objective("fill_blank", key, "profitability", 1)["correct"]


def test_numerical_tolerance():
    key = {"value": 1250.0, "tolerance_pct": 1}
    assert mark_objective("numerical", key, "₹1,250", 4)["marks"] == 4
    assert mark_objective("numerical", key, "1255", 4)["marks"] == 4
    assert mark_objective("numerical", key, "1300", 4)["marks"] == 0


def test_safe_eval_and_rejects_code():
    assert safe_eval("2500*12/100") == pytest.approx(300)
    assert safe_eval("(1+0.1)^2 * 1000") == pytest.approx(1210)
    assert safe_eval("20% * 500") == pytest.approx(100)
    for bad in ["__import__('os').system('x')", "open('f')", "a+b", "1;2"]:
        with pytest.raises(Exception):
            safe_eval(bad)


def test_parse_number():
    assert parse_number("Answer: Rs. 12,500.50") == 12500.5
    assert parse_number("no number") is None


def test_check_working_finds_arithmetic_errors():
    steps = check_working("Interest = 2500 * 12 / 100 = 300\nTotal = 2500 + 300 = 2900")
    assert steps[0]["correct"] is True
    assert steps[1]["correct"] is False and steps[1]["computed"] == 2800


def test_verify_numerical_uses_python_not_model():
    r = verify_numerical("SI = P*R*T/100 = 5000*8*3/100 = 1200\nAnswer: 1200", expected=None, expression="5000*8*3/100")
    assert r["match"] and r["expected"] == 1200 and not r["arithmetic_errors"]
    r2 = verify_numerical("Answer = 1300", expected=1200)
    assert not r2["match"]


def test_keyword_stuffing_is_capped():
    kws = ["working capital", "current assets", "current liabilities", "liquidity", "operating cycle"]
    stuffed = "working capital\ncurrent assets\ncurrent liabilities\nliquidity\noperating cycle"
    assert is_keyword_stuffing(stuffed, kws)
    g = apply_guards(10, 10, stuffed, kws)
    assert g["marks"] <= 3 and g["notes"]
    good = ("Working capital is the difference between current assets and current liabilities. It measures liquidity, because it shows "
            "whether a firm can meet short-term obligations. The operating cycle determines how much working capital is needed, since "
            "cash is tied up in inventory and receivables until customers pay. ") * 6
    assert not is_keyword_stuffing(good, kws)
    assert apply_guards(8, 10, good, kws)["marks"] == 8


def test_length_cap_and_clamp():
    assert apply_guards(15, 10, "Working capital is current assets minus current liabilities.", [])["marks"] <= 5
    assert apply_guards(-3, 10, "x y z w " * 100, [])["marks"] == 0
    assert apply_guards(7.3, 10, "This is a reasonably long answer that explains things. " * 30, [])["marks"] == 7.5


def test_keyword_coverage():
    c = keyword_coverage("Liquidity and solvency matter.", ["liquidity", "solvency", "leverage"])
    assert c["present"] == ["liquidity", "solvency"] and c["missing"] == ["leverage"]
