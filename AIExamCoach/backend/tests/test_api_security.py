"""Authentication, CSRF, authorization/isolation, upload validation, path
traversal, rate limiting and local-only AI enforcement."""
import io

import pytest
from pydantic import ValidationError

from backend.config import Settings
from backend.security import ratelimit
from backend.tests.conftest import PASSWORD


def test_requires_login(client):
    fresh = client.__class__(client.app)
    assert fresh.get("/api/profiles").status_code == 401
    assert fresh.get("/api/dashboard").status_code == 401


def test_setup_only_once(api, client):
    r = client.post("/api/auth/setup", json={"username": "intruder", "password": "Another1Password"})
    assert r.status_code == 409


def test_initial_profiles_created(api):
    names = [p["name"] for p in api.get("/api/profiles").json()]
    for n in ("MBA Semester Examinations", "SSC Competitive Examinations", "Other Examinations"):
        assert n in names


def test_csrf_required_for_writes(api, client):
    r = client.post("/api/profiles", json={"name": "No CSRF"})  # cookie present but no header
    assert r.status_code == 403
    r = client.post("/api/profiles", json={"name": "Bad CSRF"}, headers={"X-CSRF-Token": "wrong"})
    assert r.status_code == 403


def test_password_hashed_and_wrong_login(client, api):
    from backend.database.session import SessionLocal
    from backend.models.entities import User

    with SessionLocal() as db:
        u = db.query(User).first()
        assert u.password_hash.startswith("$argon2") and PASSWORD not in u.password_hash
    ratelimit.reset()
    other = client.__class__(client.app)
    assert other.post("/api/auth/login", json={"username": "student", "password": "wrong"}).status_code == 401


def test_login_rate_limited(client):
    ratelimit.reset()
    other = client.__class__(client.app)
    codes = [other.post("/api/auth/login", json={"username": "x", "password": "y"}).status_code for _ in range(12)]
    assert 429 in codes
    ratelimit.reset()


def test_weak_password_rejected():
    from fastapi import HTTPException

    from backend.security.auth import validate_password_strength

    with pytest.raises(HTTPException):
        validate_password_strength("password")


def test_profile_crud_archive_delete(api):
    p = api.post("/api/profiles", json={"name": "Temp Exam", "exam_type": "other", "exam_date": "2030-01-10", "target_pct": 80}).json()
    assert p["target_pct"] == 80 and p["days_left"] > 0
    assert api.patch(f"/api/profiles/{p['id']}", json={"archived": True}).json()["archived"]
    assert p["id"] not in [x["id"] for x in api.get("/api/profiles").json()]
    assert api.delete(f"/api/profiles/{p['id']}").status_code == 400  # needs confirm
    assert api.delete(f"/api/profiles/{p['id']}", params={"confirm": "Temp Exam"}).status_code == 200


def test_profiles_isolated_between_users(api, client, profile_id):
    """A second account cannot see or touch the first account's profile."""
    from backend.database.session import SessionLocal
    from backend.models.entities import ExamProfile, User
    from backend.security.auth import hash_password

    with SessionLocal() as db:
        u = User(username="other", password_hash=hash_password("OtherUser123pass"))
        db.add(u)
        db.commit()
        db.add(ExamProfile(user_id=u.id, name="Other's exam"))
        db.commit()
    ratelimit.reset()
    other = client.__class__(client.app)
    csrf = other.post("/api/auth/login", json={"username": "other", "password": "OtherUser123pass"}).json()["csrf"]
    assert other.get(f"/api/profiles/{profile_id}").status_code == 404
    assert other.get(f"/api/profiles/{profile_id}/documents").status_code == 404
    assert other.post(f"/api/profiles/{profile_id}/syllabus/subjects", json={"name": "x"}, headers={"X-CSRF-Token": csrf}).status_code == 404
    assert "Test MBA" not in [p["name"] for p in other.get("/api/profiles").json()]


