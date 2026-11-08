"""End-to-end tests against the REAL local Ollama (qwen3:4b + embeddinggemma).

Run:  python -m pytest -m ollama -v
These are slow on CPU-only machines (each LLM call can take 20-120 s)."""
from datetime import date, timedelta

import pytest

from backend.tests.conftest import requires_ollama, wait_task
from backend.tests.test_documents_unit import make_pdf

pytestmark = [pytest.mark.ollama, requires_ollama]

SYLLABUS = """MBA Semester II - Financial Management (FM201)   Total: 100 marks
Unit 1: Introduction to Financial Management (15 marks)
Objectives of financial management, wealth maximisation, profit maximisation, role of finance manager.
Unit 2: Capital Budgeting (25 marks)
Net present value, internal rate of return, payback period, profitability index.
Unit 3: Working Capital Management (30 marks)
Operating cycle, cash management, receivables management, inventory management.
Unit 4: Cost of Capital (30 marks)
Cost of debt, cost of equity, weighted average cost of capital.
Examination date: 15/03/2027"""

TEXTBOOK_P1 = "Chapter 1 Overview\nFinance is the study of money management.\nIt covers investing and financing."
TEXTBOOK_P2 = ("Chapter 7 Working Capital\nWorking capital is the difference between current assets and current liabilities.\n"
               "The operating cycle is the time between purchasing inventory and collecting cash from customers.\n"
               "A longer operating cycle requires more working capital.")


@pytest.fixture(scope="module")
def pid(api):
    return api.post("/api/profiles", json={"name": "Integration MBA", "exam_type": "mba", "daily_hours": 2,
                                           "exam_date": (date.today() + timedelta(days=30)).isoformat(),
                                           "study_days": [0, 1, 2, 3, 4, 5, 6]}).json()["id"]


def _wait_doc(api, pid, doc_id, timeout=600):
    import time

    t0 = time.time()
    while time.time() - t0 < timeout:
        d = next(x for x in api.get(f"/api/profiles/{pid}/documents").json() if x["id"] == doc_id)
        if d["status"] not in ("queued", "processing"):
            return d
        time.sleep(1)
    raise TimeoutError


def test_01_ollama_detection_and_models(api):
    o = api.get("/api/models").json()
    assert o["available"] and o["ollama_version"]
    names = [m["name"] for m in o["installed"]]
    assert any(n.startswith("qwen3:4b") for n in names) and any(n.startswith("embeddinggemma") for n in names)
    assert o["missing_required"] == []


def test_02_qwen_inference_and_placement(api):
    r = api.post("/api/models/test", json={"kind": "chat"}).json()
    assert "working" in r["reply"].lower()
    assert "<think>" not in r["reply"]  # reasoning never leaks into replies
    assert r["placement"]["processor"] in ("GPU", "CPU") or "GPU" in r["placement"]["processor"]
    print("placement:", r["placement"], "tok/s:", r["tokens_per_sec"])


def test_03_embedding(api):
    r = api.post("/api/models/test", json={"kind": "embedding"}).json()
    assert r["dimensions"] == 768


def test_04_upload_index_retrieve_with_real_citation(api, pid, tmp_path):
    pdf = make_pdf(tmp_path / "fm_textbook.pdf", [TEXTBOOK_P1, TEXTBOOK_P2])
    with open(pdf, "rb") as f:
        d = api.post(f"/api/profiles/{pid}/documents", files={"file": ("fm_textbook.pdf", f, "application/pdf")}, data={"category": "textbook"}).json()
    d = _wait_doc(api, pid, d["id"])
    assert d["status"] == "indexed", d["error"]
    assert d["pages"] == 2 and d["chunk_count"] >= 2
    hits = api.get(f"/api/profiles/{pid}/documents-search", params={"q": "what is the operating cycle"}).json()
    assert hits and hits[0]["filename"] == "fm_textbook.pdf" and hits[0]["page"] == 2


