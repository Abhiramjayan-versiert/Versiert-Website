from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.api.deps import DB, USER
from backend.config import get_settings
from backend.models.entities import AuthSession, ExamProfile, User
from backend.security import ratelimit
from backend.security.auth import (
    CSRF_COOKIE, SESSION_COOKIE, USERNAME_RE, _load_session, audit, client_ip, create_session, destroy_session, hash_password,
    validate_password_strength, verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

INITIAL_PROFILES = [
    ("MBA Semester Examinations", "mba"),
    ("SSC Competitive Examinations", "ssc"),
    ("Other Examinations", "other"),
]


class SetupIn(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=10, max_length=256)
    display_name: str = Field("", max_length=128)


class LoginIn(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)


class ChangePwIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=256)


def _secure(request: Request) -> bool:
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"


def _set_cookies(resp: Response, request: Request, token: str, csrf: str) -> None:
    age = get_settings().session_hours * 3600
    resp.set_cookie(SESSION_COOKIE, token, max_age=age, httponly=True, samesite="strict", secure=_secure(request), path="/")
    resp.set_cookie(CSRF_COOKIE, csrf, max_age=age, httponly=False, samesite="strict", secure=_secure(request), path="/")


def _user_out(u: User) -> dict:
    return {"id": u.id, "username": u.username, "display_name": u.display_name or u.username, "active_profile_id": u.active_profile_id,
            "preferences": u.preferences or {}}


@router.get("/status")
def status(request: Request, db: Session = DB):
    n = db.scalar(select(func.count(User.id))) or 0
    s = _load_session(db, request)
    return {"setup_required": n == 0, "authenticated": bool(s), "csrf": s.csrf_token if s else None}


@router.post("/setup")
def setup(body: SetupIn, request: Request, response: Response, db: Session = DB):
    ratelimit.check(f"setup:{client_ip(request)}", 5)
    if (db.scalar(select(func.count(User.id))) or 0) > 0:
        raise HTTPException(409, "Setup already completed")
    if not USERNAME_RE.match(body.username):
        raise HTTPException(400, "Username: 3-32 letters, digits, . _ -")
    validate_password_strength(body.password)
    u = User(username=body.username, password_hash=hash_password(body.password), display_name=body.display_name or body.username)
    db.add(u)
    db.flush()
    for name, kind in INITIAL_PROFILES:
        db.add(ExamProfile(user_id=u.id, name=name, exam_type=kind, target_pct=get_settings().default_target_pct))
    db.commit()
    first = db.scalar(select(ExamProfile.id).where(ExamProfile.user_id == u.id).order_by(ExamProfile.id))
    u.active_profile_id = first
    db.commit()
    token, csrf = create_session(db, u, request)
    _set_cookies(response, request, token, csrf)
    audit(db, "setup", user_id=u.id, ip=client_ip(request))
    return {"user": _user_out(u), "csrf": csrf}


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = DB):
    ip = client_ip(request)
    ratelimit.check(f"login:{ip}", get_settings().login_rate_per_minute)
    u = db.scalar(select(User).where(User.username == body.username))
    if not u or not verify_password(body.password, u.password_hash):
        audit(db, "login_failed", detail=f"username={body.username[:64]}", ip=ip, ok=False)
        raise HTTPException(401, "Invalid username or password")
    token, csrf = create_session(db, u, request)
    _set_cookies(response, request, token, csrf)
    audit(db, "login", user_id=u.id, ip=ip)
    return {"user": _user_out(u), "csrf": csrf}


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = DB, user: User = USER):
    destroy_session(db, request.cookies.get(SESSION_COOKIE))
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    audit(db, "logout", user_id=user.id, ip=client_ip(request))
    return {"ok": True}


@router.get("/me")
def me(user: User = USER):
    return _user_out(user)


class PrefsIn(BaseModel):
    display_name: str | None = Field(None, max_length=128)
    active_profile_id: int | None = None
    preferences: dict | None = None


@router.patch("/me")
def update_me(body: PrefsIn, db: Session = DB, user: User = USER):
    if body.display_name is not None:
        user.display_name = body.display_name
    if body.active_profile_id is not None:
        p = db.get(ExamProfile, body.active_profile_id)
        if not p or p.user_id != user.id:
            raise HTTPException(404, "Profile not found")
        user.active_profile_id = p.id
    if body.preferences is not None:
        user.preferences = {**(user.preferences or {}), **body.preferences}
    db.commit()
    return _user_out(user)


@router.post("/change-password")
def change_password(body: ChangePwIn, request: Request, db: Session = DB, user: User = USER):
    ratelimit.check(f"pw:{user.id}", 5)
    if not verify_password(body.current_password, user.password_hash):
        audit(db, "password_change_failed", user_id=user.id, ip=client_ip(request), ok=False)
        raise HTTPException(400, "Current password is incorrect")
    validate_password_strength(body.new_password)
    user.password_hash = hash_password(body.new_password)
    # sign out all other sessions
    current = request.cookies.get(SESSION_COOKIE)
    from backend.security.auth import _token_hash

    for s in db.scalars(select(AuthSession).where(AuthSession.user_id == user.id)):
        if s.token_hash != _token_hash(current or ""):
            db.delete(s)
    db.commit()
    audit(db, "password_changed", user_id=user.id, ip=client_ip(request))
    return {"ok": True}


@router.get("/sessions")
def sessions(db: Session = DB, user: User = USER):
    return [{"id": s.id, "created_at": s.created_at.isoformat(), "last_seen": s.last_seen.isoformat(), "ip": s.ip, "user_agent": s.user_agent}
            for s in db.scalars(select(AuthSession).where(AuthSession.user_id == user.id).order_by(AuthSession.last_seen.desc()))]
