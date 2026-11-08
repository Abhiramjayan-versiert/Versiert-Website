"""Agent 1 — Master Orchestrator.

Understands the request (fast rules first, then an LLM classifier for
ambiguous messages), delegates to specialised agents through the tool
registry, verifies the outputs, keeps conversation context and records a
concise activity log. Reasoning is never exposed — only task summaries."""
from __future__ import annotations

import asyncio
import re
from datetime import date
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import func, select

from backend.agents import analyst, revision, tools as _tools  # noqa: F401  (registers tools)
from backend.agents.common import BASE_RULES, LEVELS, find_subject, find_topic, profile_brief
from backend.agents.evaluator import evaluate_descriptive, evaluate_numerical
from backend.agents.runtime import AGENT_NAMES, ApprovalRequired, TaskCancelled, Tracker, registry
from backend.database.session import SessionLocal
from backend.models.entities import (
    ChatMessage, ChatThread, Document, Evaluation, ExamProfile, MockExam, MockExamItem, QuestionAttempt, StudyPlan, StudySession, Topic, utcnow,
)
from backend.rag.retrieve import format_context, retrieve
from backend.services import ollama

Intent = Literal["teach", "followup", "plan", "reschedule", "analyze_syllabus", "generate_questions", "mock_exam", "evaluate_answer",
                 "explain_loss", "revise", "readiness", "analytics", "doc_qa", "general"]

RULES: list[tuple[str, re.Pattern]] = [
    ("reschedule", re.compile(r"\b(reschedul|missed (my|a|the)? ?(study )?session|recalculate)", re.I)),
    ("explain_loss", re.compile(r"\bwhy (did )?i (lose|lost|get|got) (marks|less|low)|explain why i lost|where did i lose", re.I)),
    ("evaluate_answer", re.compile(r"\b(evaluate|mark|grade|check|assess|score) (my|this) (answer|response|essay)", re.I)),
    ("readiness", re.compile(r"\b(am i ready|ready (to|for)|readiness|on track|reach (the )?\d+ ?%|achieve \d+ ?%|\b75 ?%)", re.I)),
    ("analyze_syllabus", re.compile(r"\b(analy[sz]e|extract|read|process|break down)\b.*\bsyllabus|syllabus.*\b(priority|high-priority|topics)", re.I)),
    ("plan", re.compile(r"\b(study|revision|exam)?\s*(plan|schedule|timetable)\b", re.I)),
    ("mock_exam", re.compile(r"\b(mock|question paper|test paper|practice paper|model paper|sample paper)\b", re.I)),
    ("generate_questions", re.compile(r"\b(generate|create|make|give me|write)\b.*\b(questions|mcqs?|quiz|problems)\b", re.I)),
    ("revise", re.compile(r"\b(revise|revision|flashcards?|got wrong|my mistakes|spaced repetition)\b", re.I)),
    ("analytics", re.compile(r"\b(performance|weak (subjects?|topics?|areas?)|strong (subjects?|topics?)|my progress|my scores|analy[sz]e my)\b", re.I)),
    ("doc_qa", re.compile(r"\b(according to|as per|based on|from|in) (my|the) (textbook|notes|documents?|pdf|book|uploaded|material|slides)\b", re.I)),
    ("teach", re.compile(r"^\s*(teach|explain|what is|what are|describe|lesson|help me (understand|learn)|tell me about|define)\b", re.I)),
]
QTYPE_WORDS = [("mcq", r"mcqs?|multiple choice"), ("msq", r"multiple[- ]select|msq"), ("true_false", r"true[/ ]?false"),
               ("fill_blank", r"fill in the blanks?|fill[- ]ups?"), ("numerical", r"numerical|calculation|problems"),
               ("case_study", r"case stud"), ("assertion_reason", r"assertion"), ("essay", r"essay"),
               ("long_answer", r"long[- ]answer"), ("short_answer", r"short[- ]answer")]


class Route(BaseModel):
    intent: Intent
    topic: str = ""


def _num(pattern: str, text: str) -> float | None:
    m = re.search(pattern, text, re.I)
    return float(m.group(1)) if m else None


