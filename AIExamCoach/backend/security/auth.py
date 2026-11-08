"""Authentication: Argon2 password hashing, server-side sessions (only a hash
of the session token is stored), CSRF double-submit tokens, audit logging."""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.config import get_secret_key, get_settings
from backend.database.session import get_db
from backend.models.entities import AuditLog, AuthSession, ExamProfile, User, utcnow

SESSION_COOKIE = "aec_session"
CSRF_COOKIE = "aec_csrf"
CSRF_HEADER = "x-csrf-token"

_ph = PasswordHasher()
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, pw)
    except (VerifyMismatchError, InvalidHashError):
        return False


def validate_password_strength(pw: str) -> None:
    if len(pw) < 10:
        raise HTTPException(400, "Password must be at least 10 characters.")
    if pw.lower() == pw or pw.upper() == pw or not re.search(r"\d", pw):
        raise HTTPException(400, "Password must mix upper/lower case letters and include a number.")


def _token_hash(token: str) -> str:
    return hmac.new(get_secret_key().encode(), token.encode(), hashlib.sha256).hexdigest()


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


def audit(db: Session, action: str, *, user_id: int | None = None, detail: str = "", ip: str = "", ok: bool = True) -> None:
    db.add(AuditLog(action=action, user_id=user_id, detail=detail[:2000], ip=ip, ok=ok))
    db.commit()


def create_session(db: Session, user: User, request: Request) -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    db.add(AuthSession(
        user_id=user.id, token_hash=_token_hash(token), csrf_token=csrf,
        expires_at=utcnow() + timedelta(hours=get_settings().session_hours),
        ip=client_ip(request), user_agent=(request.headers.get("user-agent") or "")[:250],
    ))
    db.commit()
    return token, csrf


def destroy_session(db: Session, token: str | None) -> None:
    if not token:
        return
    s = db.scalar(select(AuthSession).where(AuthSession.token_hash == _token_hash(token)))
    if s:
        db.delete(s)
        db.commit()


def _load_session(db: Session, request: Request) -> AuthSession | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    s = db.scalar(select(AuthSession).where(AuthSession.token_hash == _token_hash(token)))
    if not s or s.expires_at < utcnow():
        if s:
            db.delete(s)
            db.commit()
        return None
    if (utcnow() - s.last_seen) > timedelta(minutes=5):
        s.last_seen = utcnow()
        db.commit()
    return s


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    s = _load_session(db, request)
    if not s:
        raise HTTPException(401, "Not signed in")
    # CSRF: every state-changing request must echo the per-session token.
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        sent = request.headers.get(CSRF_HEADER, "")
        if not sent or not hmac.compare_digest(sent, s.csrf_token):
            raise HTTPException(403, "CSRF token missing or invalid")
    user = db.get(User, s.user_id)
    if not user:
        raise HTTPException(401, "Not signed in")
    request.state.user_id = user.id
    return user


def get_profile(db: Session, user: User, profile_id: int) -> ExamProfile:
    """Authorization: a profile is only reachable by its owner."""
    p = db.get(ExamProfile, profile_id)
    if not p or p.user_id != user.id:
        raise HTTPException(404, "Exam profile not found")
    return p


def cleanup_expired(db: Session) -> int:
    rows = db.scalars(select(AuthSession).where(AuthSession.expires_at < datetime.utcnow())).all()
    for r in rows:
        db.delete(r)
    db.commit()
    return len(rows)
