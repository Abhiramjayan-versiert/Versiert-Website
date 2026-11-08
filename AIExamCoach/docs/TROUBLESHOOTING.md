# Troubleshooting

Start with:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\status.ps1
```
Logs: `logs\backend.log` (application), `logs\server.err.log` / `logs\server.out.log` (process output), `logs\system-report.json` (from `inspect.ps1`).

## Local AI

| Symptom | Cause / fix |
|---|---|
| Chat says **"Local AI is offline"**; Model Manager shows *Ollama is not available* | Start Ollama (Start menu → Ollama, or `ollama serve`). Check `http://127.0.0.1:11434/api/version` in a browser. Nothing else may use port 11434. The app never falls back to a cloud model. |
| **"Model 'qwen3:4b' is not installed"** | Model Manager → *Approved downloads* → qwen3:4b, or `ollama pull qwen3:4b`. Same for `embeddinggemma`. |
| Model Manager shows **CPU** or **"x% GPU / y% CPU"** | VRAM is full or the driver is missing. Close games/GPU-heavy apps, keep context at 4096, run `nvidia-smi` to see VRAM use, update the NVIDIA driver. Partial offload works but is slower. |
| Answers are **slow** | First request after idle loads the model (a few seconds). Mock-paper generation makes many calls — expect minutes. On CPU-only machines expect 5–10 tokens/s. Keep `OLLAMA_NUM_PARALLEL=1`; don't run other AI apps at the same time. |
| **"The local AI queue is full"** | More than 8 AI requests are waiting. Wait for running tasks (Agent Activity) or cancel some. |
| Pauses between search and answer | With `OLLAMA_MAX_LOADED_MODELS=1` Ollama swaps qwen3 ↔ embeddinggemma. If VRAM allows, set it to `2` (user environment variable) and restart Ollama. |
| Out-of-memory / Ollama crashes | Lower context to 4096 in Settings; avoid models larger than 4B on 6 GB VRAM. The Model Manager blocks models that won't fit your RAM and asks before ones that exceed VRAM. |
| Ollama variables not applied | They are read when Ollama starts: quit Ollama from the tray and start it again (or re-run `install.ps1`, which offers to restart it). Check with `inspect.ps1`. |

## Documents and OCR

| Symptom | Fix |
|---|---|
| Document status **failed: No readable text found** | Scanned PDF/image without OCR: install Tesseract (`winget install UB-Mannheim.TesseractOCR`), restart the app, click *Re-index*. |
| Status **extracted** (not *indexed*) | Text was extracted but Ollama was not running for embeddings. Keyword search still works; start Ollama and click *Re-index*. |
| "File content does not match its extension" | The file is renamed or corrupt (e.g. a `.pdf` that is really HTML). Re-save it from the original program. |
| Password-protected PDF | Remove the password (print to PDF) and upload again. |
| Poor OCR on handwriting | Good light, flat page, fill the frame, dark pen. Always check the extracted text before evaluating — low-confidence text must be confirmed. |
| Search results seem stale after changing embedding model | Document Library → **Re-index all**. |

## App / network

| Symptom | Fix |
|---|---|
| `start.ps1`: **port 8765 is already used** | Another program uses it. Edit `config\settings.json` → `"port": 8766`, then start again (and re-run `network.ps1` if you use LAN/Tailscale). |
| Browser shows *"Frontend not built"* | `cd frontend; npm ci; npm run build`, or re-run `install.ps1`. |
| iPhone/Mac can't connect on Wi-Fi | Access mode must be `lan` (`network.ps1 -Mode lan` as Administrator, then restart); network profile must be **Private**; use the PC's IPv4 from `status.ps1`; PC awake; same Wi-Fi (not a guest network). |
| Tailscale URL doesn't load | Tailscale *Connected* on both devices with the same account; PC online; `tailscale serve status` shows `https://…:443 -> http://127.0.0.1:8765`; HTTPS certificates enabled in the admin console; app running (`status.ps1`). |
| Banner **"Windows host is offline"** | The PC is off, asleep, disconnected or the app is stopped. |
| Logged out unexpectedly | Sessions expire after 72 h (Settings → session hours) and changing your password signs out other devices. |
| **"CSRF token missing or invalid"** | Reload the page (the token is refreshed on sign-in). Clear cookies for the site if it persists. |
| **"Too many requests"** | Rate limit hit (login 10/min, AI 30/min). Wait a minute. |
| Execution policy error running scripts | Use `powershell -ExecutionPolicy Bypass -File scripts\<name>.ps1` as shown (doesn't change system policy). |
| Forgot app password | Stop the app, then: `.venv\Scripts\python -c "from backend.database.session import SessionLocal; from backend.models.entities import User; from backend.security.auth import hash_password; db=SessionLocal(); u=db.query(User).first(); u.password_hash=hash_password('NewPassword123'); db.commit()"` and sign in with the new password (change it afterwards). |

## Data

| Symptom | Fix |
|---|---|
| Database integrity check failed | Stop the app; `scripts\restore.ps1 -Path data\backups\<latest>.zip`. |
| Restored backup but search finds nothing | The backup was made with `-NoVectors`: Document Library → **Re-index all**. |
| Mock exam stuck in *submitted* | Ollama was offline during marking. Open the mock → **Evaluate now**. |
| Interrupted tasks after a restart | Running agent tasks are marked *failed: Interrupted by application restart*; simply run them again. |

## Reporting a problem
Collect `logs\backend.log`, `logs\server.err.log` and the output of `scripts\status.ps1`. They contain no document content, but review them before sharing.