def _level(text: str, profile: ExamProfile) -> str:
    t = text.lower()
    for key, words in (("beginner", "basics|beginner|from scratch|simple"), ("advanced", "advanced|in depth|in-depth"),
                       ("short", "short answer|briefly|short note"), ("long", "long answer|in detail|10[- ]mark|15[- ]mark"),
                       ("ssc", r"\bssc\b"), ("mba", r"\bmba\b")):
        if re.search(words, t):
            return key
    return {"mba": "mba", "ssc": "ssc"}.get(profile.exam_type, "intermediate")


def _topic_from(text: str) -> str:
    t = re.sub(r"^\s*(please\s+)?(teach me|explain( to me)?|what (is|are)|describe|tell me about|help me (understand|learn)|define|give me a lesson on|lesson on)\s*", "", text, flags=re.I)
    t = re.sub(r"\b(from (the )?(basics|scratch)|in detail|briefly|for (my )?(mba|ssc)( exam(ination)?)?|at (an? )?\w+ level)\b", "", t, flags=re.I)
    return t.strip(" ?.!") or text.strip()


async def classify(text: str, has_lesson: bool) -> Route:
    for intent, rx in RULES:
        if rx.search(text):
            return Route(intent=intent, topic=_topic_from(text) if intent == "teach" else "")
    if has_lesson and len(text.split()) <= 40:
        return Route(intent="followup")
    try:
        r, _ = await ollama.chat_json([{"role": "system", "content": "Classify the student's request for an exam-coaching app. Return JSON."},
                                       {"role": "user", "content": f"Request: {text}\nIntents: teach (explain a topic), plan, analyze_syllabus, "
                                        "generate_questions, mock_exam, evaluate_answer, explain_loss, revise, readiness, analytics, "
                                        "doc_qa (question about uploaded documents), general."}], Route, temperature=0.0, retries=0)
        return r
    except Exception:  # noqa: BLE001
        return Route(intent="doc_qa")


# ------------------------------------------------------------------ public entry
async def handle_message(thread_id: int, task_id_holder: dict, text: str, profile_id: int | None, subject_id: int | None = None,
                         attachment_document_id: int | None = None, level: str | None = None) -> None:
    root = Tracker("orchestrator", "Understanding your request", profile_id)
    task_id_holder["id"] = root.id
    reply: dict = {"content": "", "agent": "orchestrator", "citations": [], "actions": []}
    try:
        with SessionLocal() as db:
            thread = db.get(ChatThread, thread_id)
            profile = db.get(ExamProfile, profile_id) if profile_id else None
            history = [{"role": m.role, "content": m.content[:1500]} for m in db.scalars(
                select(ChatMessage).where(ChatMessage.thread_id == thread_id).order_by(ChatMessage.id.desc()).limit(8))][::-1][:-1]
            ctx = dict(thread.context or {})
        if not profile:
            reply["content"] = "Please create or select an examination profile first (My Examinations), so I keep your data separate per exam."
            root.finish()
            return
        route = await classify(text, bool(ctx.get("lesson")))
        root.step(f"Routing to {AGENT_NAMES.get(_agent_for(route.intent), 'Orchestrator')}: {route.intent.replace('_', ' ')}")
        handler = HANDLERS.get(route.intent, h_doc_qa)
        reply = await handler(root, profile, text, route, ctx, history, subject_id, attachment_document_id, level)
        root.step("Verified results and saved them to your profile")
        root.finish(result_ref={"intent": route.intent})
        if "context" in reply:
            with SessionLocal() as db:
                t = db.get(ChatThread, thread_id)
                t.context = reply.pop("context")
                db.commit()
    except TaskCancelled:
        reply = {"content": "Task cancelled.", "agent": "orchestrator", "citations": [], "actions": []}
        root.finish("cancelled")
    except asyncio.CancelledError:
        reply = {"content": "Task cancelled.", "agent": "orchestrator", "citations": [], "actions": []}
        root.finish("cancelled", "Cancelled by user")
    except ApprovalRequired as a:
        reply = {"content": f"This action needs your approval: **{a.action}**. Approve or reject it on the Agent Activity page.",
                 "agent": "orchestrator", "citations": [], "actions": [{"label": "Review approval", "href": "/agents/"}]}
    except ollama.OllamaUnavailable as e:
        reply = {"content": f"**Local AI is offline.** {e}\n\nStart Ollama on the Windows PC (Start menu → Ollama, or `scripts\\start.ps1`), "
                            "then try again. No cloud model is used as a fallback.", "agent": "orchestrator", "citations": [], "actions": [{"label": "Model Manager", "href": "/models/"}]}
        root.finish("failed", str(e))
    except ollama.QueueFull as e:
        reply = {"content": str(e), "agent": "orchestrator", "citations": [], "actions": []}
        root.finish("failed", str(e))
    except Exception as e:  # noqa: BLE001
        reply = {"content": f"Sorry — that task failed: {e}", "agent": "orchestrator", "citations": [], "actions": []}
        root.finish("failed", repr(e))
    finally:
        with SessionLocal() as db:
            db.add(ChatMessage(thread_id=thread_id, role="assistant", content=reply.get("content", ""), agent=reply.get("agent", "orchestrator"),
                               citations=reply.get("citations", []), actions=reply.get("actions", []), task_id=root.id))
            t = db.get(ChatThread, thread_id)
            if t:
                t.updated_at = utcnow()
            db.commit()


