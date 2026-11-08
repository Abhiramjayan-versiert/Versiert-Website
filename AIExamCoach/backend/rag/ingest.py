"""Background document processing pipeline:
validate → extract (+OCR) → chunk → embed (batched) → store vectors + metadata.

Runs in a single background worker so ingestion never competes with itself
for the GPU; CPU-bound extraction is pushed to a thread."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from sqlalchemy import delete, select

from backend.config import DOCUMENTS_DIR, get_settings
from backend.database.session import db_session
from backend.models.entities import Chunk, Document, utcnow
from backend.rag import store
from backend.rag.chunker import chunk_segments
from backend.rag.extract import extract
from backend.services import ollama

log = logging.getLogger("aec.ingest")
EMBED_BATCH = 16

_queue: asyncio.Queue[int] | None = None
_worker: asyncio.Task | None = None


def _q() -> asyncio.Queue[int]:
    global _queue
    if _queue is None:
        _queue = asyncio.Queue()
    return _queue


def enqueue(document_id: int) -> None:
    _q().put_nowait(document_id)


def start_worker() -> None:
    global _worker
    if _worker is None or _worker.done():
        _worker = asyncio.create_task(_run())


async def stop_worker() -> None:
    global _worker
    if _worker:
        _worker.cancel()
        _worker = None


async def _run() -> None:
    while True:
        doc_id = await _q().get()
        try:
            await process_document(doc_id)
        except Exception:  # noqa: BLE001
            log.exception("ingest failed for %s", doc_id)
        finally:
            _q().task_done()


def doc_path(doc: Document) -> Path:
    return DOCUMENTS_DIR / str(doc.profile_id) / doc.stored_name


def _extract_and_chunk(path: Path, ext: str) -> tuple[list, int, int]:
    s = get_settings()
    segments = list(extract(path, ext, s.ocr_language))
    pages = max((seg.page or 0 for seg in segments), default=0)
    ocr_pages = sum(1 for seg in segments if seg.ocr)
    chunks = chunk_segments(segments, s.chunk_tokens, s.chunk_overlap_tokens)
    return chunks, pages, ocr_pages


async def process_document(doc_id: int) -> dict:
    with db_session() as db:
        doc = db.get(Document, doc_id)
        if not doc:
            return {"ok": False, "error": "missing"}
        doc.status, doc.error = "processing", ""
        path, ext = doc_path(doc), doc.file_type
        profile_id, subject_id, name = doc.profile_id, doc.subject_id, doc.display_name
    try:
        chunks, pages, ocr_pages = await asyncio.to_thread(_extract_and_chunk, path, ext)
    except Exception as e:  # noqa: BLE001
        with db_session() as db:
            d = db.get(Document, doc_id)
            d.status, d.error = "failed", f"Extraction failed: {e}"
        return {"ok": False, "error": str(e)}

    # persist chunk text (source of truth for citations / re-indexing)
    store.delete_document(doc_id)
    with db_session() as db:
        db.execute(delete(Chunk).where(Chunk.document_id == doc_id))
        rows = [Chunk(document_id=doc_id, profile_id=profile_id, idx=i, page=c.page, section=c.section, text=c.text, token_estimate=c.tokens)
                for i, c in enumerate(chunks)]
        db.add_all(rows)
        db.flush()
        chunk_rows = [(r.id, r.idx, r.page, r.section, r.text) for r in rows]
        d = db.get(Document, doc_id)
        d.pages, d.ocr_pages, d.chunk_count = pages, ocr_pages, len(rows)
        if not rows:
            d.status, d.error = "failed", "No readable text found (for scans, install Tesseract OCR)."
            return {"ok": False, "error": d.error}

    model = get_settings().embedding_model
    try:
        for i in range(0, len(chunk_rows), EMBED_BATCH):
            batch = chunk_rows[i : i + EMBED_BATCH]
            vecs = await ollama.embed([f"title: {name} | text: {b[4]}" for b in batch])
            store.add(
                ids=[f"c{b[0]}" for b in batch],
                vectors=vecs,
                metadatas=[{"chunk_id": b[0], "document_id": doc_id, "profile_id": profile_id, "subject_id": subject_id or 0,
                            "page": b[2] if b[2] is not None else -1, "section": b[3][:200], "filename": name} for b in batch],
                documents=[b[4] for b in batch],
            )
    except ollama.OllamaError as e:
        with db_session() as db:
            d = db.get(Document, doc_id)
            d.status = "extracted"
            d.error = f"Text extracted but not embedded ({e}). Keyword search works; re-index when Ollama is running."
        return {"ok": False, "error": str(e), "chunks": len(chunk_rows)}

    with db_session() as db:
        d = db.get(Document, doc_id)
        d.status, d.embedding_model, d.indexed_at, d.error = "indexed", model, utcnow(), ""
    return {"ok": True, "chunks": len(chunk_rows), "pages": pages, "ocr_pages": ocr_pages}


def pending_documents() -> list[int]:
    with db_session() as db:
        return list(db.scalars(select(Document.id).where(Document.status.in_(["queued", "processing"]))))
