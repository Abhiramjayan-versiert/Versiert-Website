"""Planner, spaced repetition, mock exams (objective), readiness, analytics,
persistence and backup/restore — deterministic logic, no LLM."""
from datetime import date, timedelta

from backend.agents.revision import schedule
from backend.database.session import SessionLocal
from backend.models.entities import Question, RevisionItem


def _seed_syllabus(api, pid):
    s1 = api.post(f"/api/profiles/{pid}/syllabus/subjects", json={"name": "Financial Management", "total_marks": 100}).json()["id"]
    s2 = api.post(f"/api/profiles/{pid}/syllabus/subjects", json={"name": "Marketing Management", "total_marks": 100}).json()["id"]
    topics = {}
    for sid, names in ((s1, ["Working Capital", "Capital Budgeting", "Cost of Capital", "Ratio Analysis"]),
                       (s2, ["Marketing Mix", "Segmentation", "Consumer Behaviour"])):
        for i, n in enumerate(names):
            t = api.post(f"/api/profiles/{pid}/syllabus/topics", json={"subject_id": sid, "name": n, "marks_weight": 10 + 5 * i,
                                                                       "importance": "high" if i == 0 else "normal", "est_hours": 2,
                                                                       "difficulty": 3}).json()
            topics[n] = t["id"]
    return s1, s2, topics


def test_planner_realistic_and_reschedules(api):
    pid = api.post("/api/profiles", json={"name": "Planner exam", "exam_type": "mba", "daily_hours": 2,
                                          "exam_date": (date.today() + timedelta(days=21)).isoformat(), "study_days": [0, 1, 2, 3, 4, 5, 6]}).json()["id"]
    _seed_syllabus(api, pid)
    plan = api.post(f"/api/profiles/{pid}/plans", json={}).json()
    assert plan["active"] and plan["sessions"]
    per_day: dict = {}
    for s in plan["sessions"]:
        per_day[s["day"]] = per_day.get(s["day"], 0) + s["minutes"]
    assert max(per_day.values()) <= 120, "never exceeds the user's daily hours"
    assert date.fromisoformat(max(per_day)) < date.today() + timedelta(days=21), "ends before the exam"
    kinds = {s["kind"] for s in plan["sessions"]}
    assert {"learn", "revise", "mock"} <= kinds
    # unrealistic hours are capped
    p2 = api.post(f"/api/profiles/{pid}/plans", json={"daily_hours": 15, "days": 5}).json()
    assert any("realistic maximum" in w for w in p2["warnings"])
    # simulate a missed session in the past → reschedule
    with SessionLocal() as db:
        from backend.models.entities import StudySession

        s = db.get(StudySession, p2["sessions"][0]["id"])
        s.day = date.today() - timedelta(days=1)
        db.commit()
    new = api.post(f"/api/profiles/{pid}/plans/reschedule").json()
    assert new["id"] != p2["id"] and any("missed" in w for w in new["warnings"])
    assert all(date.fromisoformat(s["day"]) >= date.today() for s in new["sessions"])


def test_planner_requires_topics(api):
    pid = api.post("/api/profiles", json={"name": "Empty", "exam_date": (date.today() + timedelta(days=10)).isoformat()}).json()["id"]
    r = api.post(f"/api/profiles/{pid}/plans", json={})
    assert r.status_code == 400 and "topics" in r.json()["detail"]


def test_session_completion_updates_topic(api):
    pid = api.post("/api/profiles", json={"name": "Complete", "exam_date": (date.today() + timedelta(days=14)).isoformat(),
                                          "study_days": [0, 1, 2, 3, 4, 5, 6]}).json()["id"]
    _, _, topics = _seed_syllabus(api, pid)
    plan = api.post(f"/api/profiles/{pid}/plans", json={}).json()
    learn = next(s for s in plan["sessions"] if s["kind"] == "learn")
    assert api.patch(f"/api/profiles/{pid}/plans/sessions/{learn['id']}", json={"status": "done", "topic_completed": True}).status_code == 200
    tree = api.get(f"/api/profiles/{pid}/syllabus").json()
    statuses = {t["id"]: t["status"] for s in tree for t in s["topics"]}
    assert statuses[learn["topic_id"]] == "completed"


def test_sm2_schedule():
    it = RevisionItem(profile_id=1, front="f", back="b", ease=2.5, interval_days=0, repetitions=0, lapses=0, due_date=date.today())
    today = date(2026, 1, 1)
    schedule(it, 4, today)
    assert it.interval_days == 1 and it.due_date == date(2026, 1, 2)
    schedule(it, 4, today)
    assert it.interval_days == 3
    schedule(it, 2, today)  # forgotten
    assert it.interval_days == 1 and it.lapses == 1 and it.repetitions == 0
    e = it.ease
    schedule(it, 5, today)
    assert it.ease > e