def _agent_for(intent: str) -> str:
    return {"teach": "tutor", "followup": "tutor", "plan": "planner", "reschedule": "planner", "analyze_syllabus": "syllabus",
            "generate_questions": "questions", "mock_exam": "questions", "evaluate_answer": "evaluator", "explain_loss": "evaluator",
            "revise": "revision", "readiness": "analyst", "analytics": "analyst"}.get(intent, "orchestrator")


# ------------------------------------------------------------------ handlers
async def h_teach(root, profile, text, route, ctx, history, subject_id, att, level):
    topic_text = route.topic or _topic_from(text)
    lvl = level or _level(text, profile)
    with SessionLocal() as db:
        topic = find_topic(db, profile.id, topic_text)
    child = root.child("tutor", f"Teaching '{topic_text}' ({lvl})")
    try:
        res = await registry.call(child, "teach_lesson", {"profile_id": profile.id, "topic": topic_text, "level": lvl, "topic_id": topic.id if topic else None}, tracker=child)
        child.finish()
    except BaseException as e:
        child.finish("failed", str(e))
        raise
    lesson_ctx = {"topic": topic_text, "level": lvl, "summary": res["core"]["simple_explanation"][:900], "topic_id": res["topic_id"]}
    return {"content": res["markdown"], "agent": "tutor", "citations": res["citations"], "actions": [],
            "context": {"lesson": lesson_ctx}}


async def h_followup(root, profile, text, route, ctx, history, subject_id, att, level):
    from backend.agents import tutor

    child = root.child("tutor", "Answering a follow-up question")
    with SessionLocal() as db:
        res = await tutor.followup(db, profile, child, text, ctx.get("lesson", {}), history)
    child.finish()
    return {"content": res["markdown"], "agent": "tutor", "citations": res["citations"], "actions": []}


async def _ensure_syllabus(root, profile) -> list[str]:
    """If no topics exist but a syllabus document does, run the analyst first."""
    notes = []
    with SessionLocal() as db:
        n_topics = db.scalar(select(func.count(Topic.id)).where(Topic.profile_id == profile.id, Topic.kind != "unit")) or 0
        doc = db.scalar(select(Document).where(Document.profile_id == profile.id, Document.category == "syllabus",
                                               Document.status.in_(["indexed", "extracted"])).order_by(Document.uploaded_at.desc()))
    if n_topics or not doc:
        return notes
    child = root.child("syllabus", f"Analysing uploaded syllabus '{doc.display_name}'")
    draft = await registry.call(child, "analyze_syllabus", {"profile_id": profile.id, "document_id": doc.id}, tracker=child)
    with SessionLocal() as db:
        from backend.agents.syllabus import apply_draft
        from backend.models.entities import SyllabusDraft

        d = db.get(SyllabusDraft, draft.id)
        created = apply_draft(db, d)
    child.finish(result_ref={"draft_id": draft.id})
    notes.append(f"I analysed **{doc.display_name}** and added {created['subjects']} subject(s) and {created['topics']} topic(s). "
                 "You can edit them on the Syllabus page.")
    return notes


