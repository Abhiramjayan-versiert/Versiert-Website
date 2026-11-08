"""SQLite engine/session. SQLite is the single source of truth."""
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from backend.config import DB_DIR, ensure_dirs


class Base(DeclarativeBase):
    pass


def _db_url() -> str:
    override = os.environ.get("AEC_DATABASE_URL")
    if override:
        return override
    ensure_dirs()
    return f"sqlite:///{(DB_DIR / 'examcoach.db').as_posix()}"


engine = create_engine(_db_url(), connect_args={"check_same_thread": False, "timeout": 30}, future=True)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _):  # pragma: no cover - trivial
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def db_session() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db() -> None:
    from backend.models import entities  # noqa: F401  (register models)

    Base.metadata.create_all(engine)


def health_check() -> dict:
    with engine.connect() as conn:
        integrity = conn.execute(text("PRAGMA integrity_check")).scalar()
        tables = conn.execute(text("SELECT count(*) FROM sqlite_master WHERE type='table'")).scalar()
    return {"ok": integrity == "ok", "integrity": integrity, "tables": tables, "url": str(engine.url).split("///")[-1]}
