"""User management (administrator only). Each user has their own exam
profiles and data; nobody can see another user's data."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.api.auth import seed_profiles
from backend.api.deps import DB
from backend.models.entities import AuthSession, Document, ExamProfile, User
from backend.rag import ingest, store
from backend.rag.retrieve import clear_cache
from backend.security.auth import USERNAME_RE, audit, client_ip, hash_password, is_disabled, require_admin, validate_password_strength

router = APIRouter(prefix="/api/users", tags=["users"])
ADMIN = Depends(require_admin)


def out(db: Session, u: User) -> dict:
    last = db.scalar(select(func.max(AuthSession.last_seen)).where(AuthSession.user_id == u.id))
    return {"id": u.id, "username": u.username, "display_name": u.display_name or u.username, "is_admin": bool(u.is_admin),
            "disabled": is_disabled(u), "must_change_password": bool((u.preferences or {}).get("must_change_password")),
            "created_at": u.created_at.isoformat(), "last_seen": last.isoformat() if last else None,
            "profiles": db.scalar(select(func.count(ExamProfile.id)).where(ExamProfile.user_id == u.id)) or 0}


def _admins(db: Session) -> list[User]:
    return [u for u in db.scalars(select(User).where(User.is_admin.is_(True))) if not is_disabled(u)]


def _sign_out(db: Session, u: User) -> None:
    for s in db.scalars(select(AuthSession).where(AuthSession.user_id == u.id)):
        db.delete(s)


@router.get("")
def list_users(db: Session = DB, admin: User = ADMIN):
    return [out(db, u) for u in db.scalars(select(User).order_by(User.id))]


class NewUser(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    display_name: str = Field("", max_length=128)
    password: str = Field(min_length=10, max_length=256)
    is_admin: bool = False


@router.post("")
def create(body: NewUser, request: Request, db: Session = DB, admin: User = ADMIN):
    if not USERNAME_RE.match(body.username):
        raise HTTPException(400, "Username: 3-32 letters, digits, . _ - (no spaces)")
    if db.scalar(select(User).where(func.lower(User.username) == body.username.lower())):
        raise HTTPException(409, "That username is already taken")
    validate_password_strength(body.password)
    u = User(username=body.username, display_name=body.display_name or body.username, password_hash=hash_password(body.password),
             is_admin=body.is_admin, preferences={"must_change_password": True})
    db.add(u)
    db.flush()
    seed_profiles(db, u)
    db.commit()
    audit(db, "user_created", user_id=admin.id, detail=f"{u.username} admin={u.is_admin}", ip=client_ip(request))
    return out(db, u)


class PatchUser(BaseModel):
    display_name: str | None = Field(None, max_length=128)
    is_admin: bool | None = None
    disabled: bool | None = None
    reset_password: str | None = Field(None, min_length=10, max_length=256)


@router.patch("/{user_id}")
def update(user_id: int, body: PatchUser, request: Request, db: Session = DB, admin: User = ADMIN):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    if u.id == admin.id and (body.disabled or body.is_admin is False):
        raise HTTPException(400, "You cannot disable or demote your own account.")
    if body.display_name is not None:
        u.display_name = body.display_name
    if body.is_admin is not None:
        if not body.is_admin and u.is_admin and len(_admins(db)) <= 1:
            raise HTTPException(400, "There must be at least one administrator.")
        u.is_admin = body.is_admin
    prefs = dict(u.preferences or {})
    if body.disabled is not None:
        prefs["disabled"] = body.disabled
        if body.disabled:
            _sign_out(db, u)  # disabling signs the user out everywhere immediately
    if body.reset_password:
        validate_password_strength(body.reset_password)
        u.password_hash = hash_password(body.reset_password)
        prefs["must_change_password"] = True
        _sign_out(db, u)
    u.preferences = prefs
    db.commit()
    audit(db, "user_updated", user_id=admin.id,
          detail=f"{u.username}: " + ", ".join(k for k, v in body.model_dump(exclude_unset=True).items() if k != "reset_password" or v) ,
          ip=client_ip(request))
    return out(db, u)


@router.delete("/{user_id}")
def delete(user_id: int, request: Request, confirm: str = "", db: Session = DB, admin: User = ADMIN):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    if u.id == admin.id:
        raise HTTPException(400, "You cannot delete your own account.")
    if confirm != u.username:
        raise HTTPException(400, "To delete, pass confirm=<exact username>. This permanently deletes all of the user's data.")
    for p in db.scalars(select(ExamProfile).where(ExamProfile.user_id == u.id)):
        for d in db.scalars(select(Document).where(Document.profile_id == p.id)):
            ingest.doc_path(d).unlink(missing_ok=True)
        store.delete_profile(p.id)
        clear_cache(p.id)
        db.delete(p)
    _sign_out(db, u)
    db.delete(u)
    db.commit()
    audit(db, "user_deleted", user_id=admin.id, detail=u.username, ip=client_ip(request))
    return {"deleted": user_id}
