"""Retrieval: semantic (EmbeddingGemma + Chroma) blended with keyword scoring
over SQLite chunk text. Citations are built ONLY from stored chunk metadata."""
from __future__ import annotations

import re
from collections import OrderedDict
from dataclasses import dataclass

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from backend.models.entities import Chunk, Document
from backend.rag import store
from backend.services import ollama

_STOP = set("the a an of to in and or for on with is are was be by as at from that this what which how why explain define describe me my i".split())
_cache: "OrderedDict[tuple, list]" = OrderedDict()
_CACHE_MAX = 128


@dataclass
class Passage:
    chunk_id: int
    document_id: int
    filename: str
    page: int | None
    section: str
    text: str
    score: float

    def citation(self) -> dict:
        return {"chunk_id": self.chunk_id, "document_id": self.document_id, "filename": self.filename, "page": self.page, "section": self.section}

    def label(self) -> str:
        loc = f"p. {self.page}" if self.page else (self.section or "no page numbers")
        return f"{self.filename}, {loc}"


def _terms(q: str) -> list[str]:
    return [t for t in re.findall(r"[a-zA-Z0-9]{3,}", q.lower()) if t not in _STOP][:8]


def clear_cache(profile_id: int | None = None) -> None:
    if profile_id is None:
        _cache.clear()
    else:
        for k in [k for k in _cache if k[0] == profile_id]:
            _cache.pop(k, None)


def _keyword(db: Session, profile_id: int, q: str, k: int, subject_id: int | None) -> dict[int, float]:
    terms = _terms(q)
    if not terms:
        return {}
    stmt = select(Chunk.id, Chunk.text).where(Chunk.profile_id == profile_id, or_(*[Chunk.text.ilike(f"%{t}%") for t in terms]))
    if subject_id:
        stmt = stmt.join(Document, Document.id == Chunk.document_id).where(Document.subject_id == subject_id)
    scores: dict[int, float] = {}
    for cid, text in db.execute(stmt.limit(400)):
        low = text.lower()
        hits = sum(1 for t in terms if t in low)
        scores[cid] = hits / len(terms)
    return dict(sorted(scores.items(), key=lambda x: -x[1])[:k])


async def retrieve(db: Session, profile_id: int, query: str, k: int = 5, subject_id: int | None = None) -> list[Passage]:
    key = (profile_id, query.strip().lower(), k, subject_id)
    if key in _cache:
        _cache.move_to_end(key)
        ids_scores = _cache[key]
    else:
        scores: dict[int, float] = {}
        try:
            vec = (await ollama.embed([f"task: search result | query: {query}"]))[0]
            for r in store.query(vec, profile_id, k=k * 3, subject_id=subject_id):
                cid = int(r["metadata"]["chunk_id"])
                scores[cid] = max(scores.get(cid, 0), 1 - float(r["distance"]))
        except Exception:  # noqa: BLE001 - fall back to keyword-only retrieval
            pass
        for cid, s in _keyword(db, profile_id, query, k * 3, subject_id).items():
            scores[cid] = scores.get(cid, 0) * 0.75 + s * 0.35 if cid in scores else s * 0.5
        ids_scores = sorted(scores.items(), key=lambda x: -x[1])[: k]
        _cache[key] = ids_scores
        if len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)
    if not ids_scores:
        return []
    rows = {c.id: c for c in db.scalars(select(Chunk).where(Chunk.id.in_([i for i, _ in ids_scores]), Chunk.profile_id == profile_id))}
    docs = {d.id: d for d in db.scalars(select(Document).where(Document.id.in_({c.document_id for c in rows.values()})))}
    out = []
    for cid, s in ids_scores:
        c = rows.get(cid)
        if not c or c.document_id not in docs:
            continue  # chunk deleted since indexing → never cite it
        out.append(Passage(c.id, c.document_id, docs[c.document_id].display_name, c.page, c.section, c.text, round(s, 3)))
    return out


def format_context(passages: list[Passage], max_chars: int = 6000) -> str:
    parts, used = [], 0
    for i, p in enumerate(passages, 1):
        t = p.text[: max(400, (max_chars - used))]
        block = f"[S{i}] ({p.label()})\n{t}"
        if used + len(block) > max_chars and parts:
            break
        parts.append(block)
        used += len(block)
    return "\n\n".join(parts)