async def h_plan(root, profile, text, route, ctx, history, subject_id, att, level):
    notes = await _ensure_syllabus(root, profile)
    days = _num(r"(\d+)[- ]?(?:day|days)\b", text)
    weeks = _num(r"(\d+)[- ]?(?:week|weeks)\b", text)
    hours = _num(r"(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:a|per|each)?\s*day", text)
    if weeks and not days:
        days = weeks * 7
    child = root.child("planner", "Creating a realistic study schedule")
    try:
        plan = await registry.call(child, "create_study_plan", {"profile_id": profile.id, "days": int(days) if days else None, "daily_hours": hours}, tracker=child)
    except ValueError as e:
        child.finish("failed", str(e))
        return {"content": "\n\n".join(notes + [f"I couldn't create the plan: {e}"]), "agent": "planner", "citations": [],
                "actions": [{"label": "Open Syllabus", "href": "/syllabus/"}, {"label": "Edit exam profile", "href": "/exams/"}]}
    with SessionLocal() as db:
        n = db.scalar(select(func.count(StudySession.id)).where(StudySession.plan_id == plan.id)) or 0
        first = db.scalars(select(StudySession).where(StudySession.plan_id == plan.id).order_by(StudySession.day, StudySession.slot).limit(6)).all()
    if n == 0:  # verification
        child.finish("failed", "plan has no sessions")
        return {"content": "The planner produced no sessions — check study days and the exam date.", "agent": "planner", "citations": [], "actions": []}
    child.finish(result_ref={"plan_id": plan.id})
    lines = notes + [f"**{plan.title}** is saved and active.", plan.summary]
    if plan.warnings:
        lines.append("**Notes:** " + " ".join(plan.warnings))
    lines.append("**First sessions:**\n" + "\n".join(f"- {s.day.strftime('%a %d %b')}: {s.title} ({s.minutes} min)" for s in first))
    return {"content": "\n\n".join(lines), "agent": "planner", "citations": [], "actions": [{"label": "Open Study Planner", "href": "/planner/"}]}


async def h_reschedule(root, profile, text, route, ctx, history, subject_id, att, level):
    child = root.child("planner", "Recalculating your remaining schedule")
    try:
        plan = await registry.call(child, "reschedule_plan", {"profile_id": profile.id}, tracker=child)
    except ValueError as e:
        child.finish("failed", str(e))
        return {"content": f"I couldn't reschedule: {e}", "agent": "planner", "citations": [], "actions": []}
    child.finish(result_ref={"plan_id": plan.id})
    return {"content": f"Done. {' '.join(plan.warnings)}\n\n{plan.summary}", "agent": "planner", "citations": [],
            "actions": [{"label": "Open Study Planner", "href": "/planner/"}]}


async def h_syllabus(root, profile, text, route, ctx, history, subject_id, att, level):
    with SessionLocal() as db:
        doc = db.get(Document, att) if att else db.scalar(select(Document).where(
            Document.profile_id == profile.id, Document.category == "syllabus").order_by(Document.uploaded_at.desc()))
    if not doc:
        return {"content": "Upload your syllabus first (attach it here or use the Document Library with category **Syllabus**).",
                "agent": "syllabus", "citations": [], "actions": [{"label": "Document Library", "href": "/documents/"}]}
    if doc.status in ("queued", "processing"):
        return {"content": f"'{doc.display_name}' is still being processed. Try again in a moment.", "agent": "syllabus", "citations": [], "actions": []}
    child = root.child("syllabus", f"Analysing uploaded syllabus '{doc.display_name}'")
    draft = await registry.call(child, "analyze_syllabus", {"profile_id": profile.id, "document_id": doc.id}, tracker=child)
    child.finish(result_ref={"draft_id": draft.id})
    subs = draft.data.get("subjects", [])
    n_topics = sum(len(u["topics"]) for s in subs for u in s["units"])
    high = [t["name"] for s in subs for u in s["units"] for t in u["topics"] if t.get("importance") == "high"]
    lines = [f"I extracted **{len(subs)} subject(s)** and **{n_topics} topics** from *{doc.display_name}*. Every item was checked against the document text."]
    for s in subs[:6]:
        lines.append(f"- **{s['name']}**" + (f" ({s['total_marks']:g} marks)" if s.get("total_marks") else "") + ": " +
                     ", ".join(u["name"] for u in s["units"][:8]))
    lines.append("**High-weightage topics (based on stated marks):** " + (", ".join(high[:10]) if high else
                 "the document does not state marks per unit, so I did not guess any weightage."))
    if draft.warnings:
        lines.append("**Checks:** " + " ".join(draft.warnings[:6]))
    lines.append("Review and edit the draft, then click **Apply** on the Syllabus page.")
    return {"content": "\n\n".join(lines), "agent": "syllabus", "citations": [{"document_id": doc.id, "filename": doc.display_name, "page": None, "section": "whole document"}],
            "actions": [{"label": "Review syllabus draft", "href": f"/syllabus/?draft={draft.id}"}]}


