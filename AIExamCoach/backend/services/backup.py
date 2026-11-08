"""Backup / restore / export.

A backup is a single .zip containing:
  database/examcoach.db  (consistent copy via SQLite online-backup API)
  documents/**           (user uploads — never modified by restore unless confirmed)
  config/settings.json
  vector_store/**        (optional; can always be rebuilt by re-indexing)
  manifest.json          (version, timestamps, sha256 of every file)

CLI (used by scripts/backup.ps1 and scripts/restore.ps1):
  python -m backend.services.backup create [--no-vectors]
  python -m backend.services.backup verify <zip>
  python -m backend.services.backup restore <zip> --yes
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
import sys
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

from backend.config import BACKUP_DIR, CONFIG_DIR, DATA_DIR, DB_DIR, DOCUMENTS_DIR, SETTINGS_FILE, VECTOR_DIR, ensure_dirs

APP_VERSION = "1.0.0"
DB_FILE = DB_DIR / "examcoach.db"


def _sha(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def create_backup(include_vectors: bool = True, label: str = "") -> Path:
    ensure_dirs()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = BACKUP_DIR / f"examcoach-backup-{stamp}{('-' + label) if label else ''}.zip"
    files: dict[str, str] = {}
    with tempfile.TemporaryDirectory() as tmp:
        snap = Path(tmp) / "examcoach.db"
        if DB_FILE.exists():
            src = sqlite3.connect(DB_FILE)
            dst = sqlite3.connect(snap)
            with dst:
                src.backup(dst)  # consistent even while the app is running
            src.close()
            dst.close()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as z:
            if snap.exists():
                z.write(snap, "database/examcoach.db")
                files["database/examcoach.db"] = _sha(snap)
            for base, arc in ((DOCUMENTS_DIR, "documents"), (VECTOR_DIR, "vector_store") if include_vectors else (None, None)):
                if base is None or not base.exists():
                    continue
                for p in base.rglob("*"):
                    if p.is_file():
                        name = f"{arc}/{p.relative_to(base).as_posix()}"
                        z.write(p, name)
                        files[name] = _sha(p)
            if SETTINGS_FILE.exists():
                z.write(SETTINGS_FILE, "config/settings.json")
                files["config/settings.json"] = _sha(SETTINGS_FILE)
            manifest = {"app": "AIExamCoach", "version": APP_VERSION, "created_at": datetime.now().isoformat(), "include_vectors": include_vectors,
                        "files": files, "note": "If vector_store is missing, use Document Library → Re-index all after restore."}
            z.writestr("manifest.json", json.dumps(manifest, indent=2))
    return out


def verify_backup(path: Path) -> dict:
    problems = []
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        if "manifest.json" not in names:
            return {"ok": False, "problems": ["manifest.json missing — not an AIExamCoach backup"]}
        m = json.loads(z.read("manifest.json"))
        if m.get("app") != "AIExamCoach":
            problems.append("Not an AIExamCoach backup")
        for name, sha in m.get("files", {}).items():
            if ".." in Path(name).parts or name.startswith("/"):
                problems.append(f"Unsafe path in backup: {name}")
                continue
            if name not in names:
                problems.append(f"Missing file: {name}")
                continue
            h = hashlib.sha256()
            with z.open(name) as f:
                for b in iter(lambda: f.read(1 << 20), b""):
                    h.update(b)
            if h.hexdigest() != sha:
                problems.append(f"Checksum mismatch: {name}")
        if "database/examcoach.db" in names:
            with tempfile.TemporaryDirectory() as tmp:
                z.extract("database/examcoach.db", tmp)
                con = sqlite3.connect(Path(tmp) / "database/examcoach.db")
                r = con.execute("PRAGMA integrity_check").fetchone()[0]
                con.close()
                if r != "ok":
                    problems.append(f"Database integrity check failed: {r}")
    return {"ok": not problems, "problems": problems, "manifest": m}


def restore_backup(path: Path, yes: bool = False) -> dict:
    v = verify_backup(path)
    if not v["ok"]:
        raise SystemExit("Backup failed validation:\n  " + "\n  ".join(v["problems"]))
    if not yes:
        raise SystemExit("Restore overwrites the current database, documents and settings. Re-run with --yes to confirm.")
    safety = create_backup(include_vectors=False, label="pre-restore")
    m = v["manifest"]
    with zipfile.ZipFile(path) as z, tempfile.TemporaryDirectory() as tmp:
        z.extractall(tmp)
        t = Path(tmp)
        if (t / "database/examcoach.db").exists():
            DB_DIR.mkdir(parents=True, exist_ok=True)
            for suffix in ("-wal", "-shm"):
                Path(str(DB_FILE) + suffix).unlink(missing_ok=True)
            shutil.copy2(t / "database/examcoach.db", DB_FILE)
        if (t / "documents").exists():
            shutil.rmtree(DOCUMENTS_DIR, ignore_errors=True)
            shutil.copytree(t / "documents", DOCUMENTS_DIR)
        if (t / "config/settings.json").exists():
            CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            shutil.copy2(t / "config/settings.json", SETTINGS_FILE)
        shutil.rmtree(VECTOR_DIR, ignore_errors=True)
        if (t / "vector_store").exists():
            shutil.copytree(t / "vector_store", VECTOR_DIR)
        else:
            VECTOR_DIR.mkdir(parents=True, exist_ok=True)
    return {"restored_from": str(path), "safety_backup": str(safety), "vectors_included": m.get("include_vectors", False)}


def list_backups() -> list[dict]:
    ensure_dirs()
    return [{"name": p.name, "size_mb": round(p.stat().st_size / 2**20, 2), "created": datetime.fromtimestamp(p.stat().st_mtime).isoformat()}
            for p in sorted(BACKUP_DIR.glob("examcoach-backup-*.zip"), reverse=True)]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="backup")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create")
    c.add_argument("--no-vectors", action="store_true")
    c.add_argument("--label", default="")
    vp = sub.add_parser("verify")
    vp.add_argument("path")
    r = sub.add_parser("restore")
    r.add_argument("path")
    r.add_argument("--yes", action="store_true")
    sub.add_parser("list")
    a = ap.parse_args(argv)
    if a.cmd == "create":
        print(create_backup(not a.no_vectors, a.label))
    elif a.cmd == "verify":
        res = verify_backup(Path(a.path))
        print(json.dumps({k: v for k, v in res.items() if k != "manifest"}, indent=2))
        return 0 if res["ok"] else 1
    elif a.cmd == "restore":
        print(json.dumps(restore_backup(Path(a.path), a.yes), indent=2))
    elif a.cmd == "list":
        print(json.dumps(list_backups(), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
