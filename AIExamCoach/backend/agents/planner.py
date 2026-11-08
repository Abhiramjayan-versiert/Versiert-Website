"""Agent 4 — Intelligent Study Planner.

Scheduling is a deterministic algorithm (not LLM output) so hours are always
realistic and reproducible:

* respects the user's daily hours (capped by settings.max_daily_study_hours)
  and chosen study days,
* priority = marks weight + importance + weakness (from real attempts) +
  difficulty, minus completion,
* interleaves subjects, uses 50-minute blocks with recommended breaks,
* inserts spaced revision after each learning block,
* reserves a final phase for timed mocks and weak-topic revision,
* never over-fills: unscheduled work is reported as backlog,
* missed sessions trigger a re-plan of the remaining time.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.models.entities import ExamProfile, QuestionAttempt, StudyPlan, StudySession, Subject, Topic, utcnow

BLOCK = 50
BREAK_NOTE = "Take a 10-minute break after each 50-minute block and a 30-minute break after every third block."
REVISION_OFFSETS = (1, 4, 10)
REVISION_MIN = 20


@dataclass
class TopicWork:
    topic: Topic
    subject_name: str
    priority: float
    learn_minutes: int
    remaining: int = 0
    first_day: date | None = None
    revisions: list[date] = field(default_factory=list)


def topic_accuracy(db: Session, profile_id: int) -> dict[int, float]:
    rows = db.execute(
        select(QuestionAttempt.topic_id, func.sum(QuestionAttempt.marks_awarded), func.sum(QuestionAttempt.max_marks))
        .where(QuestionAttempt.profile_id == profile_id, QuestionAttempt.topic_id.is_not(None))
        .group_by(QuestionAttempt.topic_id)
    ).all()
    return {tid: (a or 0) / m for tid, a, m in rows if m}


def study_days(start: date, end: date, weekdays: list[int]) -> list[date]:
    days, d = [], start
    while d <= end:
        if d.weekday() in weekdays:
            days.append(d)
        d += timedelta(days=1)
    return days


def _priority(t: Topic, max_marks: float, acc: float | None) -> float:
    weight = (t.marks_weight or 0) / max_marks if max_marks else 0.3
    imp = {"high": 1.0, "normal": 0.5, "low": 0.2}.get(t.importance, 0.5)
    weak = 1 - acc if acc is not None else 0.5
    diff = (t.difficulty - 1) / 4
    status = 0.6 if t.status == "in_progress" else 1.0
    return round((0.35 * weight + 0.25 * imp + 0.25 * weak + 0.15 * diff) * status, 4)


def build_plan(
    db: Session,
    profile: ExamProfile,
    *,
    start: date | None = None,
    end: date | None = None,
    daily_hours: float | None = None,
    weekdays: list[int] | None = None,
    subject_ids: list[int] | None = None,
    include_revision: bool = True,
    title: str | None = None,
) -> StudyPlan:
    s = get_settings()
    start = start or date.today()
    end = end or ((profile.exam_date - timedelta(days=1)) if profile.exam_date else None)
    if not end:
        raise ValueError("Set an exam date on the profile or choose the number of days for the plan.")
    if end < start:
        raise ValueError("The plan end date is before the start date (is the exam date in the past?).")
    weekdays = weekdays if weekdays is not None else (profile.study_days or [0, 1, 2, 3, 4, 5])
    if not weekdays:
        raise ValueError("Choose at least one study day.")
    hours = daily_hours if daily_hours is not None else profile.daily_hours
    warnings: list[str] = []
    if hours > s.max_daily_study_hours:
        warnings.append(f"Daily hours reduced from {hours:g} to the realistic maximum of {s.max_daily_study_hours:g}.")
        hours = s.max_daily_study_hours
    if hours > 8:
        warnings.append("More than 8 hours a day is hard to sustain; the plan includes breaks but watch for fatigue.")
    if hours < 0.5:
        raise ValueError("Daily study time must be at least 30 minutes.")
    day_minutes = int(hours * 60)

    q = select(Topic).where(Topic.profile_id == profile.id, Topic.kind != "unit", Topic.status != "completed")
    if subject_ids:
        q = q.where(Topic.subject_id.in_(subject_ids))
    topics = db.scalars(q).all()
    if not topics:
        raise ValueError("No pending topics. Add a syllabus (or mark topics as pending) before creating a plan.")
    subjects = {sb.id: sb.name for sb in db.scalars(select(Subject).where(Subject.profile_id == profile.id))}
    acc = topic_accuracy(db, profile.id)
    max_marks = max((t.marks_weight or 0) for t in topics) or 0

    days = study_days(start, end, weekdays)
    if not days:
        raise ValueError("No study days fall between the start and end dates.")
    final_n = 0 if len(days) < 4 else min(7, max(1, round(len(days) * 0.15)))
    learn_days, final_days = days[: len(days) - final_n], days[len(days) - final_n :]

    work = []
    for t in topics:
        mins = int(t.est_hours * 60 * (0.8 + 0.15 * (t.difficulty - 1)) * (1.25 if acc.get(t.id, 1) < 0.6 else 1.0))
        if t.status == "in_progress":
            mins = int(mins * 0.6)
        mins = max(25, mins)
        work.append(TopicWork(t, subjects.get(t.subject_id, ""), _priority(t, max_marks, acc.get(t.id)), mins, mins))
    work.sort(key=lambda w: (-w.priority, w.topic.subject_id, w.topic.order))

    # capacity check — reserve ~20% of learning-phase time for revision
    capacity = len(learn_days) * day_minutes * (0.8 if include_revision else 1.0)
    need = sum(w.learn_minutes for w in work)
    if need > capacity:
        ratio = max(0.6, capacity / need)
        for w in work:
            if w.priority < 0.5:
                w.learn_minutes = w.remaining = max(25, int(w.learn_minutes * ratio))
        need = sum(w.learn_minutes for w in work)
        if need > capacity:
            warnings.append("Not all topics fit in the available time. Lowest-priority topics are listed as backlog; "
                            "consider adding study days or hours.")

    plan = StudyPlan(profile_id=profile.id, title=title or f"Plan to {end.isoformat()}", start_date=start, end_date=end,
                     params={"daily_hours": hours, "weekdays": weekdays, "subject_ids": subject_ids, "include_revision": include_revision})
    db.add(plan)
    db.flush()

    sessions: list[StudySession] = []
    used: dict[date, int] = defaultdict(int)
    slots: dict[date, int] = defaultdict(int)
    revision_queue: dict[date, list[TopicWork]] = defaultdict(list)

    def add(day: date, title_: str, kind: str, minutes: int, w: TopicWork | None) -> None:
        sessions.append(StudySession(plan_id=plan.id, profile_id=profile.id, day=day, slot=slots[day], title=title_[:300], kind=kind,
                                     minutes=minutes, topic_id=w.topic.id if w else None, subject_id=w.topic.subject_id if w else None))
        slots[day] += 1
        used[day] += minutes

    pending = list(work)
    last_subject = None
    for di, day in enumerate(learn_days):
        # 1) due revisions first (short, high value)
        if include_revision:
            for w in revision_queue.pop(day, []):
                if used[day] + REVISION_MIN <= day_minutes:
                    add(day, f"Revise: {w.topic.name}", "revise", REVISION_MIN, w)
                elif di + 1 < len(learn_days):
                    revision_queue[learn_days[di + 1]].append(w)
        # 2) learning blocks, interleaving subjects
        while used[day] + 25 <= day_minutes and pending:
            pick = next((w for w in pending if w.topic.subject_id != last_subject), pending[0])
            block = min(BLOCK, pick.remaining, day_minutes - used[day])
            if block < 25 and pick.remaining > block:
                break
            add(day, f"Study: {pick.topic.name}", "learn", block, pick)
            pick.first_day = pick.first_day or day
            pick.remaining -= block
            last_subject = pick.topic.subject_id
            if pick.remaining <= 0:
                pending.remove(pick)
                if include_revision:
                    for off in REVISION_OFFSETS:
                        target = day + timedelta(days=off)
                        nxt = next((d for d in learn_days if d >= target), None)
                        if nxt:
                            revision_queue[nxt].append(pick)
        # 3) top up with practice if time remains and nothing left to learn
        if not pending and used[day] + 30 <= day_minutes:
            add(day, "Practice questions on completed topics", "practice", min(60, day_minutes - used[day]), None)

    backlog = [w.topic.name for w in pending]
    if backlog:
        warnings.append(f"{len(backlog)} topic(s) could not be scheduled: " + ", ".join(backlog[:8]) + ("…" if len(backlog) > 8 else ""))

    # final phase: timed mocks + weak-topic revision
    weak = sorted(work, key=lambda w: acc.get(w.topic.id, 0.5))[:10]
    for i, day in enumerate(final_days):
        mock_min = min(180, max(60, day_minutes // 2))
        add(day, "Timed mock examination", "mock", mock_min, None)
        add(day, "Review mock mistakes", "revise", min(45, max(0, day_minutes - used[day])), None) if used[day] + 30 <= day_minutes else None
        for w in weak[i * 2 : i * 2 + 4]:
            if used[day] + 30 <= day_minutes:
                add(day, f"Revise weak topic: {w.topic.name}", "revise", 30, w)

    db.add_all(sessions)
    learn_min = sum(x.minutes for x in sessions if x.kind == "learn")
    plan.summary = (
        f"{len(days)} study days ({len(final_days)} reserved for mocks and revision), up to {hours:g} h/day. "
        f"{len(work) - len(backlog)} of {len(work)} pending topics scheduled ({learn_min / 60:.1f} h of learning, "
        f"{sum(x.minutes for x in sessions if x.kind == 'revise') / 60:.1f} h revision, "
        f"{sum(1 for x in sessions if x.kind == 'mock')} timed mocks). {BREAK_NOTE}"
    )
    plan.warnings = warnings
    # deactivate older plans for this profile
    for old in db.scalars(select(StudyPlan).where(StudyPlan.profile_id == profile.id, StudyPlan.id != plan.id, StudyPlan.active)):
        old.active = False
    db.commit()
    return plan


def mark_missed(db: Session, profile_id: int, today: date | None = None) -> int:
    today = today or date.today()
    rows = db.scalars(select(StudySession).join(StudyPlan).where(
        StudySession.profile_id == profile_id, StudyPlan.active, StudySession.day < today, StudySession.status == "pending")).all()
    for r in rows:
        r.status = "missed"
    db.commit()
    return len(rows)


def reschedule(db: Session, profile: ExamProfile) -> StudyPlan:
    """Recalculate the remaining schedule from today after missed sessions."""
    plan = db.scalar(select(StudyPlan).where(StudyPlan.profile_id == profile.id, StudyPlan.active))
    if not plan:
        raise ValueError("No active study plan to reschedule.")
    missed = mark_missed(db, profile.id)
    p = plan.params or {}
    end = plan.end_date if plan.end_date >= date.today() else None
    if end is None:
        raise ValueError("The plan has already ended; create a new plan.")
    # future pending sessions of the old plan are superseded by the new plan
    for sess in db.scalars(select(StudySession).where(StudySession.plan_id == plan.id, StudySession.day >= date.today(), StudySession.status == "pending")):
        sess.status = "skipped"
    db.commit()
    new = build_plan(db, profile, start=date.today(), end=end, daily_hours=p.get("daily_hours"), weekdays=p.get("weekdays"),
                     subject_ids=p.get("subject_ids"), include_revision=p.get("include_revision", True),
                     title=f"Rescheduled plan to {end.isoformat()}")
    new.warnings = [f"Rescheduled after {missed} missed session(s)."] + list(new.warnings or [])
    db.commit()
    return new


def complete_session(db: Session, sess: StudySession, done: bool, actual_minutes: int | None = None, topic_completed: bool = False) -> None:
    from backend.models.entities import StudyLog

    sess.status = "done" if done else "missed"
    sess.completed_at = utcnow() if done else None
    sess.actual_minutes = actual_minutes if done else None
    if done:
        db.add(StudyLog(profile_id=sess.profile_id, topic_id=sess.topic_id, subject_id=sess.subject_id,
                        minutes=actual_minutes or sess.minutes, activity=sess.kind, day=date.today()))
        if sess.topic_id:
            t = db.get(Topic, sess.topic_id)
            if t:
                if topic_completed:
                    t.status, t.completed_at = "completed", utcnow()
                elif t.status == "pending":
                    t.status = "in_progress"
    db.commit()