async def h_questions(root, profile, text, route, ctx, history, subject_id, att, level):
    count = int(_num(r"(\d+)\s*(?:\w+\s){0,3}(?:questions|mcqs?|problems)", text) or 5)
    qtype = next((k for k, rx in QTYPE_WORDS if re.search(rx, text, re.I)), "mcq")
    diff = "hard" if re.search(r"\bhard|difficult|tough", text, re.I) else ("easy" if re.search(r"\beasy|simple", text, re.I) else "medium")
    with SessionLocal() as db:
        topic = find_topic(db, profile.id, text)
        subj = find_subject(db, profile.id, text) if not topic else None
    child = root.child("questions", f"Generating {count} {qtype.replace('_', ' ')} question(s)")
    qs = await registry.call(child, "generate_questions", {"profile_id": profile.id, "qtype": qtype, "count": min(count, 30),
                                                         "subject_id": (subj.id if subj else subject_id), "topic_ids": [topic.id] if topic else None,
                                                         "difficulty": diff}, tracker=child)
    child.finish()
    msg = f"Generated and saved **{len(qs)}** {qtype.replace('_', ' ')} question(s)" + (f" on *{topic.name}*" if topic else "") + "."
    if len(qs) < count:
        msg += f" ({count - len(qs)} were discarded because they failed validation.)"
    msg += "\n\n" + "\n".join(f"{i}. {q.text[:200]}" for i, q in enumerate(qs[:10], 1))
    msg += "\n\n_These are AI-generated practice questions — not actual or guaranteed exam questions._"
    cites = [c for q in qs for c in q.citations][:6]
    return {"content": msg, "agent": "questions", "citations": cites, "actions": [{"label": "Open Question Bank", "href": "/questions/"}]}


async def h_mock(root, profile, text, route, ctx, history, subject_id, att, level):
    marks = _num(r"(\d+)[- ]?marks?", text) or 50
    dur = _num(r"(\d+)\s*(?:min|minutes)", text)
    hrs = _num(r"(\d+(?:\.\d+)?)\s*(?:hour|hours|hr)", text)
    duration = int(dur or (hrs * 60 if hrs else max(30, marks * 1.8)))
    pattern = "ssc" if profile.exam_type == "ssc" else ("mba" if profile.exam_type == "mba" else "mixed")
    if re.search(r"\b(mcq|objective)\b", text, re.I):
        pattern = "objective"
    mode = "practice" if re.search(r"\bpractice mode\b", text, re.I) else "exam"
    with SessionLocal() as db:
        subj = find_subject(db, profile.id, text)
    child = root.child("questions", f"Building a {marks:g}-mark mock paper ({duration} min)")
    exam = await registry.call(child, "build_mock_paper", {"profile_id": profile.id, "total_marks": marks, "duration_min": duration, "pattern": pattern,
                                                          "subject_id": subj.id if subj else subject_id, "mode": mode}, tracker=child)
    child.finish(result_ref={"mock_id": exam.id})
    with SessionLocal() as db:
        n = db.scalar(select(func.count(MockExamItem.id)).where(MockExamItem.exam_id == exam.id))
    return {"content": f"Your mock paper **{exam.title}** is ready: {n} questions, {exam.total_marks:g} marks, {exam.duration_min} minutes, "
                       f"{'timed exam mode (answers hidden until you submit)' if exam.mode == 'exam' else 'practice mode'}.\n\n"
                       "_Questions are AI-generated for practice and are not actual or guaranteed exam questions._",
            "agent": "questions", "citations": [], "actions": [{"label": "Start mock exam", "href": f"/mocks/take/?id={exam.id}"}]}