def test_05_syllabus_extraction_grounded(api, pid, tmp_path):
    pdf = make_pdf(tmp_path / "syllabus.pdf", [SYLLABUS])
    with open(pdf, "rb") as f:
        d = api.post(f"/api/profiles/{pid}/documents", files={"file": ("FM syllabus.pdf", f, "application/pdf")}, data={"category": "syllabus"}).json()
    assert _wait_doc(api, pid, d["id"])["status"] == "indexed"
    tid = api.post(f"/api/profiles/{pid}/syllabus/analyze/{d['id']}").json()["task_id"]
    t = wait_task(api, tid, 1800)
    assert t["status"] == "completed", t["error"]
    draft = api.get(f"/api/profiles/{pid}/syllabus/drafts").json()[0]
    subs = draft["data"]["subjects"]
    assert subs
    topics = [tp["name"].lower() for s in subs for u in s["units"] for tp in u["topics"]]
    units = [u["name"].lower() for s in subs for u in s["units"]]
    joined = " ".join(topics + units)
    for expected in ("capital budgeting", "working capital", "cost of capital"):
        assert expected in joined, (expected, joined)
    src = SYLLABUS.lower()
    from backend.agents.common import norm_name, token_overlap

    assert all(token_overlap(t, norm_name(src)) >= 0.6 for t in topics), "no hallucinated topics"
    assert "15/03/2027" in draft["data"]["exam_dates_in_text"]
    created = api.post(f"/api/profiles/{pid}/syllabus/drafts/{draft['id']}/apply", json={}).json()
    assert created["topics"] >= 4


def test_06_chat_orchestrator_creates_plan(api, pid):
    th = api.post("/api/chat/threads", json={"profile_id": pid}).json()["id"]
    r = api.post(f"/api/chat/threads/{th}/messages", json={"content": "Create a 20-day study plan for my MBA examination"}).json()
    t = wait_task(api, r["task_id"], 600)
    assert t["status"] == "completed", t["error"]
    assert any(c["agent"] == "planner" for c in t["children"])
    msgs = api.get(f"/api/chat/threads/{th}/messages").json()["messages"]
    assert msgs[-1]["role"] == "assistant" and msgs[-1]["agent"] == "planner"
    plan = api.get(f"/api/profiles/{pid}/plans/active").json()
    assert plan and plan["sessions"]
    last = max(date.fromisoformat(s["day"]) for s in plan["sessions"])
    assert last <= date.today() + timedelta(days=19)


def test_07_question_generation_validated(api, pid):
    tid = api.post(f"/api/profiles/{pid}/questions/generate", json={"qtype": "mcq", "count": 3, "difficulty": "medium"}).json()["task_id"]
    t = wait_task(api, tid, 1200)
    assert t["status"] == "completed", t["error"]
    qs = api.get(f"/api/profiles/{pid}/questions", params={"qtype": "mcq"}).json()
    assert len(qs) >= 2
    for q in qs:
        assert len(q["options"]) >= 3 and len(q["answer"]["correct"]) == 1 and q["answer"]["correct"][0] < len(q["options"])
        for c in q["citations"]:  # citations only point at real chunks
            assert c["filename"] in ("fm_textbook.pdf", "FM syllabus.pdf")


def test_08_numerical_question_python_verified(api, pid):
    tid = api.post(f"/api/profiles/{pid}/questions/generate", json={"qtype": "numerical", "count": 1}).json()["task_id"]
    t = wait_task(api, tid, 1200)
    assert t["status"] == "completed", t["error"]
    from backend.evaluation.numeric import safe_eval

    for q in api.get(f"/api/profiles/{pid}/questions", params={"qtype": "numerical"}).json():
        assert q["answer"]["value"] == pytest.approx(safe_eval(q["answer"]["expression"]), rel=1e-6)


GOOD = ("Working capital is the difference between a firm's current assets and its current liabilities. It indicates short-term "
        "liquidity, because it shows whether the business can pay obligations that fall due within a year. Current assets include "
        "cash, receivables and inventory, while current liabilities include creditors and short-term loans. The operating cycle "
        "affects how much working capital is required: a longer cycle means cash is tied up for longer in inventory and receivables, "
        "so more working capital is needed. For example, a manufacturer that gives customers 90 days of credit needs more working "
        "capital than a retailer selling for cash. Good working capital management balances liquidity against profitability.")
