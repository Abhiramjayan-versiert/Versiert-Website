"""Model manager: detection, sizing, guarded downloads, removal, activation,
GPU/CPU placement and inference tests."""
from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass, field

from backend.config import get_settings, is_cloud_model, update_settings
from backend.services import ollama
from backend.services.system_info import system_info

# Approximate download sizes (GB) and the memory needed to run them at 4k ctx.
# Anything not listed is treated as "unknown" and requires explicit approval.
CATALOGUE: dict[str, dict] = {
    "qwen3:4b": {"size_gb": 2.5, "run_gb": 3.6, "role": "chat", "note": "Primary model (thinking). Recommended."},
    "qwen3:4b-instruct": {"size_gb": 2.5, "run_gb": 3.4, "role": "chat", "note": "Non-thinking variant: faster replies, same size."},
    "qwen3:1.7b": {"size_gb": 1.4, "run_gb": 2.2, "role": "chat", "note": "Lightweight fallback for low memory."},
    "gemma3:4b": {"size_gb": 3.3, "run_gb": 4.5, "role": "chat", "note": "Alternative 4B model."},
    "llama3.2:3b": {"size_gb": 2.0, "run_gb": 3.0, "role": "chat", "note": "Alternative 3B model."},
    "qwen3:8b": {"size_gb": 5.2, "run_gb": 6.8, "role": "chat", "note": "Exceeds 6 GB VRAM: partial CPU offload, slower. Requires approval."},
    "embeddinggemma": {"size_gb": 0.62, "run_gb": 1.0, "role": "embedding", "note": "Primary embedding model."},
    "nomic-embed-text": {"size_gb": 0.27, "run_gb": 0.5, "role": "embedding", "note": "Alternative embedding model."},
}
LARGE_PARAM_RE = re.compile(r":(\d+(?:\.\d+)?)b", re.I)


def estimate(model: str) -> dict:
    base = model if ":" in model else model
    if base in CATALOGUE:
        return CATALOGUE[base]
    m = LARGE_PARAM_RE.search(model)
    if m:
        b = float(m.group(1))
        return {"size_gb": round(b * 0.62, 1), "run_gb": round(b * 0.62 + 1.2, 1), "role": "chat", "note": "Estimated from parameter count."}
    return {"size_gb": None, "run_gb": None, "role": "unknown", "note": "Unknown size."}


def check_capacity(model: str) -> dict:
    """Decide whether a download should be allowed, needs approval, or is blocked."""
    if is_cloud_model(model):
        return {"decision": "blocked", "reasons": ["Cloud models are not allowed (local-only mode)."]}
    est = estimate(model)
    info = system_info(fresh=True)
    vram_total = (info["gpus"][0]["vram_total_mb"] / 1024) if info["gpus"] else 0
    ram_total = info["ram_total_mb"] / 1024
    reasons: list[str] = []
    decision = "allowed"
    run = est.get("run_gb")
    if run is None:
        decision, reasons = "needs_approval", ["Model size is unknown; it may not fit your hardware."]
    else:
        if run > ram_total * 0.6:
            decision = "blocked"
            reasons.append(f"Needs ~{run} GB but the PC has {ram_total:.0f} GB RAM.")
        elif vram_total and run > vram_total * 0.95:
            decision = "needs_approval"
            reasons.append(f"Needs ~{run} GB; your GPU has {vram_total:.1f} GB VRAM, so it will partly run on CPU (slower).")
        elif not vram_total:
            reasons.append("No NVIDIA GPU detected; the model will run on CPU.")
        m = LARGE_PARAM_RE.search(model)
        if m and float(m.group(1)) >= 8 and decision == "allowed":
            decision = "needs_approval"
            reasons.append("Models of 8B parameters or more require explicit approval.")
    if info["disk_free_gb"] < (est.get("size_gb") or 5) + 2:
        decision = "blocked"
        reasons.append("Not enough free disk space.")
    return {"decision": decision, "reasons": reasons, "estimate": est}


@dataclass
class PullJob:
    model: str
    status: str = "starting"
    completed: int = 0
    total: int = 0
    error: str = ""
    started: float = field(default_factory=time.time)
    done: bool = False
    task: asyncio.Task | None = None


_pulls: dict[str, PullJob] = {}


def pull_jobs() -> list[dict]:
    return [
        {"model": j.model, "status": j.status, "completed": j.completed, "total": j.total, "error": j.error, "done": j.done,
         "pct": round(100 * j.completed / j.total, 1) if j.total else 0}
        for j in _pulls.values()
    ]


