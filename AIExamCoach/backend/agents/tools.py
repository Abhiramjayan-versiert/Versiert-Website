"""Controlled tool registry for agents. Each tool: purpose, validated input,
permission level, timeout, agent allow-list. No shell / filesystem tools."""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field

from backend.agents import analyst, planner, questions, revision, syllabus, tutor
from backend.agents.runtime import Tool, registry
from backend.database.session import SessionLocal
from backend.models.entities import Document, ExamProfile, Topic
from backend.rag import ingest, store
from backend.rag.retrieve import retrieve


class ProfileArg(BaseModel):
    profile_id: int


class RetrieveArgs(ProfileArg):
    query: str = Field(min_length=2, max_length=500)
    k: int = Field(5, ge=1, le=10)
    subject_id: int | None = None


class SyllabusArgs(ProfileArg):
    document_id: int


class PlanArgs(ProfileArg):
    days: int | None = Field(None, ge=1, le=365)
    daily_hours: float | None = Field(None, ge=0.5, le=16)


class GenArgs(ProfileArg):
    qtype: str
    count: int = Field(5, ge=1, le=30)
    subject_id: int | None = None
    topic_ids: list[int] | None = None
    difficulty: str = Field("medium", pattern="^(easy|medium|hard)$")


class PaperArgs(ProfileArg):
    total_marks: float = Field(50, ge=5, le=300)
    duration_min: int = Field(90, ge=5, le=360)
    pattern: str = "mixed"
    subject_id: int | None = None
    difficulty: str = Field("medium", pattern="^(easy|medium|hard)$")
    mode: str = Field("exam", pattern="^(exam|practice)$")


class LessonArgs(ProfileArg):
    topic: str = Field(min_length=2, max_length=300)
    level: str = "intermediate"
    topic_id: int | None = None


class CardsArgs(ProfileArg):
    topic_id: int
    count: int = Field(8, ge=1, le=20)


class DeleteDocArgs(ProfileArg):
    document_id: int


def _db_profile(db, pid: int) -> ExamProfile:
    p = db.get(ExamProfile, pid)
    if not p:
        raise ValueError("profile not found")
    return p


async def t_retrieve(a: RetrieveArgs, **_):
    with SessionLocal() as db:
        return await retrieve(db, a.profile_id, a.query, a.k, a.subject_id)


async def t_syllabus(a: SyllabusArgs, tracker, **_):
    with SessionLocal() as db:
        return await syllabus.analyze_document(db, a.profile_id, a.document_id, tracker)


async def t_plan(a: PlanArgs, **_):
    from datetime import timedelta

    with SessionLocal() as db:
        p = _db_profile(db, a.profile_id)
        end = date.today() + timedelta(days=a.days - 1) if a.days else None
        if end and p.exam_date and end >= p.exam_date:
            end = p.exam_date - timedelta(days=1)
        return planner.build_plan(db, p, end=end, daily_hours=a.daily_hours, title=f"{a.days}-day plan" if a.days else None)


async def t_reschedule(a: ProfileArg, **_):
    with SessionLocal() as db:
        return planner.reschedule(db, _db_profile(db, a.profile_id))


async def t_generate(a: GenArgs, tracker, **_):
    with SessionLocal() as db:
        return await questions.generate(db, _db_profile(db, a.profile_id), tracker, qtype=a.qtype, count=a.count,
                                        subject_id=a.subject_id, topic_ids=a.topic_ids, difficulty=a.difficulty)


async def t_paper(a: PaperArgs, tracker, **_):
    with SessionLocal() as db:
        return await questions.build_paper(db, _db_profile(db, a.profile_id), tracker, total_marks=a.total_marks, duration_min=a.duration_min,
                                           pattern=a.pattern, subject_id=a.subject_id, difficulty=a.difficulty, mode=a.mode)


async def t_lesson(a: LessonArgs, tracker, **_):
    with SessionLocal() as db:
        topic = db.get(Topic, a.topic_id) if a.topic_id else None
        return await tutor.lesson(db, _db_profile(db, a.profile_id), tracker, a.topic, a.level, topic)


async def t_cards(a: CardsArgs, tracker, **_):
    with SessionLocal() as db:
        t = db.get(Topic, a.topic_id)
        if not t or t.profile_id != a.profile_id:
            raise ValueError("topic not in profile")
        return await revision.generate_cards(db, _db_profile(db, a.profile_id), tracker, t, a.count)


async def t_revision_list(a: ProfileArg, **_):
    with SessionLocal() as db:
        return revision.daily_list(db, a.profile_id)


async def t_readiness(a: ProfileArg, **_):
    with SessionLocal() as db:
        return analyst.readiness(db, _db_profile(db, a.profile_id))


async def t_overview(a: ProfileArg, **_):
    with SessionLocal() as db:
        return analyst.overview(db, _db_profile(db, a.profile_id))


async def t_delete_document(a: DeleteDocArgs, **_):
    with SessionLocal() as db:
        d = db.get(Document, a.document_id)
        if not d or d.profile_id != a.profile_id:
            raise ValueError("document not found")
        store.delete_document(d.id)
        ingest.doc_path(d).unlink(missing_ok=True)
        db.delete(d)
        db.commit()
        return {"deleted": a.document_id}


for tool in [
    Tool("retrieve_documents", "Semantic + keyword search over the profile's uploaded documents", RetrieveArgs, t_retrieve, "read", 120),
    Tool("analyze_syllabus", "Extract a structured, verified syllabus draft from a document", SyllabusArgs, t_syllabus, "write", 1800, ("syllabus",)),
    Tool("create_study_plan", "Build a realistic, prioritised study schedule", PlanArgs, t_plan, "write", 60, ("planner",)),
    Tool("reschedule_plan", "Recalculate the remaining schedule after missed sessions", ProfileArg, t_reschedule, "write", 60, ("planner",)),
    Tool("generate_questions", "Generate validated practice questions grounded on documents", GenArgs, t_generate, "write", 1800, ("questions",)),
    Tool("build_mock_paper", "Assemble a complete mock examination paper", PaperArgs, t_paper, "write", 3600, ("questions",)),
    Tool("teach_lesson", "Produce a structured 10-part lesson with citations", LessonArgs, t_lesson, "read", 1200, ("tutor",)),
    Tool("generate_flashcards", "Create spaced-repetition flashcards for a topic", CardsArgs, t_cards, "write", 900, ("revision",)),
    Tool("daily_revision_list", "List revision items due today, weakest first", ProfileArg, t_revision_list, "read", 30, ("revision",)),
    Tool("readiness_report", "Compute the 75% target readiness indicators", ProfileArg, t_readiness, "read", 30, ("analyst",)),
    Tool("performance_overview", "Compute performance analytics", ProfileArg, t_overview, "read", 30, ("analyst",)),
    Tool("delete_document", "Permanently delete an uploaded document and its index", DeleteDocArgs, t_delete_document, "destructive", 30, ("librarian",)),
]:
    registry.register(tool)
