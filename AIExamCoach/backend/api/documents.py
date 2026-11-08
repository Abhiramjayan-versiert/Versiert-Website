from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.deps import DB, USER
from backend.config import DOCUMENTS_DIR, get_settings
from backend.models.entities import Chunk, Document, Subject, User
from backend.rag import ingest, store
from backend.rag.extract import page_count
from backend.rag.retrieve import clear_cache, retrieve
from backend.security.auth import audit, client_ip, get_profile
from backend.security.files import safe_display_name, safe_join, save_upload

router = APIRouter(prefix="/api/profiles/{profile_id}/documents", tags=["documents"])
CATEGORIES = {"syllabus", "textbook", "notes", "past_paper", "marking_scheme", "other"}


def doc_out(d: Document) -> dict:
    return {"id": d.id, "display_name": d.display_name, "original_name": d.original_name, "file_type": d.file_type, "category": d.category,
            "subject_id": d.subject_id, "size_bytes": d.size_bytes, "pages": d.pages, "status": d.status, "error": d.error,
            "chunk_count": d.chunk_count, "ocr_pages": d.ocr_pages, "embedding_model": d.embedding_model,
            "uploaded_at": d.uploaded_at.isoformat(), "indexed_at": d.indexed_at.isoformat() if d.indexed_at else None}


def _doc(db: Session, profile_id: int, doc_id: int) -> Document:
    d = db.get(Document, doc_id)
    if not d or d.profile_id != profile_id:
        raise HTTPException(404, "Document not found")
    return d


def _subject(db: Session, profile_id: int, subject_id: int | None) -> int | None:
    if not subject_id:
        return None
    s = db.get(Subject, subject_id)
    if not s or s.profile_id != profile_id:
        raise HTTPException(400, "Subject does not belong to this profile")
    return s.id


@router.get("")
def list_docs(profile_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    return [doc_out(d) for d in db.scalars(select(Document).where(Document.profile_id == profile_id).order_by(Document.uploaded_at.desc()))]


@router.post("")
async def upload(profile_id: int, request: Request, file: UploadFile = File(...), category: str = Form("notes"),
                 subject_id: int | None = Form(None), db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    if category not in CATEGORIES:
        raise HTTPException(400, f"category must be one of {sorted(CATEGORIES)}")
    sid = _subject(db, profile_id, subject_id)
    info = await save_upload(file, DOCUMENTS_DIR / str(profile_id), get_settings().max_upload_mb)
    dup = db.scalar(select(Document).where(Document.profile_id == profile_id, Document.sha256 == info["sha256"]))
    if dup:
        info["path"].unlink(missing_ok=True)
        raise HTTPException(409, f"This file is already in the library as '{dup.display_name}'")
    try:
        pages = page_count(info["path"], info["ext"])
    except Exception:  # noqa: BLE001
        info["path"].unlink(missing_ok=True)
        raise HTTPException(415, "The file could not be opened — it may be corrupt or password-protected.")
    d = Document(profile_id=profile_id, subject_id=sid, display_name=info["original"], original_name=info["original"], stored_name=info["stored"],
                 file_type=info["ext"], category=category, size_bytes=info["size"], sha256=info["sha256"], pages=pages)
    db.add(d)
    db.commit()
    ingest.enqueue(d.id)
    audit(db, "document_uploaded", user_id=user.id, detail=f"{d.id}:{d.display_name}", ip=client_ip(request))
    return doc_out(d)


class DocPatch(BaseModel):
    display_name: str | None = Field(None, min_length=1, max_length=200)
    category: str | None = None
    subject_id: int | None = None
    clear_subject: bool = False


@router.patch("/{doc_id}")
def update(profile_id: int, doc_id: int, body: DocPatch, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    d = _doc(db, profile_id, doc_id)
    if body.display_name:
        d.display_name = safe_display_name(body.display_name)
    if body.category:
        if body.category not in CATEGORIES:
            raise HTTPException(400, "Invalid category")
        d.category = body.category
    if body.clear_subject:
        d.subject_id = None
    elif body.subject_id is not None:
        d.subject_id = _subject(db, profile_id, body.subject_id)
    db.commit()
    if body.display_name or body.subject_id is not None or body.clear_subject:
        d.status = "queued"  # metadata in the vector store changed → re-index
        db.commit()
        ingest.enqueue(d.id)
    clear_cache(profile_id)
    return doc_out(d)


@router.post("/{doc_id}/replace")
async def replace(profile_id: int, doc_id: int, request: Request, file: UploadFile = File(...), db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    d = _doc(db, profile_id, doc_id)
    info = await save_upload(file, DOCUMENTS_DIR / str(profile_id), get_settings().max_upload_mb)
    old = ingest.doc_path(d)
    d.stored_name, d.file_type, d.size_bytes, d.sha256, d.original_name = info["stored"], info["ext"], info["size"], info["sha256"], info["original"]
    d.pages = page_count(info["path"], info["ext"])
    d.status = "queued"
    db.commit()
    old.unlink(missing_ok=True)
    clear_cache(profile_id)
    ingest.enqueue(d.id)
    audit(db, "document_replaced", user_id=user.id, detail=str(d.id), ip=client_ip(request))
    return doc_out(d)


@router.post("/{doc_id}/reindex")
def reindex(profile_id: int, doc_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    d = _doc(db, profile_id, doc_id)
    d.status = "queued"
    db.commit()
    clear_cache(profile_id)
    ingest.enqueue(d.id)
    return doc_out(d)


@router.delete("/{doc_id}")
def delete(profile_id: int, doc_id: int, request: Request, confirm: bool = False, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    d = _doc(db, profile_id, doc_id)
    if not confirm:
        raise HTTPException(400, "Deleting a document is permanent; resend with confirm=true.")
    store.delete_document(d.id)
    ingest.doc_path(d).unlink(missing_ok=True)
    db.delete(d)
    db.commit()
    clear_cache(profile_id)
    audit(db, "document_deleted", user_id=user.id, detail=f"{doc_id}:{d.display_name}", ip=client_ip(request))
    return {"deleted": doc_id}


@router.get("/{doc_id}/file")
def download(profile_id: int, doc_id: int, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    d = _doc(db, profile_id, doc_id)
    path = safe_join(DOCUMENTS_DIR / str(profile_id), d.stored_name)
    if not path.exists():
        raise HTTPException(404, "File missing on disk")
    return FileResponse(path, filename=d.display_name, headers={"Cache-Control": "private, no-store"})


@router.get("/{doc_id}/chunks")
def chunks(profile_id: int, doc_id: int, page: int | None = None, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    _doc(db, profile_id, doc_id)
    q = select(Chunk).where(Chunk.document_id == doc_id)
    if page is not None:
        q = q.where(Chunk.page == page)
    return [{"id": c.id, "idx": c.idx, "page": c.page, "section": c.section, "text": c.text} for c in db.scalars(q.order_by(Chunk.idx).limit(200))]


@router.get("-search")
async def search(profile_id: int, q: str, k: int = 6, subject_id: int | None = None, db: Session = DB, user: User = USER):
    get_profile(db, user, profile_id)
    if len(q.strip()) < 2:
        raise HTTPException(400, "Query too short")
    res = await retrieve(db, profile_id, q[:500], min(max(k, 1), 12), subject_id)
    return [{**p.citation(), "score": p.score, "text": p.text[:1200]} for p in res]
