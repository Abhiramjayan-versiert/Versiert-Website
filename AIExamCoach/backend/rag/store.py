"""ChromaDB persistent vector store (local directory, telemetry disabled).

Vectors are always filtered by ``profile_id`` so profiles never mix. The
source text lives in SQLite (``chunks`` table), so the vector store can be
rebuilt at any time with re-indexing."""
from __future__ import annotations

import os
import re
import threading

os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")

from backend.config import VECTOR_DIR, get_settings  # noqa: E402

_client = None
_lock = threading.Lock()


def _get_client():
    global _client
    with _lock:
        if _client is None:
            import chromadb
            from chromadb.config import Settings as CS

            VECTOR_DIR.mkdir(parents=True, exist_ok=True)
            _client = chromadb.PersistentClient(path=str(VECTOR_DIR), settings=CS(anonymized_telemetry=False, allow_reset=False))
        return _client


def collection_name(model: str | None = None) -> str:
    model = model or get_settings().embedding_model
    return "chunks_" + re.sub(r"[^a-zA-Z0-9_-]", "_", model)[:50]


def collection(model: str | None = None):
    return _get_client().get_or_create_collection(collection_name(model), metadata={"hnsw:space": "cosine"})


def add(ids: list[str], vectors: list[list[float]], metadatas: list[dict], documents: list[str]) -> None:
    collection().upsert(ids=ids, embeddings=vectors, metadatas=metadatas, documents=documents)


def delete_document(document_id: int) -> None:
    try:
        collection().delete(where={"document_id": document_id})
    except Exception:  # noqa: BLE001 - empty collection etc.
        pass


def delete_profile(profile_id: int) -> None:
    try:
        collection().delete(where={"profile_id": profile_id})
    except Exception:  # noqa: BLE001
        pass


def query(vector: list[float], profile_id: int, k: int = 6, subject_id: int | None = None, document_ids: list[int] | None = None) -> list[dict]:
    where: dict = {"profile_id": profile_id}
    conds = [{"profile_id": profile_id}]
    if subject_id:
        conds.append({"subject_id": subject_id})
    if document_ids:
        conds.append({"document_id": {"$in": document_ids}})
    where = conds[0] if len(conds) == 1 else {"$and": conds}
    col = collection()
    if col.count() == 0:
        return []
    r = col.query(query_embeddings=[vector], n_results=k, where=where, include=["metadatas", "documents", "distances"])
    out = []
    for i, cid in enumerate(r["ids"][0]):
        out.append({"id": cid, "metadata": r["metadatas"][0][i], "text": r["documents"][0][i], "distance": r["distances"][0][i]})
    return out


def stats() -> dict:
    try:
        col = collection()
        return {"ok": True, "collection": col.name, "vectors": col.count(), "path": str(VECTOR_DIR)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e), "path": str(VECTOR_DIR)}
