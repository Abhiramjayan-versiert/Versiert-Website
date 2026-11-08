"""Agent 3 — AI Tutor. Structured 10-part lessons in two compact LLM calls (to
fit the 4096-token context), grounded on the user's documents with real
citations, plus context-preserving follow-up questions."""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.agents.common import BASE_RULES, LEVELS
from backend.agents.runtime import Tracker
from backend.models.entities import ExamProfile, StudyLog, Topic
from backend.rag.retrieve import format_context, retrieve
from backend.services import ollama


class Definition(BaseModel):
    term: str
    definition: str


class Formula(BaseModel):
    name: str
    formula: str
    meaning: str = ""


class LessonCore(BaseModel):
    title: str
    simple_explanation: str
    detailed_explanation: str
    definitions: list[Definition] = Field(default_factory=list)
    examples: list[str] = Field(default_factory=list)
    real_world_applications: list[str] = Field(default_factory=list)
    formulas: list[Formula] = Field(default_factory=list)
    diagram: str = Field("", description="Optional plain-text/ASCII diagram or flow, empty if not useful")


class PracticeQ(BaseModel):
    question: str
    answer: str


class LessonExam(BaseModel):
    exam_notes: list[str]
    points_to_remember: list[str]
    revision_summary: str
    practice_questions: list[PracticeQ]


def _cite_line(passages) -> str:
    return "; ".join(f"[S{i}] {p.label()}" for i, p in enumerate(passages, 1))


async def lesson(db: Session, profile: ExamProfile, tracker: Tracker, topic_text: str, level: str = "intermediate",
                 topic: Topic | None = None) -> dict:
    level_note = LEVELS.get(level, LEVELS["intermediate"])
    tracker.step(f"Retrieving relevant study material for '{topic_text}'")
    passages = await retrieve(db, profile.id, topic_text, k=4, subject_id=topic.subject_id if topic else None)
    ctx = format_context(passages, 3000)
    src = (f"Use these SOURCES from the student's own material where relevant and cite them inline as [S1], [S2]:\n{ctx}\n\n"
           if ctx else "No uploaded material matched; teach from standard syllabus knowledge.\n\n")
    tracker.step(f"Preparing {level} lesson on '{topic_text}'")
    core, r1 = await ollama.chat_json(
        [{"role": "system", "content": f"{BASE_RULES} You are an expert tutor. {level_note}"},
         {"role": "user", "content": f"{src}Teach the topic: {topic_text} (exam: {profile.name}). Return JSON."}],
        LessonCore, temperature=0.4,
    )
    tracker.step("Writing exam notes, summary and practice questions")
    exam, r2 = await ollama.chat_json(
        [{"role": "system", "content": f"{BASE_RULES} You are an expert examiner-tutor. {level_note}"},
         {"role": "user", "content": f"Topic: {topic_text} (exam: {profile.name}).\nLesson summary: {core.simple_explanation[:800]}\n"
                                     "Write exam-oriented notes, points to remember, a short revision summary and 4 practice questions with answers. Return JSON."}],
        LessonExam, temperature=0.4,
    )
    md = render(core, exam, passages)
    if topic:
        if topic.status == "pending":
            topic.status = "in_progress"
        db.add(StudyLog(profile_id=profile.id, topic_id=topic.id, subject_id=topic.subject_id, minutes=15, activity="tutor", day=date.today()))
        db.commit()
    return {"markdown": md, "core": core.model_dump(), "exam": exam.model_dump(), "citations": [p.citation() for p in passages],
            "topic_id": topic.id if topic else None, "level": level, "duration_ms": r1.duration_ms + r2.duration_ms}


def render(core: LessonCore, exam: LessonExam, passages) -> str:
    out = [f"# {core.title}", "## 1. Simple explanation", core.simple_explanation, "## 2. Detailed explanation", core.detailed_explanation]
    if core.definitions:
        out += ["## 3. Important definitions"] + [f"- **{d.term}** — {d.definition}" for d in core.definitions]
    if core.examples:
        out += ["## 4. Practical examples"] + [f"- {e}" for e in core.examples]
    if core.real_world_applications:
        out += ["## 5. Real-world applications"] + [f"- {a}" for a in core.real_world_applications]
    if core.formulas or core.diagram.strip():
        out.append("## 6. Formulas and diagrams")
        out += [f"- **{f.name}:** `{f.formula}`" + (f" — {f.meaning}" if f.meaning else "") for f in core.formulas]
        if core.diagram.strip():
            out += ["```", core.diagram.strip(), "```"]
    out += ["## 7. Exam-oriented notes"] + [f"- {n}" for n in exam.exam_notes]
    out += ["## 8. Points to remember"] + [f"- {n}" for n in exam.points_to_remember]
    out += ["## 9. Revision summary", exam.revision_summary]
    out += ["## 10. Practice questions"]
    for i, q in enumerate(exam.practice_questions, 1):
        out += [f"{i}. {q.question}", f"   <details><summary>Answer</summary>{q.answer}</details>"]
    if passages:
        out += ["---", "**Sources from your documents:** " + _cite_line(passages)]
    return "\n\n".join(out)


async def followup(db: Session, profile: ExamProfile, tracker: Tracker, question: str, lesson_ctx: dict, history: list[dict]) -> dict:
    tracker.step("Answering follow-up question in lesson context")
    passages = await retrieve(db, profile.id, f"{lesson_ctx.get('topic', '')} {question}", k=3)
    ctx = format_context(passages, 2200)
    sys = (f"{BASE_RULES} You are tutoring '{lesson_ctx.get('topic')}' at {lesson_ctx.get('level', 'intermediate')} level. "
           f"Lesson so far: {lesson_ctx.get('summary', '')[:900]}")
    msgs = [{"role": "system", "content": sys}] + history[-6:]
    user = question + (f"\n\nRelevant SOURCES (cite as [S#] if used):\n{ctx}" if ctx else "")
    msgs.append({"role": "user", "content": user})
    res = await ollama.chat(msgs, temperature=0.4)
    return {"markdown": res.content + (("\n\n---\n**Sources:** " + _cite_line(passages)) if passages and "[S" in res.content else ""),
            "citations": [p.citation() for p in passages] if "[S" in res.content else []}