STUFFED = "working capital\ncurrent assets\ncurrent liabilities\nliquidity\noperating cycle\ninventory\nreceivables"


def _evaluate(api, pid, answer):
    tid = api.post(f"/api/profiles/{pid}/evaluations", json={"question_text": "Explain the concept of working capital and the factors affecting it.",
                                                            "max_marks": 5, "answer_text": answer, "qtype": "short_answer"}).json()["task_id"]
    t = wait_task(api, tid, 900)
    assert t["status"] == "completed", t["error"]
    return api.get(f"/api/profiles/{pid}/evaluations/{t['result_ref']['evaluation_id']}").json()


def test_09_descriptive_evaluation_and_keyword_stuffing(api, pid):
    good = _evaluate(api, pid, GOOD)
    bad = _evaluate(api, pid, STUFFED)
    r = good["result"]
    for k in ("marks_awarded", "max_marks", "percentage", "what_was_correct", "what_was_missing", "what_was_incorrect", "missing_keywords",
              "how_to_improve", "model_answer", "expected_answer_explanation"):
        assert k in r
    assert 0 <= good["marks_awarded"] <= 5 and good["marks_awarded"] * 2 == int(good["marks_awarded"] * 2)
    assert bad["marks_awarded"] <= 1.5, "keyword list must not earn high marks"
    assert good["marks_awarded"] > bad["marks_awarded"]
    print("good:", good["marks_awarded"], "stuffed:", bad["marks_awarded"])


def test_10_numerical_evaluation_python_check(api, pid):
    tid = api.post(f"/api/profiles/{pid}/evaluations", json={
        "question_text": "Calculate simple interest on Rs 5000 at 8% per annum for 3 years.", "max_marks": 4, "qtype": "numerical",
        "answer_text": "SI = P x R x T / 100\nSI = 5000*8*3/100 = 1300\nAnswer: 1300", "expression": "5000*8*3/100"}).json()["task_id"]
    t = wait_task(api, tid, 900)
    assert t["status"] == "completed", t["error"]
    e = api.get(f"/api/profiles/{pid}/evaluations/{t['result_ref']['evaluation_id']}").json()
    pv = e["result"]["python_verification"]
    assert pv["expected"] == 1200 and pv["match"] is False and pv["arithmetic_errors"]
    assert e["marks_awarded"] <= 2


def test_11_chat_document_answer_with_citation(api, pid):
    th = api.post("/api/chat/threads", json={"profile_id": pid}).json()["id"]
    r = api.post(f"/api/chat/threads/{th}/messages", json={"content": "According to my textbook, how does the operating cycle affect working capital?"}).json()
    t = wait_task(api, r["task_id"], 600)
    assert t["status"] == "completed", t["error"]
    m = api.get(f"/api/chat/threads/{th}/messages").json()["messages"][-1]
    assert m["citations"], "a document question must be answered with a real citation"
    for c in m["citations"]:
        assert c["filename"] == "fm_textbook.pdf" and c["page"] == 2
    print("answer:", m["content"][:300], m["citations"])


def test_12_readiness_via_chat(api, pid):
    th = api.post("/api/chat/threads", json={"profile_id": pid}).json()["id"]
    r = api.post(f"/api/chat/threads/{th}/messages", json={"content": "Tell me whether I am ready to achieve 75%."}).json()
    t = wait_task(api, r["task_id"], 120)
    assert t["status"] == "completed"
    m = api.get(f"/api/chat/threads/{th}/messages").json()["messages"][-1]
    assert m["agent"] == "analyst" and "not a prediction" in m["content"]


def test_13_cancel_long_task(api, pid):
    tid = api.post(f"/api/profiles/{pid}/questions/generate", json={"qtype": "long_answer", "count": 3}).json()["task_id"]
    import time

    time.sleep(3)
    assert api.post(f"/api/agents/tasks/{tid}/cancel").json()["cancelled"]
    t = wait_task(api, tid, 60)
    assert t["status"] == "cancelled"
