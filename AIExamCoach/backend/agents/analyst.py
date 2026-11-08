"""Agent 8 — Performance Analyst and the 75% Target Engine.

Everything here is computed from recorded data (attempts, mocks, revision
logs, topic status). Nothing is invented: when there is not enough data the
indicator says so instead of showing a number. Readiness is an ESTIMATE
driven mainly by real timed mock scores — never a guarantee."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.agents.revision import retention_stats
from backend.models.entities import (
    Evaluation, ExamProfile, MockExam, MockExamItem, Question, QuestionAttempt, StudyLog, StudyPlan, StudySession, Subject, Topic, utcnow,
)


def syllabus_completion(db: Session, profile_id: int) -> dict:
    topics = db.scalars(select(Topic).where(Topic.profile_id == profile_id, Topic.kind != "unit")).all()
    if not topics:
        return {"value": None, "topics": 0, "completed": 0, "note": "No syllabus topics yet."}
    w = lambda t: t.marks_weight or 1.0  # noqa: E731
    total = sum(w(t) for t in topics)
    done = sum(w(t) for t in topics if t.status == "completed")
    half = sum(w(t) * 0.4 for t in topics if t.status == "in_progress")
    by_subject: dict[int, list] = defaultdict(lambda: [0, 0])
    for t in topics:
        by_subject[t.subject_id][0] += 1
        by_subject[t.subject_id][1] += t.status == "completed"
    return {"value": round(100 * (done + half) / total, 1), "topics": len(topics), "completed": sum(t.status == "completed" for t in topics),
            "in_progress": sum(t.status == "in_progress" for t in topics), "weighted_by": "marks" if any(t.marks_weight for t in topics) else "topic count",
            "by_subject": {sid: {"topics": v[0], "completed": v[1]} for sid, v in by_subject.items()}}


def practice_accuracy(db: Session, profile_id: int, days: int = 45) -> dict:
    since = utcnow() - timedelta(days=days)
    rows = db.scalars(select(QuestionAttempt).where(QuestionAttempt.profile_id == profile_id, QuestionAttempt.at >= since)).all()
    if not rows:
        return {"value": None, "attempts": 0, "note": "No practice attempts in the last %d days." % days}
    tot, aw = sum(r.max_marks for r in rows), sum(max(0, r.marks_awarded) for r in rows)
    by_topic: dict[int, list[float]] = defaultdict(lambda: [0.0, 0.0, 0])
    for r in rows:
        if r.topic_id:
            by_topic[r.topic_id][0] += max(0, r.marks_awarded)
            by_topic[r.topic_id][1] += r.max_marks
            by_topic[r.topic_id][2] += 1
    names = {t.id: t.name for t in db.scalars(select(Topic).where(Topic.id.in_(list(by_topic))))} if by_topic else {}
    topic_acc = sorted(
        [{"topic_id": k, "topic": names.get(k, "?"), "accuracy": round(100 * v[0] / v[1], 1), "attempts": v[2], "marks_lost": round(v[1] - v[0], 1)}
         for k, v in by_topic.items() if v[1]], key=lambda x: x["accuracy"])
    return {"value": round(100 * aw / tot, 1) if tot else None, "attempts": len(rows), "by_topic": topic_acc}


MIN_MOCK_MARKS_FOR_ESTIMATE = 20  # short quizzes are too small to estimate an exam score


def mock_performance(db: Session, profile_id: int) -> dict:
    mocks = db.scalars(select(MockExam).where(MockExam.profile_id == profile_id, MockExam.status == "evaluated", MockExam.mode == "exam")
                       .order_by(MockExam.submitted_at)).all()
    hist = [{"id": m.id, "title": m.title, "date": m.submitted_at.date().isoformat() if m.submitted_at else None,
             "percentage": m.percentage, "subject_id": m.subject_id, "marks": m.marks_awarded, "total": m.total_marks} for m in mocks]
    if not mocks:
        return {"value": None, "count": 0, "history": [], "note": "No timed mock exams completed yet."}
    recent = [m.percentage or 0 for m in mocks[-5:]]
    # exponentially weighted: latest mocks matter most
    weights = [0.5 ** (len(recent) - 1 - i) for i in range(len(recent))]
    ewma = sum(p * w for p, w in zip(recent, weights)) / sum(weights)
    trend = None
    if len(mocks) >= 2:
        prev = [m.percentage or 0 for m in mocks[-4:-1]]
        trend = round((mocks[-1].percentage or 0) - sum(prev) / len(prev), 1)
    full = [m for m in mocks if (m.total_marks or 0) >= MIN_MOCK_MARKS_FOR_ESTIMATE]
    full_val = None
    if full:
        fr = [m.percentage or 0 for m in full[-5:]]
        fw = [0.5 ** (len(fr) - 1 - i) for i in range(len(fr))]
        full_val = round(sum(p * w for p, w in zip(fr, fw)) / sum(fw), 1)
    return {"value": round(ewma, 1), "count": len(mocks), "full_length_count": len(full), "full_length_value": full_val,
            "latest": mocks[-1].percentage, "trend": trend, "history": hist}


def readiness(db: Session, profile: ExamProfile) -> dict:
    target = profile.target_pct
    syl = syllabus_completion(db, profile.id)
    prac = practice_accuracy(db, profile.id)
    ret = retention_stats(db, profile.id)
    mock = mock_performance(db, profile.id)
    indicators = {
        "syllabus_completion": {"label": "Syllabus completion", "value": syl["value"], "detail": syl},
        "practice_accuracy": {"label": "Topic-wise practice accuracy", "value": prac["value"], "detail": {k: v for k, v in prac.items() if k != "by_topic"}},
        "retention": {"label": "Retention (revision recall)", "value": ret["recall_rate"], "detail": ret},
        "mock_performance": {"label": "Timed mock performance", "value": mock["value"], "detail": {k: v for k, v in mock.items() if k != "history"}},
    }
    # Estimate: anchored on timed mocks; adjusted slightly for coverage gaps.
    estimate, confidence, basis = None, "insufficient data", []
    if mock.get("full_length_value") is not None:
        estimate = mock["full_length_value"]
        n_full = mock["full_length_count"]
        basis.append(f"{n_full} timed mock(s) of {MIN_MOCK_MARKS_FOR_ESTIMATE}+ marks")
        if syl["value"] is not None and syl["value"] < 100 and n_full < 3:
            # Mocks so far may only cover studied topics; untested portions add risk.
            estimate = estimate * (0.85 + 0.15 * syl["value"] / 100)
            basis.append("adjusted for incomplete syllabus coverage")
        confidence = "low" if n_full < 2 else ("medium" if n_full < 4 else "higher")
    elif prac["value"] is not None and prac["attempts"] >= 20:
        estimate = prac["value"] * 0.9 * ((syl["value"] or 0) / 100 if syl["value"] is not None else 1)
        basis.append("practice accuracy only (no timed mocks yet) — take a timed mock for a reliable estimate")
        confidence = "very low"
    gap = round(target - estimate, 1) if estimate is not None else None

    # subjects below target (from mocks + attempts)
    subj_rows = db.execute(select(QuestionAttempt.subject_id, func.sum(QuestionAttempt.marks_awarded), func.sum(QuestionAttempt.max_marks))
                           .where(QuestionAttempt.profile_id == profile.id, QuestionAttempt.subject_id.is_not(None))
                           .group_by(QuestionAttempt.subject_id)).all()
    subj_names = {s.id: s.name for s in db.scalars(select(Subject).where(Subject.profile_id == profile.id))}
    subjects = [{"subject_id": sid, "subject": subj_names.get(sid, "?"), "pct": round(100 * max(0, a) / m, 1)} for sid, a, m in subj_rows if m]
    below = [s for s in subjects if s["pct"] < target]
    loss = sorted(prac.get("by_topic", []), key=lambda x: -x["marks_lost"])[:8]

    alerts = []
    if mock.get("trend") is not None and mock["trend"] <= -5:
        alerts.append(f"Your latest mock fell {abs(mock['trend']):g} points below your recent average.")
    if profile.exam_date:
        days_left = (profile.exam_date - date.today()).days
        if 0 <= days_left <= 14 and (syl["value"] or 0) < 80:
            alerts.append(f"Only {days_left} days left and syllabus completion is {syl['value'] or 0:g}%. Prioritise high-weightage topics.")
    if ret["recall_rate"] is not None and ret["recall_rate"] < 60:
        alerts.append(f"Revision recall is {ret['recall_rate']:g}% — review due flashcards daily.")

    recs = recommendations(db, profile, syl, prac, ret, mock, loss, gap)
    return {
        "target_pct": target, "estimate_pct": round(estimate, 1) if estimate is not None else None, "gap_pct": gap,
        "on_track": (estimate is not None and estimate >= target), "confidence": confidence, "basis": basis,
        "indicators": indicators, "subjects": subjects, "subjects_below_target": below, "topics_losing_marks": loss,
        "alerts": alerts, "recommendations": recs, "mock_history": mock["history"],
        "disclaimer": "This is an estimate from your recorded practice and mock results, not a prediction or guarantee of your exam score.",
    }


def recommendations(db, profile, syl, prac, ret, mock, loss, gap) -> list[str]:
    recs: list[str] = []
    if syl["value"] is None:
        recs.append("Upload your syllabus (Document Library) and run the Syllabus Analyst so progress can be tracked.")
    if mock.get("full_length_value") is None:
        recs.append(f"Take a full timed mock exam ({MIN_MOCK_MARKS_FOR_ESTIMATE}+ marks): readiness can only be estimated reliably from timed mock scores.")
    if loss:
        top = ", ".join(l["topic"] for l in loss[:3])
        recs.append(f"Most marks are being lost in: {top}. Re-study these with the AI Tutor, then take a topic quiz.")
    if gap is not None and gap > 0:
        recs.append(f"You need about {gap:g} more percentage points to reach {profile.target_pct:g}%. "
                    "Focus on high-weightage topics where your accuracy is below 60%.")
    pending_high = db.scalars(select(Topic).where(Topic.profile_id == profile.id, Topic.importance == "high", Topic.status != "completed")).all()
    if pending_high:
        recs.append("High-weightage topics not completed yet: " + ", ".join(t.name for t in pending_high[:4]) + ".")
    if ret["reviews"] == 0:
        recs.append("Start daily spaced-repetition reviews in the Revision Centre to protect what you have learned.")
    plan = db.scalar(select(StudyPlan).where(StudyPlan.profile_id == profile.id, StudyPlan.active))
    if not plan:
        recs.append("Create a study plan so your remaining time is allocated by priority.")
    else:
        missed = db.scalar(select(func.count(StudySession.id)).where(StudySession.plan_id == plan.id, StudySession.status == "missed")) or 0
        if missed >= 3:
            recs.append(f"{missed} sessions were missed — use 'Reschedule' in the Study Planner to rebalance the remaining days.")
    return recs


def time_management(db: Session, profile_id: int) -> dict:
    items = db.execute(select(MockExamItem, Question).join(Question, Question.id == MockExamItem.question_id).join(MockExam)
                       .where(MockExam.profile_id == profile_id, MockExam.status == "evaluated")).all()
    per_type: dict[str, list] = defaultdict(list)
    unattempted = 0
    for it, q in items:
        if it.time_spent_sec:
            per_type[q.qtype].append(it.time_spent_sec / max(q.marks, 0.5))
        if it.response in (None, "", []):
            unattempted += 1
    mocks = db.scalars(select(MockExam).where(MockExam.profile_id == profile_id, MockExam.status == "evaluated")).all()
    overtime = [m.id for m in mocks if m.result.get("time_used_min") and m.result["time_used_min"] >= m.duration_min * 0.99]
    issues = []
    if unattempted:
        issues.append(f"{unattempted} question(s) left unattempted across mocks.")
    if overtime:
        issues.append(f"You used the full time in {len(overtime)} mock(s) — practise pacing (target ~{'1-1.5'} min per mark).")
    return {"sec_per_mark_by_type": {k: round(sum(v) / len(v), 1) for k, v in per_type.items()}, "unattempted": unattempted, "issues": issues}


def overview(db: Session, profile: ExamProfile) -> dict:
    r = readiness(db, profile)
    minutes = db.execute(select(StudyLog.day, func.sum(StudyLog.minutes)).where(StudyLog.profile_id == profile.id).group_by(StudyLog.day)
                         .order_by(StudyLog.day)).all()
    prac = practice_accuracy(db, profile.id, days=365)
    by_topic = prac.get("by_topic", [])
    strong = [t for t in by_topic if t["accuracy"] >= 75 and t["attempts"] >= 3][-5:]
    weak = [t for t in by_topic if t["accuracy"] < 60][:8]
    # repeated mistakes: questions answered wrong more than once
    rep = db.execute(select(QuestionAttempt.question_id, func.count()).where(QuestionAttempt.profile_id == profile.id, QuestionAttempt.correct.is_(False),
                                                                            QuestionAttempt.question_id.is_not(None))
                     .group_by(QuestionAttempt.question_id).having(func.count() > 1)).all()
    rep_q = {q.id: q.text[:140] for q in db.scalars(select(Question).where(Question.id.in_([r[0] for r in rep])))} if rep else {}
    evals = db.scalars(select(Evaluation).where(Evaluation.profile_id == profile.id).order_by(Evaluation.created_at.desc()).limit(10)).all()
    return {
        **r,
        "study_minutes_by_day": [{"day": d.isoformat(), "minutes": m} for d, m in minutes][-60:],
        "total_study_hours": round(sum(m for _, m in minutes) / 60, 1),
        "strong_topics": strong, "weak_topics": weak,
        "repeated_mistakes": [{"question_id": k, "text": v, "times": dict(rep)[k]} for k, v in rep_q.items()],
        "time_management": time_management(db, profile.id),
        "recent_evaluations": [{"id": e.id, "question": e.question_text[:100], "pct": e.percentage, "at": e.created_at.isoformat()} for e in evals],
        "streak_days": streak(db, profile.id),
    }


def streak(db: Session, profile_id: int | None = None, user_profile_ids: list[int] | None = None) -> int:
    q = select(StudyLog.day).distinct()
    if profile_id:
        q = q.where(StudyLog.profile_id == profile_id)
    elif user_profile_ids is not None:
        q = q.where(StudyLog.profile_id.in_(user_profile_ids))
    days = set(db.scalars(q))
    att = select(func.date(QuestionAttempt.at)).distinct()
    att = att.where(QuestionAttempt.profile_id == profile_id) if profile_id else att.where(QuestionAttempt.profile_id.in_(user_profile_ids or []))
    for d in db.scalars(att):
        days.add(date.fromisoformat(str(d)))
    n, d = 0, date.today()
    if d not in days:
        d -= timedelta(days=1)
    while d in days:
        n += 1
        d -= timedelta(days=1)
    return n