async def h_evaluate(root, profile, text, route, ctx, history, subject_id, att, level):
    marks = _num(r"(?:for|out of|worth)?\s*(\d+(?:\.\d+)?)[- ]?marks?", text)
    qm = re.search(r"question\s*[:\-]\s*(.+?)(?:\n\s*(?:my\s+)?answer\s*[:\-]|$)", text, re.I | re.S)
    am = re.search(r"answer\s*[:\-]\s*(.+)$", text, re.I | re.S)
    answer = am.group(1).strip() if am else ""
    if att and not answer:
        from backend.agents.syllabus import document_text

        with SessionLocal() as db:
            answer = document_text(db, att)
    if not (qm and answer and marks):
        return {"content": "To evaluate, send: **Question:** … **Answer:** … and the marks (e.g. *for 10 marks*). "
                           "For handwritten or scanned answers use the Answer Evaluation page — it shows OCR text for you to correct first.",
                "agent": "evaluator", "citations": [], "actions": [{"label": "Answer Evaluation", "href": "/evaluate/"}]}
    question = qm.group(1).strip()
    child = root.child("evaluator", f"Evaluating answer against {marks:g}-mark rubric")
    with SessionLocal() as db:
        res = await evaluate_descriptive(db, profile.id, child, question=question, max_marks=marks, answer=answer)
        topic = find_topic(db, profile.id, question)
        ev = Evaluation(profile_id=profile.id, topic_id=topic.id if topic else None, question_text=question, max_marks=marks, answer_text=answer,
                        input_kind="text", marks_awarded=res["marks_awarded"], percentage=res["percentage"], result=res)
        db.add(ev)
        db.add(QuestionAttempt(profile_id=profile.id, topic_id=topic.id if topic else None, subject_id=topic.subject_id if topic else None,
                               context="practice", marks_awarded=res["marks_awarded"], max_marks=marks, correct=res["percentage"] >= 60))
        db.commit()
    child.finish(result_ref={"evaluation_id": ev.id})
    return {"content": format_evaluation(res), "agent": "evaluator", "citations": res.get("marking_scheme_citations", []),
            "actions": [{"label": "View evaluation", "href": f"/evaluate/?id={ev.id}"}]}


def format_evaluation(r: dict) -> str:
    def bl(items):
        return "\n".join(f"- {x}" for x in items) if items else "- —"
    out = [f"### Marks: {r['marks_awarded']:g} / {r['max_marks']:g} ({r['percentage']:g}%)"]
    out += ["**What was correct**", bl(r["what_was_correct"]), "**What was missing**", bl(r["what_was_missing"]),
            "**What was incorrect**", bl(r["what_was_incorrect"]), "**Important keywords missing**", bl(r["missing_keywords"]),
            "**How to improve**", bl(r["how_to_improve"])]
    if r.get("guard_notes"):
        out += ["**Marking notes**", bl(r["guard_notes"])]
    out += ["**Model answer**", r["model_answer"], "**What the examiner expects**", r["expected_answer_explanation"]]
    return "\n\n".join(out)