def _make_objective_questions(pid, topic_id, subject_id):
    with SessionLocal() as db:
        qs = [
            Question(profile_id=pid, subject_id=subject_id, topic_id=topic_id, qtype="mcq", text="Working capital equals?", marks=1,
                     options=["CA - CL", "CA + CL", "FA - CL", "Equity"], answer={"correct": [0]}, explanation="Definition."),
            Question(profile_id=pid, subject_id=subject_id, topic_id=topic_id, qtype="true_false", text="Current ratio = CA/CL.", marks=1,
                     options=["True", "False"], answer={"correct": True}),
            Question(profile_id=pid, subject_id=subject_id, topic_id=topic_id, qtype="numerical", text="CA=500, CL=200. Working capital?", marks=2,
                     answer={"value": 300, "tolerance_pct": 1}),
            Question(profile_id=pid, subject_id=subject_id, topic_id=topic_id, qtype="msq", text="Which are current assets?", marks=2,
                     options=["Inventory", "Land", "Receivables", "Goodwill"], answer={"correct": [0, 2]}),
        ]
        db.add_all(qs)
        db.commit()
        return [q.id for q in qs]


def test_mock_exam_flow_objective(api):
    import time

    pid = api.post("/api/profiles", json={"name": "Mock exam profile"}).json()["id"]
    s1, _, topics = _seed_syllabus(api, pid)
    qids = _make_objective_questions(pid, topics["Working Capital"], s1)
    exam_id = api.post(f"/api/profiles/{pid}/mocks/from-bank", json={"title": "Obj mock", "question_ids": qids, "duration_min": 30}).json()["id"]
    v = api.post(f"/api/profiles/{pid}/mocks/{exam_id}/start").json()
    assert v["status"] == "in_progress" and v["deadline"]
    assert all("answer" not in it["question"] for it in v["items"]), "answer key hidden in exam mode"
    assert api.post(f"/api/profiles/{pid}/mocks/{exam_id}/items/{v['items'][0]['id']}/check").status_code == 403
    answers = [0, "true", "300", [0]]  # last is partial MSQ
    for it, a in zip(v["items"], answers):
        assert api.put(f"/api/profiles/{pid}/mocks/{exam_id}/items/{it['id']}", json={"response": a, "time_spent_sec": 30}).json()["saved"]
    api.put(f"/api/profiles/{pid}/mocks/{exam_id}/items/{v['items'][1]['id']}", json={"response": "true", "marked_review": True})
    tid = api.post(f"/api/profiles/{pid}/mocks/{exam_id}/submit").json()["task_id"]
    for _ in range(100):
        r = api.get(f"/api/profiles/{pid}/mocks/{exam_id}").json()
        if r["status"] == "evaluated":
            break
        time.sleep(0.1)
    assert r["status"] == "evaluated", api.get(f"/api/agents/tasks/{tid}").json()
    assert r["marks_awarded"] == 5 and r["total_marks"] == 6 and r["percentage"] == 83.3
    assert "answer" in r["items"][0]["question"], "answer key revealed after submission"
    assert api.put(f"/api/profiles/{pid}/mocks/{exam_id}/items/{v['items'][0]['id']}", json={"response": 1}).status_code == 409
    # persisted attempts feed readiness
    rd = api.get(f"/api/profiles/{pid}/readiness").json()
    assert rd["indicators"]["mock_performance"]["value"] == 83.3
    # a 6-mark quiz is too small to estimate an exam score — no verdict is given
    assert rd["estimate_pct"] is None and "not a prediction" in rd["disclaimer"]
    # wrong MSQ → mistake card due tomorrow
    with SessionLocal() as db:
        assert db.query(RevisionItem).filter(RevisionItem.profile_id == pid, RevisionItem.kind == "mistake").count() == 1


def test_readiness_estimate_from_full_mock(api):
    """A 20+ mark timed mock produces an estimate; the gap to target is computed."""
    from backend.models.entities import MockExam, utcnow

    pid = api.post("/api/profiles", json={"name": "Full mock", "target_pct": 75}).json()["id"]
    with SessionLocal() as db:
        db.add(MockExam(profile_id=pid, title="Full", mode="exam", duration_min=90, total_marks=50, status="evaluated",
                        marks_awarded=30, percentage=60.0, submitted_at=utcnow()))
        db.commit()
    r = api.get(f"/api/profiles/{pid}/readiness").json()
    assert r["estimate_pct"] == 60.0 and r["gap_pct"] == 15.0 and r["confidence"] == "low" and not r["on_track"]


def test_exam_deadline_enforced(api):
    pid = api.post("/api/profiles", json={"name": "Deadline"}).json()["id"]
    s1, _, topics = _seed_syllabus(api, pid)
    qids = _make_objective_questions(pid, topics["Working Capital"], s1)
    eid = api.post(f"/api/profiles/{pid}/mocks/from-bank", json={"title": "Timed", "question_ids": qids[:1], "duration_min": 5}).json()["id"]
    v = api.post(f"/api/profiles/{pid}/mocks/{eid}/start").json()
    with SessionLocal() as db:
        from backend.models.entities import MockExam

        m = db.get(MockExam, eid)
        m.deadline = m.deadline - timedelta(minutes=10)
        db.commit()
    r = api.put(f"/api/profiles/{pid}/mocks/{eid}/items/{v['items'][0]['id']}", json={"response": 0})
    assert r.status_code == 409 and "Time is up" in r.json()["detail"]


