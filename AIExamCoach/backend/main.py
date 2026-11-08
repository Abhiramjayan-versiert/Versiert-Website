"""AI Exam Coach — FastAPI application.

Serves the JSON API under /api and the pre-built Next.js frontend (static
export) from frontend/out on the same origin, so a single port is used for
local, LAN and Tailscale access. Ollama (port 11434) is never proxied."""
from __future__ import annotations

import logging
import logging.handlers
import mimetypes
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse

from backend.config import FRONTEND_DIST, LOG_DIR, ensure_dirs, get_settings
from backend.database.session import SessionLocal, init_db
from backend.rag import ingest

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("image/svg+xml", ".svg")
ensure_dirs()
_handler = logging.handlers.RotatingFileHandler(LOG_DIR / "backend.log", maxBytes=5_000_000, backupCount=3, encoding="utf-8")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", handlers=[_handler, logging.StreamHandler()])
log = logging.getLogger("aec")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # tasks that were running when the app stopped can't be resumed
    from backend.models.entities import AgentTask, Document, MockExam, utcnow

    with SessionLocal() as db:
        for t in db.query(AgentTask).filter(AgentTask.status.in_(["running", "queued"])):
            t.status, t.error, t.finished_at = "failed", "Interrupted by application restart", utcnow()
        for m in db.query(MockExam).filter(MockExam.status == "evaluating"):
            m.status = "submitted"  # can be re-evaluated from the Mock Exams page
        db.commit()
        from backend.security.auth import cleanup_expired

        cleanup_expired(db)
    ingest.start_worker()
    for doc_id in ingest.pending_documents():
        ingest.enqueue(doc_id)
    log.info("AI Exam Coach started (mode=%s, port=%s)", get_settings().access_mode, get_settings().port)
    yield
    await ingest.stop_worker()


def create_app() -> FastAPI:
    app = FastAPI(title="AI Exam Coach", version="1.0.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    from backend.api import agents, analytics, auth, chat, documents, evaluation, mocks, models, planner, profiles, questions, revision, syllabus, system

    for r in (auth, profiles, syllabus, documents, chat, planner, questions, mocks, evaluation, revision, analytics, agents, models, system):
        app.include_router(r.router)

    max_body = (get_settings().max_upload_mb + 2) * 1024 * 1024

    @app.middleware("http")
    async def security(request: Request, call_next):
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > max_body:
            return JSONResponse({"detail": "Request too large"}, status_code=413)
        resp = await call_next(request)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "same-origin"
        resp.headers["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()"
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; "
            "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        )
        if request.url.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.exception_handler(RequestValidationError)
    async def _val(_: Request, exc: RequestValidationError):
        errs = [{"loc": e.get("loc"), "msg": e.get("msg")} for e in exc.errors()[:5]]
        friendly = []
        for e in exc.errors()[:3]:
            field = str(e.get("loc", ["", "value"])[-1]).replace("_", " ")
            ctx = e.get("ctx") or {}
            if e.get("type") == "string_too_short":
                friendly.append(f"{field.capitalize()} must be at least {ctx.get('min_length')} characters.")
            elif e.get("type") == "string_too_long":
                friendly.append(f"{field.capitalize()} must be at most {ctx.get('max_length')} characters.")
            else:
                friendly.append(f"{field.capitalize()}: {e.get('msg')}.")
        return JSONResponse({"detail": " ".join(friendly) or "Invalid input", "errors": errs}, status_code=422)

    @app.exception_handler(Exception)
    async def _err(_: Request, exc: Exception):
        log.exception("Unhandled error")
        return JSONResponse({"detail": "Internal error — see logs/backend.log"}, status_code=500)

    # ---------------- static frontend (Next.js export) ----------------
    dist = Path(FRONTEND_DIST)

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def frontend(full_path: str):
        if full_path.startswith("api/") or full_path == "api":
            raise HTTPException(404, "Not found")
        if not dist.exists():
            return JSONResponse({"detail": "Frontend not built. Run scripts\\install.ps1 (or `npm run build` in frontend/)."}, status_code=503)
        base = dist.resolve()
        candidates = [full_path, f"{full_path}/index.html", f"{full_path}.html", "index.html" if not full_path else None]
        for c in candidates:
            if not c:
                continue
            p = (base / c).resolve()
            if (p == base or base in p.parents) and p.is_file():
                headers = {"Cache-Control": "public, max-age=31536000, immutable"} if "/_next/static/" in f"/{c}" else {"Cache-Control": "no-cache"}
                return FileResponse(p, headers=headers)
        nf = base / "404.html"
        return FileResponse(nf, status_code=404) if nf.exists() else JSONResponse({"detail": "Not found"}, status_code=404)

    return app


app = create_app()


def bind_host() -> str:
    mode = get_settings().access_mode
    # local_only and tailscale (Tailscale Serve proxies to localhost) bind loopback only.
    return "0.0.0.0" if mode == "lan" else "127.0.0.1"


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host=os.environ.get("AEC_HOST", bind_host()), port=int(os.environ.get("AEC_PORT", get_settings().port)),
                proxy_headers=True, forwarded_allow_ips="127.0.0.1", log_level="info")