async def h_explain_loss(root, profile, text, route, ctx, history, subject_id, att, level):
    child = root.child("evaluator", "Explaining where marks were lost")
    with SessionLocal() as db:
        ev = db.scalar(select(Evaluation).where(Evaluation.profile_id == profile.id).order_by(Evaluation.created_at.desc()))
        item = db.execute(select(MockExamItem, MockExam).join(MockExam).where(MockExam.profile_id == profile.id, MockExam.status == "evaluated",
                                                                          MockExamItem.marks_awarded.is_not(None))
                          .order_by(MockExam.submitted_at.desc(), MockExamItem.marks_awarded)).first()
        src = None
        if item and (not ev or (item[1].submitted_at and item[1].submitted_at > ev.created_at)):
            it, _ = item
            q = it.question
            src = {"question": q.text, "max": q.marks, "awarded": it.marks_awarded, "answer": str(it.response or "")[:1500], "feedback": it.feedback}
        elif ev:
            src = {"question": ev.question_text, "max": ev.max_marks, "awarded": ev.marks_awarded, "answer": ev.answer_text[:1500], "feedback": ev.result}
    if not src:
        child.finish()
        return {"content": "I don't have any evaluated answers yet. Evaluate an answer or complete a mock exam first.", "agent": "evaluator", "citations": [], "actions": []}
    fb = src["feedback"] or {}
    prompt = (f"Explain to the student, kindly and specifically, why they scored {src['awarded']:g}/{src['max']:g}. Use the examiner feedback; do not change the marks.\n"
              f"Question: {src['question'][:800]}\nStudent answer: {src['answer']}\nFeedback: missing={fb.get('what_was_missing')}, incorrect={fb.get('what_was_incorrect')}, "
              f"missing keywords={fb.get('missing_keywords')}, notes={fb.get('guard_notes') or fb.get('detail')}\n"
              "Finish with 3 concrete steps to gain the lost marks next time.")
    res = await ollama.chat([{"role": "system", "content": BASE_RULES}, {"role": "user", "content": prompt}], temperature=0.3)
    child.finish()
    return {"content": f"**Question:** {src['question'][:300]}\n\n**Score:** {src['awarded']:g}/{src['max']:g}\n\n{res.content}", "agent": "evaluator", "citations": [], "actions": []}


async def h_revise(root, profile, text, route, ctx, history, subject_id, att, level):
    child = root.child("revision", "Preparing your revision list")
    yesterday = bool(re.search(r"yesterday", text, re.I))
    with SessionLocal() as db:
        items = revision.daily_list(db, profile.id, limit=15)
        quiz = revision.quick_quiz(db, profile.id, n=10, only_incorrect=bool(re.search(r"wrong|incorrect|mistake", text, re.I)),
                                   since_days=2 if yesterday else None)
        wrong_topics = db.scalars(select(Topic.name).join(QuestionAttempt, QuestionAttempt.topic_id == Topic.id).where(
            QuestionAttempt.profile_id == profile.id, QuestionAttempt.correct.is_(False)).distinct().limit(8)).all()
    child.finish()
    lines = [f"**{len(items)} revision item(s) due today** (mistakes and weak topics first)."]
    lines += [f"- {i.front[:120]}" for i in items[:8]]
    if wrong_topics:
        lines.append("**Topics with recent mistakes:** " + ", ".join(wrong_topics))
    lines.append(f"I also prepared a quick quiz of {len(quiz)} question(s) from your question bank" + (" focusing on questions you got wrong." if quiz else
                 ". Your bank has no objective questions yet — generate some first."))
    return {"content": "\n\n".join(lines), "agent": "revision", "citations": [], "actions": [{"label": "Open Revision Centre", "href": "/revision/"}]}


async def h_readiness(root, profile, text, route, ctx, history, subject_id, att, level):
    child = root.child("analyst", "Computing readiness against your target")
    r = await registry.call(child, "readiness_report", {"profile_id": profile.id}, tracker=child)
    child.finish()
    ind = r["indicators"]
    fmt = lambda v: "not enough data" if v is None else f"{v:g}%"  # noqa: E731
    lines = [f"### {profile.name}: target {r['target_pct']:g}%"]
    if r["estimate_pct"] is None:
        lines.append("**Estimated score: not enough data yet.** I won't guess — take at least one timed mock exam for a reliable estimate.")
    else:
        lines.append(f"**Estimated score: {r['estimate_pct']:g}%** (confidence: {r['confidence']}; based on {', '.join(r['basis'])}). "
                     + (f"You are about **{r['gap_pct']:g} points below** the target." if r["gap_pct"] > 0 else "You are currently at or above the target."))
    lines.append("\n".join(f"- {v['label']}: {fmt(v['value'])}" for v in ind.values()))
    if r["subjects_below_target"]:
        lines.append("**Below target:** " + ", ".join(f"{s['subject']} ({s['pct']:g}%)" for s in r["subjects_below_target"]))
    if r["topics_losing_marks"]:
        lines.append("**Topics costing the most marks:** " + ", ".join(f"{t['topic']} (−{t['marks_lost']:g})" for t in r["topics_losing_marks"][:5]))
    if r["alerts"]:
        lines.append("**Alerts:** " + " ".join(r["alerts"]))
    lines.append("**What to do next:**\n" + "\n".join(f"- {x}" for x in r["recommendations"][:5]))
    lines.append(f"_{r['disclaimer']}_")
    return {"content": "\n\n".join(lines), "agent": "analyst", "citations": [], "actions": [{"label": "Performance Analytics", "href": "/analytics/"}]}


