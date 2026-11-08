"""Upload validation and path-traversal protection."""
from __future__ import annotations

import hashlib
import re
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

ALLOWED = {
    "pdf": (b"%PDF",),
    "docx": (b"PK\x03\x04",),
    "pptx": (b"PK\x03\x04",),
    "xlsx": (b"PK\x03\x04",),
    "csv": None,
    "txt": None,
    "jpg": (b"\xff\xd8\xff",),
    "jpeg": (b"\xff\xd8\xff",),
    "png": (b"\x89PNG\r\n\x1a\n",),
}
IMAGE_TYPES = {"jpg", "jpeg", "png"}
_SAFE = re.compile(r"[^A-Za-z0-9 ._()\-]+")


def safe_display_name(name: str) -> str:
    name = Path(name.replace("\\", "/")).name  # drop any directory components
    name = _SAFE.sub("_", name).strip(" .") or "document"
    return name[:200]


def file_ext(name: str) -> str:
    return Path(name).suffix.lower().lstrip(".")


def safe_join(base: Path, name: str) -> Path:
    """Resolve ``name`` inside ``base``; raise if it would escape."""
    base = base.resolve()
    p = (base / name).resolve()
    if base != p and base not in p.parents:
        raise HTTPException(400, "Invalid path")
    return p


async def save_upload(upload: UploadFile, dest_dir: Path, max_mb: int, allowed: set[str] | None = None) -> dict:
    original = safe_display_name(upload.filename or "upload")
    ext = file_ext(original)
    allowed = allowed or set(ALLOWED)
    if ext not in allowed:
        raise HTTPException(415, f"File type .{ext or '?'} is not supported. Allowed: {', '.join(sorted(allowed))}")
    limit = max_mb * 1024 * 1024
    stored = f"{uuid.uuid4().hex}.{ext}"
    path = safe_join(dest_dir, stored)
    dest_dir.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha256()
    size = 0
    head = b""
    try:
        with open(path, "wb") as f:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"File exceeds the {max_mb} MB limit")
                if len(head) < 16:
                    head += chunk[:16]
                h.update(chunk)
                f.write(chunk)
        sig = ALLOWED.get(ext)
        if sig and not any(head.startswith(s) for s in sig):
            raise HTTPException(415, "File content does not match its extension")
        if sig is None:
            try:
                path.read_bytes()[:4096].decode("utf-8")
            except UnicodeDecodeError:
                try:
                    path.read_bytes()[:4096].decode("cp1252")
                except UnicodeDecodeError:
                    raise HTTPException(415, "Text file is not valid UTF-8 / Windows-1252 text")
        if size == 0:
            raise HTTPException(400, "File is empty")
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return {"original": original, "stored": stored, "ext": ext, "size": size, "sha256": h.hexdigest(), "path": path}
