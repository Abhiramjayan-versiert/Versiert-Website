"""Test configuration. Each test session gets an isolated data directory so
tests never touch real user data."""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="aec-test-"))
os.environ["AEC_DATA_DIR"] = str(_TMP / "data")
os.environ["AEC_CONFIG_DIR"] = str(_TMP / "config")
os.environ["AEC_LOG_DIR"] = str(_TMP / "logs")
os.environ["AEC_FRONTEND_DIST"] = str(_TMP / "frontend_out")
(_TMP / "frontend_out").mkdir(parents=True)
(_TMP / "frontend_out" / "index.html").write_text("<html>ok</html>")
(_TMP / "secret.txt").write_text("top secret")

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402
from backend.security import ratelimit  # noqa: E402

PASSWORD = "CorrectHorse42battery"


def ollama_up() -> bool:
    import httpx

    try:
        return httpx.get("http://127.0.0.1:11434/api/version", timeout=2, trust_env=False).status_code == 200
    except Exception:  # noqa: BLE001
        return False


requires_ollama = pytest.mark.skipif(not ollama_up(), reason="Ollama is not running")


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c
    shutil.rmtree(_TMP, ignore_errors=True)


class Authed:
    """TestClient wrapper that sends the CSRF header."""

    def __init__(self, c: TestClient, csrf: str):
        self.c, self.csrf = c, csrf

    def _h(self, kw):
        kw.setdefault("headers", {})["X-CSRF-Token"] = self.csrf
        return kw

    def get(self, url, **kw):
        return self.c.get(url, **kw)

    def post(self, url, **kw):
        return self.c.post(url, **self._h(kw))

    def put(self, url, **kw):
        return self.c.put(url, **self._h(kw))

    def patch(self, url, **kw):
        return self.c.patch(url, **self._h(kw))

    def delete(self, url, **kw):
        return self.c.delete(url, **self._h(kw))


@pytest.fixture(scope="session")
def api(client) -> Authed:
    ratelimit.reset()
    st = client.get("/api/auth/status").json()
    if st["setup_required"]:
        r = client.post("/api/auth/setup", json={"username": "student", "password": PASSWORD, "display_name": "Student"})
        assert r.status_code == 200, r.text
        csrf = r.json()["csrf"]
    else:
        r = client.post("/api/auth/login", json={"username": "student", "password": PASSWORD})
        csrf = r.json()["csrf"]
    return Authed(client, csrf)


@pytest.fixture(scope="session")
def profile_id(api) -> int:
    r = api.post("/api/profiles", json={"name": "Test MBA", "exam_type": "mba", "daily_hours": 3})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def wait_task(api, task_id: int, timeout: float = 900) -> dict:
    import time

    t0 = time.time()
    while time.time() - t0 < timeout:
        t = api.get(f"/api/agents/tasks/{task_id}").json()
        if t["status"] not in ("running", "queued"):
            return t
        time.sleep(1)
    raise TimeoutError(f"task {task_id} did not finish")
