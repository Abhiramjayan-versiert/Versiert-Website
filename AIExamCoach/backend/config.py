"""Application configuration.

Non-secret settings live in ``config/settings.json`` (created on first run).
Secrets (session signing key) live in ``data/secrets/`` which is never served
and is excluded from git.

LOCAL-ONLY AI is enforced here: the Ollama URL must point at a loopback
address. Any attempt to configure a remote inference endpoint is rejected.
"""
from __future__ import annotations

import ipaddress
import json
import os
import secrets
import threading
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator

ROOT_DIR = Path(os.environ.get("AEC_ROOT", Path(__file__).resolve().parent.parent))
DATA_DIR = Path(os.environ.get("AEC_DATA_DIR", ROOT_DIR / "data"))
CONFIG_DIR = Path(os.environ.get("AEC_CONFIG_DIR", ROOT_DIR / "config"))
LOG_DIR = Path(os.environ.get("AEC_LOG_DIR", ROOT_DIR / "logs"))

DB_DIR = DATA_DIR / "database"
DOCUMENTS_DIR = DATA_DIR / "documents"
UPLOADS_DIR = DATA_DIR / "uploads"
VECTOR_DIR = DATA_DIR / "vector_store"
BACKUP_DIR = DATA_DIR / "backups"
SECRETS_DIR = DATA_DIR / "secrets"
FRONTEND_DIST = Path(os.environ.get("AEC_FRONTEND_DIST", ROOT_DIR / "frontend" / "out"))

SETTINGS_FILE = CONFIG_DIR / "settings.json"

# Hosts we consider "local". Ollama MUST be reachable on one of these.
_LOOPBACK_NAMES = {"localhost", "127.0.0.1", "::1"}

# Cloud-hosted Ollama models (e.g. "gpt-oss:120b-cloud") are refused.
CLOUD_MODEL_MARKERS = ("-cloud", ":cloud")


def is_loopback_url(url: str) -> bool:
    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        return False
    if host in _LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def is_cloud_model(name: str) -> bool:
    n = name.lower()
    return any(m in n for m in CLOUD_MODEL_MARKERS)


class Settings(BaseModel):
    # --- network / access ---
    access_mode: str = Field("local_only", pattern="^(local_only|lan|tailscale)$")
    port: int = Field(8765, ge=1024, le=65535)
    # --- local AI ---
    local_only_ai: bool = True  # cannot be disabled; validated below
    ollama_url: str = "http://127.0.0.1:11434"
    chat_model: str = "qwen3:4b"
    embedding_model: str = "embeddinggemma"
    context_length: int = Field(4096, ge=2048, le=32768)
    keep_alive: str = "5m"
    llm_queue_limit: int = Field(8, ge=1, le=32)
    llm_timeout_seconds: int = Field(600, ge=30, le=3600)
    temperature: float = Field(0.3, ge=0.0, le=1.5)
    # --- documents ---
    max_upload_mb: int = Field(50, ge=1, le=500)
    chunk_tokens: int = Field(600, ge=200, le=1200)
    chunk_overlap_tokens: int = Field(80, ge=0, le=300)
    ocr_language: str = "eng"
    ocr_low_confidence: float = Field(70.0, ge=0, le=100)
    # --- coaching ---
    default_target_pct: float = Field(75.0, ge=1, le=100)
    max_daily_study_hours: float = Field(10.0, ge=1, le=16)
    srs_initial_intervals: list[int] = Field(default_factory=lambda: [1, 3, 7, 14, 30])
    # --- security ---
    session_hours: int = Field(72, ge=1, le=24 * 30)
    login_rate_per_minute: int = Field(10, ge=1, le=100)
    ai_rate_per_minute: int = Field(30, ge=1, le=600)

    @field_validator("local_only_ai")
    @classmethod
    def _force_local(cls, v: bool) -> bool:
        if not v:
            raise ValueError("local_only_ai cannot be disabled: all AI inference must stay on this PC")
        return True

    @field_validator("ollama_url")
    @classmethod
    def _ollama_local(cls, v: str) -> str:
        v = v.rstrip("/")
        if not is_loopback_url(v):
            raise ValueError("ollama_url must be a loopback address (127.0.0.1 / localhost). Remote inference is not allowed.")
        return v

    @field_validator("chat_model", "embedding_model")
    @classmethod
    def _no_cloud_models(cls, v: str) -> str:
        if is_cloud_model(v):
            raise ValueError("Cloud models are not allowed in local-only mode")
        return v


_lock = threading.Lock()
_settings: Settings | None = None


def ensure_dirs() -> None:
    for d in (DATA_DIR, DB_DIR, DOCUMENTS_DIR, UPLOADS_DIR, VECTOR_DIR, BACKUP_DIR, SECRETS_DIR, CONFIG_DIR, LOG_DIR):
        d.mkdir(parents=True, exist_ok=True)


def get_settings() -> Settings:
    global _settings
    with _lock:
        if _settings is None:
            ensure_dirs()
            data: dict[str, Any] = {}
            if SETTINGS_FILE.exists():
                data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            _settings = Settings(**data)
            if not SETTINGS_FILE.exists():
                _write(_settings)
        return _settings


def _write(s: Settings) -> None:
    tmp = SETTINGS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(s.model_dump(), indent=2), encoding="utf-8")
    tmp.replace(SETTINGS_FILE)


def update_settings(changes: dict[str, Any]) -> Settings:
    global _settings
    current = get_settings().model_dump()
    current.update(changes)
    new = Settings(**current)  # validates (including local-only rules)
    with _lock:
        _write(new)
        _settings = new
    return new


def reset_settings_cache() -> None:
    global _settings
    with _lock:
        _settings = None


def get_secret_key() -> str:
    ensure_dirs()
    f = SECRETS_DIR / "app_secret"
    if not f.exists():
        f.write_text(secrets.token_urlsafe(48), encoding="utf-8")
        try:
            os.chmod(f, 0o600)
        except OSError:
            pass
    return f.read_text(encoding="utf-8").strip()