def test_practice_mode_reveals_and_quiz(api):
    pid = api.post("/api/profiles", json={"name": "Practice"}).json()["id"]
    s1, _, topics = _seed_syllabus(api, pid)
    qids = _make_objective_questions(pid, topics["Working Capital"], s1)
    eid = api.post(f"/api/profiles/{pid}/mocks/from-bank", json={"title": "P", "question_ids": qids, "mode": "practice"}).json()["id"]
    v = api.post(f"/api/profiles/{pid}/mocks/{eid}/start").json()
    assert "answer" in v["items"][0]["question"]
    api.put(f"/api/profiles/{pid}/mocks/{eid}/items/{v['items'][0]['id']}", json={"response": 1})
    chk = api.post(f"/api/profiles/{pid}/mocks/{eid}/items/{v['items'][0]['id']}/check").json()
    assert chk["feedback"]["correct"] is False
    quiz = api.get(f"/api/profiles/{pid}/revision/quiz", params={"n": 4}).json()
    assert len(quiz) == 4 and all("answer" not in q for q in quiz)
    res = api.post(f"/api/profiles/{pid}/revision/quiz", json={"answers": [{"question_id": q["id"], "response": None} for q in quiz]}).json()
    assert res["score"] == 0 and res["total"] == 6
    due = api.get(f"/api/profiles/{pid}/revision/due").json()
    assert due["upcoming"] >= 4  # mistake cards scheduled for tomorrow


def test_revision_review_and_retention(api, profile_id):
    item = api.post(f"/api/profiles/{profile_id}/revision/items", json={"front": "Define NPV", "back": "PV inflows - PV outflows", "kind": "definition"}).json()
    assert item["due_date"] == date.today().isoformat()
    r = api.post(f"/api/profiles/{profile_id}/revision/items/{item['id']}/review", json={"grade": 4}).json()
    assert r["due_date"] == (date.today() + timedelta(days=1)).isoformat()
    stats = api.get(f"/api/profiles/{profile_id}/revision/due").json()["stats"]
    assert stats["reviews"] == 1 and stats["recall_rate"] == 100.0


def test_readiness_without_data_does_not_guess(api):
    pid = api.post("/api/profiles", json={"name": "No data"}).json()["id"]
    r = api.get(f"/api/profiles/{pid}/readiness").json()
    assert r["estimate_pct"] is None and r["confidence"] == "insufficient data"
    assert all(v["value"] is None for v in r["indicators"].values())


def test_dashboard_and_analytics(api, profile_id):
    d = api.get("/api/dashboard").json()
    assert "profiles" in d and "streak_days" in d
    a = api.get(f"/api/profiles/{profile_id}/analytics").json()
    assert "indicators" in a and "time_management" in a


def test_backup_verify_restore_roundtrip(api, profile_id, tmp_path):
    from backend.services import backup

    p = backup.create_backup(include_vectors=True)
    v = backup.verify_backup(p)
    assert v["ok"], v["problems"]
    # tamper → detected
    import zipfile

    bad = tmp_path / "bad.zip"
    with zipfile.ZipFile(p) as zin, zipfile.ZipFile(bad, "w") as zout:
        for n in zin.namelist():
            data = zin.read(n)
            zout.writestr(n, data + b"x" if n == "config/settings.json" else data)
    assert not backup.verify_backup(bad)["ok"]
    assert api.get("/api/backups").json()[0]["name"].startswith("examcoach-backup-")
    import pytest

    with pytest.raises(SystemExit):
        backup.restore_backup(p, yes=False)  # requires explicit confirmation


def test_export_profile_json(api, profile_id):
    r = api.get(f"/api/profiles/{profile_id}/export")
    assert r.status_code == 200 and r.json()["profile"]["id"] == profile_id


def test_db_health(api):
    h = api.get("/api/system/db-health").json()
    assert h["database"]["ok"] and h["database"]["integrity"] == "ok"


def test_tool_registry_controls():
    import asyncio

    import backend.agents.orchestrator  # noqa: F401 registers tools
    from backend.agents.runtime import ApprovalRequired, Tracker, registry

    names = {t["name"] for t in registry.describe()}
    assert "delete_document" in names and not any("shell" in n or "powershell" in n for n in names)
    tr = Tracker("tutor", "test")
    import pytest

    with pytest.raises(PermissionError):  # tutor may not create plans
        asyncio.run(registry.call(tr, "create_study_plan", {"profile_id": 1}, tracker=tr))
    with pytest.raises(PermissionError):
        asyncio.run(registry.call(tr, "run_powershell", {}, tracker=tr))
    tr2 = Tracker("librarian", "test")
    with pytest.raises(ApprovalRequired):  # destructive tools need approval
        asyncio.run(registry.call(tr2, "delete_document", {"profile_id": 1, "document_id": 1}, tracker=tr2))
    with pytest.raises(ValueError):  # input validation
        asyncio.run(registry.call(tr, "teach_lesson", {"profile_id": 1, "topic": ""}, tracker=tr))