async def h_analytics(root, profile, text, route, ctx, history, subject_id, att, level):
    child = root.child("analyst", "Analysing your performance data")
    o = await registry.call(child, "performance_overview", {"profile_id": profile.id}, tracker=child)
    child.finish()
    lines = [f"**Study time recorded:** {o['total_study_hours']:g} h · **Streak:** {o['streak_days']} day(s)"]
    if o["weak_topics"]:
        lines.append("**Weak topics:** " + ", ".join(f"{t['topic']} ({t['accuracy']:g}%)" for t in o["weak_topics"][:6]))
    if o["strong_topics"]:
        lines.append("**Strong topics:** " + ", ".join(f"{t['topic']} ({t['accuracy']:g}%)" for t in o["strong_topics"]))
    if o["repeated_mistakes"]:
        lines.append(f"**Repeated mistakes:** {len(o['repeated_mistakes'])} question(s) answered wrong more than once.")
    if o["time_management"]["issues"]:
        lines.append("**Time management:** " + " ".join(o["time_management"]["issues"]))
    lines.append("**Recommendations:**\n" + "\n".join(f"- {x}" for x in o["recommendations"][:5]))
    return {"content": "\n\n".join(lines), "agent": "analyst", "citations": [], "actions": [{"label": "Performance Analytics", "href": "/analytics/"}]}


async def h_doc_qa(root, profile, text, route, ctx, history, subject_id, att, level):
    child = root.child("tutor", "Retrieving relevant sections from your documents")
    passages = await registry.call(child, "retrieve_documents", {"profile_id": profile.id, "query": text[:500], "k": 4, "subject_id": subject_id}, tracker=child)
    passages = [p for p in passages if p.score >= 0.25]
    ctxt = format_context(passages, 3000)
    with SessionLocal() as db:
        brief = profile_brief(db, profile)
    sys = f"{BASE_RULES} Context: {brief}."
    if passages:
        user = (f"Answer using the SOURCES and cite them inline as [S1], [S2]. If the sources don't contain the answer, say so and then answer "
                f"from general knowledge, clearly labelled.\n\nSOURCES:\n{ctxt}\n\nQUESTION: {text}")
    else:
        user = f"{text}\n\n(No matching passages were found in the uploaded documents; answer from general knowledge and say so.)"
    res = await ollama.chat([{"role": "system", "content": sys}, *history[-4:], {"role": "user", "content": user}], temperature=0.3)
    child.finish()
    used = sorted({int(n) for n in re.findall(r"\[S(\d+)\]", res.content) if 1 <= int(n) <= len(passages)})
    cites = [passages[i - 1].citation() for i in used]
    content = res.content
    if used:
        content += "\n\n---\n**Sources:** " + "; ".join(f"[S{i}] {passages[i - 1].label()}" for i in used)
    return {"content": content, "agent": "tutor", "citations": cites, "actions": []}


HANDLERS = {
    "teach": h_teach, "followup": h_followup, "plan": h_plan, "reschedule": h_reschedule, "analyze_syllabus": h_syllabus,
    "generate_questions": h_questions, "mock_exam": h_mock, "evaluate_answer": h_evaluate, "explain_loss": h_explain_loss,
    "revise": h_revise, "readiness": h_readiness, "analytics": h_analytics, "doc_qa": h_doc_qa, "general": h_doc_qa,
}
