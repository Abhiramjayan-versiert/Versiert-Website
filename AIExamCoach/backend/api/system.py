from __future__ import annotations

import json
import socket
from datetime import date, datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ValidationError
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from backend.api.deps import DB, USER
from backend.config import BACKUP_DIR, get_settings, update_settings
from backend.database.session import health_check
from backend.evaluation import ocr
from backend.models import entities as E
from backend.rag import store
from backend.security.auth import audit, client_ip, get_profile
from backend.security.files import safe_join
from backend.services import backup, ollama

router = APIRouter(prefix="/api", tags=["system"])
START = datetime.now()


@router.get("/health")
async def health():
    """Unauthenticated liveness probe — reveals no data."""
    try:
        await ollama.version()
        ai = True
    except Exception:  # noqa: BLE001
        ai = False
    return {"ok": True, "ollama": ai, "time": datetime.now().isoformat(timespec="seconds")}


def lan_addresses() -> list[str]:
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                ips.add(ip)
    except OSError:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))  # no packet is sent; picks the LAN interface
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return sorted(ips)


@router.get("/system/status")
async def status(user=USER):
    s = get_settings()
    try:
        ver = await ollama.version()
        models = await ollama.running_models()
    except Exception as e:  # noqa: BLE001
        ver, models = None, []
        err = str(e)
    else:
        err = ""
    ips = lan_addresses()
    urls = [f"http://127.0.0.1:{s.port}"]
    if s.access_mode == "lan":
        urls += [f"http://{ip}:{s.port}" for ip in ips if not ip.startswith("100.")]
    if s.access_mode == "tailscale":
        urls += ["https://<your-pc-name>.<tailnet>.ts.net (see Settings → Remote access)"]
    return {"uptime_s": int((datetime.now() - START).total_seconds()), "access_mode": s.access_mode, "port": s.port, "urls": urls,
            "lan_ips": ips, "tailscale_ips": [ip for ip in ips if ip.startswith("100.")],
            "ollama": {"available": ver is not None, "version": ver, "error": err, "loaded": [m.get("name") for m in models]},
            "database": health_check(), "vector_store": store.stats(), "ocr": {"available": ocr.available(), "path": ocr.tesseract_path()},
            "local_only_ai": s.local_only_ai}


@router.get("/settings")
def get_s(user=USER):
    return get_settings().model_dump()


@router.patch("/settings")
def patch_s(changes: dict, request: Request, db: Session = DB, user=USER):
    forbidden = {"local_only_ai", "ollama_url"} & set(changes)
    if forbidden:
        raise HTTPException(400, f"{', '.join(sorted(forbidden))} cannot be changed from the web interface")
    try:
        s = update_settings(changes)
    except ValidationError as e:
        raise HTTPException(400, str(e.errors()[:3]))
    audit(db, "settings_changed", user_id=user.id, detail=json.dumps(changes)[:500], ip=client_ip(request))
    restart = {"port", "access_mode"} & set(changes)
    return {"settings": s.model_dump(), "restart_required": bool(restart)}


@router.get("/audit")
def audit_log(limit: int = 200, db: Session = DB, user=USER):
    rows = db.scalars(select(E.AuditLog).order_by(E.AuditLog.id.desc()).limit(min(limit, 1000))).all()
    return [{"at": r.at.isoformat(), "action": r.action, "detail": r.detail, "ip": r.ip, "ok": r.ok} for r in rows]


@router.get("/system/db-health")
def db_health(user=USER):
    return {"database": health_check(), "vector_store": store.stats()}


@router.get("/backups")
def backups(user=USER):
    return backup.list_backups()


@router.post("/backups")
def make_backup(request: Request, include_vectors: bool = True, db: Session = DB, user=USER):
    p = backup.create_backup(include_vectors)
    audit(db, "backup_created", user_id=user.id, detail=p.name, ip=client_ip(request))
    return {"name": p.name, "size_mb": round(p.stat().st_size / 2**20, 2)}


@router.get("/backups/{name}")
def download_backup(name: str, user=USER):
    if not name.startswith("examcoach-backup-") or not name.endswith(".zip"):
        raise HTTPException(400, "Invalid backup name")
    p = safe_join(BACKUP_DIR, name)
    if not p.exists():
        raise HTTPException(404, "Backup not found")
    return FileResponse(p, filename=name, headers={"Cache-Control": "private, no-store"})


def _row(o) -> dict:
    out = {}
    for c in inspect(o).mapper.column_attrs:
        v = getattr(o, c.key)
        out[c.key] = v.isoformat() if isinstance(v, (date, datetime)) else v
    return out


@router.get("/profiles/{profile_id}/export")
def export_profile(profile_id: int, db: Session = DB, user=USER):
    """Full JSON export of one exam profile (portable, human-readable)."""
    p = get_profile(db, user, profile_id)
    data = {"exported_at": datetime.now().isoformat(), "profile": _row(p)}
    for name, model in [("subjects", E.Subject), ("topics", E.Topic), ("documents", E.Document), ("study_plans", E.StudyPlan),
                        ("study_sessions", E.StudySession), ("questions", E.Question), ("question_attempts", E.QuestionAttempt),
                        ("mock_exams", E.MockExam), ("evaluations", E.Evaluation), ("revision_items", E.RevisionItem),
                        ("revision_logs", E.RevisionLog), ("study_logs", E.StudyLog)]:
        data[name] = [_row(r) for r in db.scalars(select(model).where(model.profile_id == profile_id))]
    data["mock_exam_items"] = [_row(r) for r in db.scalars(select(E.MockExamItem).join(E.MockExam).where(E.MockExam.profile_id == profile_id))]
    body = json.dumps(data, indent=1, default=str)
    fname = f"examcoach-export-{profile_id}-{date.today().isoformat()}.json"
    return Response(body, media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{fname}"'})