async def _run_pull(job: PullJob) -> None:
    try:
        async for ev in ollama.pull(job.model):
            if "error" in ev:
                job.error = ev["error"]
                job.status = "failed"
                break
            job.status = ev.get("status", job.status)
            if ev.get("total"):
                job.total = ev["total"]
                job.completed = ev.get("completed", 0)
        else:
            job.status = "success" if not job.error else job.status
    except asyncio.CancelledError:
        job.status, job.error = "cancelled", "Cancelled by user"
        raise
    except Exception as e:  # noqa: BLE001
        job.status, job.error = "failed", str(e)
    finally:
        job.done = True
        ollama.forget_capabilities()


def start_pull(model: str, approved: bool) -> dict:
    cap = check_capacity(model)
    if cap["decision"] == "blocked":
        return {"started": False, **cap}
    if cap["decision"] == "needs_approval" and not approved:
        return {"started": False, **cap}
    existing = _pulls.get(model)
    if existing and not existing.done:
        return {"started": False, "decision": "running", "reasons": ["Already downloading."]}
    job = PullJob(model=model)
    _pulls[model] = job
    job.task = asyncio.create_task(_run_pull(job))
    return {"started": True, **cap}


def cancel_pull(model: str) -> bool:
    job = _pulls.get(model)
    if job and job.task and not job.done:
        job.task.cancel()
        return True
    return False


async def overview() -> dict:
    s = get_settings()
    out: dict = {"ollama_url": s.ollama_url, "active_chat_model": s.chat_model, "active_embedding_model": s.embedding_model,
                 "context_length": s.context_length, "queue": ollama.queue_status(), "pulls": pull_jobs(), "system": system_info()}
    try:
        out["ollama_version"] = await ollama.version()
        out["available"] = True
    except ollama.OllamaUnavailable as e:
        out.update(available=False, error=str(e), installed=[], loaded=[],
                   recovery=["Start Ollama from the Start menu (or run `ollama serve`).",
                             "Run scripts\\status.ps1 to diagnose.",
                             "Check that nothing else uses port 11434."])
        return out
    installed = await ollama.list_models()
    loaded = await ollama.running_models()
    out["installed"] = [
        {"name": m["name"], "size_gb": round(m.get("size", 0) / 1e9, 2), "modified": m.get("modified_at"),
         "parameter_size": m.get("details", {}).get("parameter_size"), "quantization": m.get("details", {}).get("quantization_level"),
         "family": m.get("details", {}).get("family"), "catalogue": CATALOGUE.get(m["name"].removesuffix(":latest"))}
        for m in installed
    ]
    out["loaded"] = [placement(m) for m in loaded]
    names = {m["name"].removesuffix(":latest") for m in installed}
    out["missing_required"] = [n for n in (s.chat_model, s.embedding_model) if n.removesuffix(":latest") not in names]
    out["catalogue"] = [{"name": k, **v} for k, v in CATALOGUE.items()]
    return out


def placement(m: dict) -> dict:
    size, vram = m.get("size", 0) or 0, m.get("size_vram", 0) or 0
    gpus = system_info()["gpus"]
    if not gpus:
        where, gpu_pct = "CPU", 0  # no NVIDIA GPU: size_vram is not meaningful
    else:
        gpu_pct = round(100 * vram / size) if size else 0
        where = "GPU" if gpu_pct >= 99 else ("CPU" if gpu_pct == 0 else f"{gpu_pct}% GPU / {100 - gpu_pct}% CPU")
    return {"name": m.get("name"), "size_gb": round(size / 1e9, 2), "vram_gb": round(vram / 1e9, 2), "processor": where,
            "gpu_pct": gpu_pct, "context_length": m.get("context_length"), "expires_at": m.get("expires_at")}


async def test_inference(model: str | None = None) -> dict:
    s = get_settings()
    model = model or s.chat_model
    res = await ollama.chat([{"role": "user", "content": "Reply with exactly: Local AI is working."}], model=model, max_tokens=1024)
    loaded = [placement(m) for m in await ollama.running_models() if m.get("name", "").startswith(model.split(":")[0])]
    return {"model": model, "reply": res.content[:200], "duration_ms": res.duration_ms, "tokens_per_sec": res.tokens_per_sec,
            "placement": loaded[0] if loaded else None}


async def test_embedding(model: str | None = None) -> dict:
    t0 = time.perf_counter()
    vecs = await ollama.embed(["Working capital is current assets minus current liabilities."], model=model)
    return {"model": model or get_settings().embedding_model, "dimensions": len(vecs[0]), "duration_ms": int((time.perf_counter() - t0) * 1000)}


async def set_active(chat_model: str | None = None, embedding_model: str | None = None) -> dict:
    installed = {m["name"].removesuffix(":latest") for m in await ollama.list_models()}
    changes = {}
    for key, val in (("chat_model", chat_model), ("embedding_model", embedding_model)):
        if val:
            if val.removesuffix(":latest") not in installed:
                raise ValueError(f"'{val}' is not installed")
            changes[key] = val
    s = update_settings(changes)
    ollama.forget_capabilities()
    return {"chat_model": s.chat_model, "embedding_model": s.embedding_model}
