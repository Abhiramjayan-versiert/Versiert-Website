"""Hardware inspection (RAM, CPU, NVIDIA GPU/VRAM, disk). Uses fixed commands
only — no user input reaches a shell."""
from __future__ import annotations

import platform
import shutil
import subprocess
import time

import psutil

from backend.config import DATA_DIR

_cache: dict = {"t": 0.0, "v": None}


def gpu_info() -> list[dict]:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return []
    try:
        out = subprocess.run(
            [exe, "--query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,driver_version", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=8, check=True,
        ).stdout
    except (subprocess.SubprocessError, OSError):
        return []
    gpus = []
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 6:
            gpus.append({
                "name": parts[0], "vram_total_mb": int(float(parts[1])), "vram_used_mb": int(float(parts[2])),
                "vram_free_mb": int(float(parts[3])), "utilization_pct": int(float(parts[4])), "driver": parts[5],
            })
    return gpus


def system_info(fresh: bool = False) -> dict:
    if not fresh and _cache["v"] and time.time() - _cache["t"] < 5:
        return _cache["v"]
    vm = psutil.virtual_memory()
    disk = shutil.disk_usage(DATA_DIR)
    gpus = gpu_info()
    info = {
        "os": f"{platform.system()} {platform.release()} ({platform.version()})",
        "cpu": platform.processor() or platform.machine(),
        "cpu_cores": psutil.cpu_count(logical=False), "cpu_threads": psutil.cpu_count(),
        "cpu_percent": psutil.cpu_percent(interval=None),
        "ram_total_mb": vm.total // 2**20, "ram_available_mb": vm.available // 2**20, "ram_percent": vm.percent,
        "disk_free_gb": round(disk.free / 2**30, 1), "disk_total_gb": round(disk.total / 2**30, 1),
        "gpus": gpus, "nvidia_driver": gpus[0]["driver"] if gpus else None,
    }
    warnings = []
    if vm.available < 3 * 2**30:
        warnings.append("Less than 3 GB RAM available — close other applications; AI responses may be slow.")
    if gpus and gpus[0]["vram_free_mb"] < 1500:
        warnings.append("GPU VRAM is almost full — the model may run partly on CPU.")
    if disk.free < 5 * 2**30:
        warnings.append("Less than 5 GB disk space free.")
    info["warnings"] = warnings
    _cache.update(t=time.time(), v=info)
    return info