def test_upload_validation(api, profile_id):
    bad = api.post(f"/api/profiles/{profile_id}/documents", files={"file": ("evil.exe", b"MZ\x90", "application/octet-stream")})
    assert bad.status_code == 415
    spoof = api.post(f"/api/profiles/{profile_id}/documents", files={"file": ("fake.pdf", b"not a pdf at all", "application/pdf")})
    assert spoof.status_code == 415
    empty = api.post(f"/api/profiles/{profile_id}/documents", files={"file": ("e.txt", b"", "text/plain")})
    assert empty.status_code == 400


def test_upload_filename_traversal_neutralised(api, profile_id):
    r = api.post(f"/api/profiles/{profile_id}/documents", files={"file": ("../../../etc/passwd.txt", b"harmless text content here", "text/plain")},
                 data={"category": "notes"})
    assert r.status_code == 200
    d = r.json()
    assert "/" not in d["display_name"] and ".." not in d["display_name"].split(".")[0]
    from backend.config import DOCUMENTS_DIR
    from backend.database.session import SessionLocal
    from backend.models.entities import Document

    with SessionLocal() as db:
        doc = db.get(Document, d["id"])
        assert (DOCUMENTS_DIR / str(profile_id) / doc.stored_name).exists()
        assert len(doc.stored_name) == 36  # uuid hex + ext, never user-controlled


def test_static_path_traversal_blocked(client):
    for p in ("/../secret.txt", "/..%2fsecret.txt", "/%2e%2e/secret.txt", "/../../data/database/examcoach.db"):
        r = client.get(p)
        assert "top secret" not in r.text and r.status_code in (404, 400)


def test_data_dirs_not_served(client):
    for p in ("/data/database/examcoach.db", "/database/examcoach.db", "/vector_store/chroma.sqlite3", "/config/settings.json"):
        r = client.get(p)
        assert r.status_code == 404


def test_local_only_enforced():
    with pytest.raises(ValidationError):
        Settings(ollama_url="http://192.168.1.10:11434")
    with pytest.raises(ValidationError):
        Settings(ollama_url="https://api.openai.com")
    with pytest.raises(ValidationError):
        Settings(local_only_ai=False)
    with pytest.raises(ValidationError):
        Settings(chat_model="gpt-oss:120b-cloud")
    assert Settings(ollama_url="http://localhost:11434").ollama_url == "http://localhost:11434"


def test_settings_api_cannot_disable_local_only(api):
    assert api.patch("/api/settings", json={"local_only_ai": False}).status_code == 400
    assert api.patch("/api/settings", json={"ollama_url": "http://10.0.0.5:11434"}).status_code == 400
    assert api.patch("/api/settings", json={"context_length": 100}).status_code == 400
    r = api.patch("/api/settings", json={"context_length": 4096})
    assert r.status_code == 200


def test_no_cloud_ai_in_codebase():
    """Static guard: no cloud LLM SDKs or endpoints anywhere in the backend."""
    from pathlib import Path

    banned = ["api.openai.com", "api.anthropic.com", "generativelanguage.googleapis", "api.groq.com", "openrouter.ai",
              "import openai", "import anthropic", "google.generativeai"]
    root = Path(__file__).resolve().parents[1]
    for f in root.rglob("*.py"):
        if "tests" in f.parts:
            continue
        txt = f.read_text(encoding="utf-8")
        for b in banned:
            assert b not in txt, f"{b} found in {f}"


def test_cloud_model_pull_blocked():
    from backend.services.model_manager import check_capacity

    assert check_capacity("gpt-oss:120b-cloud")["decision"] == "blocked"
    assert check_capacity("qwen3:8b")["decision"] in ("needs_approval", "blocked")
    assert check_capacity("llama3.1:70b")["decision"] == "blocked"


def test_audit_log_records_events(api):
    actions = {a["action"] for a in api.get("/api/audit").json()}
    assert "setup" in actions or "login" in actions


def test_security_headers(client):
    r = client.get("/api/health")
    assert r.headers["X-Frame-Options"] == "DENY" and "default-src 'self'" in r.headers["Content-Security-Policy"]
