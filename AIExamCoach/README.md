# AI Exam Coach

A private, **fully local** agentic AI exam coach for Windows. It reads your syllabus and study material, teaches you, plans your study time, generates mock papers, marks your answers (including photographed handwriting), schedules spaced revision and tracks whether you are on course for **75 %** (or any target you set) in each examination.

All AI runs on your own PC through **Ollama** (`qwen3:4b` + `embeddinggemma`). There are no paid APIs, no API keys, no cloud inference and no cloud document processing. After installation everything works offline.

> Readiness figures are **estimates** from your own recorded practice and mock results — never a guarantee of an exam score. Generated questions are practice questions, not actual or guaranteed exam questions.

---

## Contents
1. [What it does](#what-it-does)
2. [Architecture](#architecture)
3. [Install on the Windows PC](#install-on-the-windows-pc)
4. [Daily use — launch, stop, status](#daily-use) · [Use it as a web app](#use-it-as-a-web-app)
5. [First steps (profiles, uploads, plan, mock, backup)](#first-steps)
6. [MacBook and iPhone access](#macbook-and-iphone-access)
7. [Security model](#security-model)
8. [Configuration](#configuration)
9. [Development and tests](#development-and-tests)
10. Further docs: [`docs/REMOTE_ACCESS.md`](docs/REMOTE_ACCESS.md) · [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) · [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md) · [`PROJECT_STATUS.md`](PROJECT_STATUS.md)

---

## What it does

| Area | What you get |
|---|---|
| **Exam profiles** | Unlimited separate profiles (MBA Semester, SSC Competitive and Other are created for you). Each has its own date, target %, subjects, syllabus, documents, plan, questions, mocks, scores, weak topics and revision history. Create, edit, archive, delete; switch from the sidebar. |
| **Document library** | Upload PDF, DOCX, PPTX, XLSX, CSV, TXT, JPG, JPEG, PNG. Text + tables extracted locally (PyMuPDF, python-docx, python-pptx, openpyxl), scanned pages read with Tesseract OCR, split into ~600-token chunks with overlap, embedded with EmbeddingGemma into ChromaDB. Rename, replace, delete, re-index, assign to profile/subject, search. |
| **AI Exam Coach chat** | Natural-language requests routed by the Master Orchestrator to the right agent, with file attachments, profile/subject selection, follow-ups, real source citations (filename + page) and a live "which agent is doing what" indicator. |
| **AI Tutor** | 10-part lessons (simple + detailed explanation, definitions, examples, applications, formulas/diagrams, exam notes, points to remember, summary, practice questions) in Beginner / Intermediate / Advanced / MBA / SSC / short-answer / long-answer modes, grounded on your documents, with context-preserving follow-ups. |
| **Syllabus analyst** | Extracts subjects → units → topics → subtopics, marks and exam dates. Every item is checked against the document text; anything not found is dropped (nothing is guessed). Marks are read directly from the text. You review/edit the draft before applying it. |
| **Study planner** | Deterministic, realistic schedules (daily / weekly / monthly) from exam date, hours, chosen study days, weightage, difficulty, completion and **measured** weak areas; spaced revision, 50-minute blocks with breaks, final mock/revision phase, backlog reporting, one-click rescheduling after missed sessions. Unrealistic hours are capped. |
| **Question bank** | MCQ, multiple-select, true/false, fill-in-the-blank, short, long, case study, numerical, assertion-reason, essay — grounded on your textbooks, past papers and marking schemes. Every question is validated; numerical answers are recomputed in Python. |
| **Mock exams** | Build papers by marks/duration/format/subject/difficulty, or from selected bank questions. Timer (server-enforced), navigation grid, autosave, mark-for-review, auto-submit at time-out. Answer key hidden until submission (unless practice mode). Results: marks, subject/topic breakdown, explanations, weak topics, recommendations — saved permanently. |
| **Answer evaluation** | Text, PDF, DOCX, photos or scans. Local OCR shows the extracted text for you to correct; low-confidence OCR must be confirmed before marking. Rubric-based partial marking against your uploaded marking scheme; Python-verified calculations; keyword-stuffing and too-short answers are capped. Output: marks, %, correct / missing / incorrect points, missing keywords, how to improve, model answer, examiner expectations. |
| **Revision centre** | SM-2 spaced repetition with configurable intervals; daily list (mistakes and weak topics first), flashcards, definitions, formulas, AI-generated recall cards, quick quizzes; every wrong answer becomes a revision card. |
| **Performance analytics + 75 % target engine** | Four separate measured indicators — syllabus completion, topic-wise practice accuracy, retention, timed mock performance — plus an estimate anchored on full-length timed mocks, gap to target, subjects below target, topics losing the most marks, repeated mistakes, time management, decline alerts and actionable recommendations. Shows "not enough data" instead of guessing. |
| **Agent activity** | Every agent task with status, start/finish, duration, model, tool calls, errors, approvals, cancel button. Concise summaries only — no hidden chain-of-thought. |
| **Model manager** | Installed models and sizes, GPU/CPU placement (from `ollama ps` + `nvidia-smi`), RAM/VRAM, guarded downloads (oversized models need approval, cloud models blocked), removal with confirmation, active-model selection, inference tests. |

## Architecture

```
 Browser (Windows / MacBook / iPhone)
        │  HTTPS via Tailscale Serve, or HTTP on LAN / localhost
        ▼
 FastAPI app  :8765  ── serves the Next.js static UI + /api  (one origin, one port)
   ├─ security/   Argon2 login, server-side sessions, CSRF, rate limits, upload + path checks, audit log
   ├─ agents/     Master Orchestrator → Syllabus Analyst, AI Tutor, Study Planner, Question Generator,
   │              Answer Evaluator, Revision Coach, Performance Analyst   (controlled tool registry)
   ├─ rag/        extract → OCR → chunk → embed → ChromaDB (data/vector_store) + citations
   ├─ evaluation/ deterministic objective marking, SymPy numeric checks, descriptive guards, Tesseract OCR
   ├─ services/   Ollama client (single-slot queue), model manager, mocks, backup/restore
   └─ SQLite      data/database/examcoach.db  (source of truth for everything)
        │
        ▼  127.0.0.1:11434 only (never exposed)
 Ollama ── qwen3:4b (all agents)  +  embeddinggemma (search)
```

Key design decisions

* **One model, many agents.** All eight agents use `qwen3:4b` with different instructions, tools and workflows. A single-slot async queue (matching `OLLAMA_NUM_PARALLEL=1`) keeps the 6 GB GPU from being oversubscribed; the queue is bounded (8) and long tasks can be cancelled.
* **Deterministic where it matters.** Scheduling, objective marking, numeric checks, SM-2 and readiness are plain Python — the LLM is used for language tasks only, and its output is validated with JSON schemas and Pydantic.
* **Thinking policy.** `qwen3:4b` is a reasoning model. Structured calls (extraction, marking, question generation) run with thinking off and grammar-constrained JSON — fast and bounded on a 4 096-token context. Free-text answers may think; the reasoning arrives in a separate field and is discarded, never stored or shown.
* **Static frontend served by the backend.** Next.js is built once (`output: "export"`) and served by FastAPI on the same port — no Node server at runtime, no CORS, first-party cookies, and a single port to protect.
* **No Docker.** Not needed; everything runs natively on Windows.

```
AIExamCoach/
├── backend/            FastAPI app (api/, agents/, services/, models/, database/, security/, rag/, evaluation/, tests/)
├── frontend/           Next.js 16 + TypeScript + Tailwind 4 (static export → frontend/out)
├── data/               database/, documents/, vector_store/, uploads/, backups/   (created at install, never in git)
├── config/settings.json  non-secret settings (created on first run)
├── logs/               backend + server logs, system-report.json
├── scripts/            install, start, stop, restart, status, autostart, backup, restore, update, network, inspect (.ps1)
└── docs/               REMOTE_ACCESS, TROUBLESHOOTING, TEST_REPORT
```

## Install on the Windows PC

Requirements: Windows 10/11, 16 GB RAM, ~15 GB free disk. An NVIDIA GPU (e.g. GTX 1660 Super, 6 GB) is used automatically by Ollama; without it everything still works on the CPU, more slowly.

1. Get the code onto the PC (e.g. `git clone` this repository, or download the ZIP) and open **PowerShell** in the `AIExamCoach` folder.
2. Inspect the PC (read-only — changes nothing):
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\inspect.ps1
   ```
   This reports Windows version, CPU, RAM, GPU/VRAM, NVIDIA driver/CUDA, disk space, Python/Node/Git/Docker/Ollama/Tesseract, Ollama environment variables, installed models and port conflicts, and saves `logs\system-report.json`.
3. Install:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
   ```
   It shows an installation plan and **asks before every download, installation or system change**: Python 3.12, Node.js LTS (only to build the UI), Tesseract OCR, Ollama (skipped — already installed on your PC), the Ollama user environment variables, and the `qwen3:4b` (~2.5 GB) and `embeddinggemma` (~0.6 GB) downloads. Larger models are never downloaded automatically. Existing files are never overwritten.

Ollama settings applied (user scope; all verified as supported by `ollama serve --help` in Ollama 0.40):

| Variable | Value | Why |
|---|---|---|
| `OLLAMA_NO_CLOUD` | `1` | disables Ollama cloud models and web search |
| `OLLAMA_NUM_PARALLEL` | `1` | one request at a time on 6 GB VRAM |
| `OLLAMA_MAX_LOADED_MODELS` | `1` | never two models in VRAM at once |
| `OLLAMA_CONTEXT_LENGTH` | `4096` | conservative context; 8192 can be tried in Settings |
| `OLLAMA_KEEP_ALIVE` | `5m` | unload after 5 idle minutes |
| `OLLAMA_MAX_QUEUE` | `8` | bounded queue |
| `OLLAMA_HOST` | `127.0.0.1:11434` | Ollama only reachable from this PC |

> With `OLLAMA_MAX_LOADED_MODELS=1`, Ollama swaps between `qwen3:4b` and `embeddinggemma` when a request needs a search and then an answer (a few seconds each time). If you see ~3 GB VRAM free with qwen3 loaded, setting it to `2` removes the swap — both fit in 6 GB.

## Daily use

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Open    # start (checks Ollama, DB, port) and open the browser
powershell -ExecutionPolicy Bypass -File scripts\status.ps1         # backend, frontend, Ollama, model GPU/CPU placement, GPU, DB, network
powershell -ExecutionPolicy Bypass -File scripts\stop.ps1           # stops ONLY this app's process (verified by PID + command line)
powershell -ExecutionPolicy Bypass -File scripts\restart.ps1
powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Enable   # start automatically at Windows sign-in
```

On the Windows PC open **http://127.0.0.1:8765**. The first visit asks you to create your account (Argon2-hashed password, ≥10 characters with upper/lower case and a number).

## Use it as a web app

The Windows PC is the only computer that does any work. It runs the web server, Ollama (qwen3:4b, embeddinggemma), OCR, document processing, the database and the search index. Browsers on the PC, MacBook and iPhone only display pages and send what you type or upload to the PC.

* **Nothing is computed or stored on your devices.** No AI or data processing runs in the browser. There is no offline cache or service worker, and no study data is saved in browser storage. The only things kept are the sign-in cookies. The interface uses system fonts and loads nothing from the internet; every request goes to your PC (verified in a browser test).
* **Install it like an app:**
  * **Windows (Edge/Chrome):** open the app → the install icon in the address bar (or menu → *Apps → Install*).
  * **MacBook:** Safari → *File → Add to Dock*, or Chrome → *Install*.
  * **iPhone:** Safari → *Share → Add to Home Screen*.

  It then opens in its own window with the Exam Coach icon, still served by your PC. Chrome/Edge only offer *Install* over HTTPS or on the PC itself, so use the Tailscale address (`https://…ts.net`) on the MacBook. Safari's *Add to Dock* and iPhone's *Add to Home Screen* also work on the LAN address.
* **Always available:** `scripts\autostart.ps1 -Enable` starts the app automatically when you sign in to Windows; Ollama starts itself at sign-in. Turn it off with `-Disable`. Keep the PC awake for remote use.
* If the PC is off, asleep or unreachable, the app shows a *"Windows host is offline"* banner. It cannot work without the PC, by design.

## First steps

**Create your first examination profile** — *My Examinations* → edit *MBA Semester Examinations* (or **New examination**): set the exam date, target % (default 75), realistic study hours per day and your study days. Switch profiles from the selector at the top of the sidebar; each profile's data is completely separate.

**Upload MBA and SSC study material** — switch to the profile, open *Document Library*, choose the category (**Syllabus**, **Textbook**, **Notes**, **Previous question paper**, **Marking scheme**) and optionally a subject, then **Choose files** (several at once). Processing runs in the background; status turns *indexed* when searchable. Scanned pages are OCR'd automatically. Repeat in the SSC profile for SSC material.

**Build your syllabus** — *Syllabus* → **Analyse** next to your syllabus file → review the draft (rename/remove/add topics, set importance, accept the exam date found in the document) → **Apply to syllabus**. Or add subjects/topics by hand. Mark topics *in progress* / *completed* as you go.

**Generate your first study plan** — *Study Planner* → leave *Number of days* empty to plan until the exam (or enter e.g. 20) → **Generate plan**. Tick sessions done on the dashboard or planner; if you miss sessions, click **Reschedule remaining**. Or just ask the coach: *"Create a 20-day study plan for my MBA examination."*

**Take your first mock exam** — *Mock Exams* → set total marks, duration, format (MBA / SSC / mixed…), subject and difficulty → **Build paper** (generation takes a few minutes on the GPU) → **Start exam**. Answers autosave; flag questions with *Mark for review*; **Submit** (or the timer submits for you). Objective answers are marked instantly, descriptive ones by the evaluator; results and weak topics are saved and feed your 75 % tracker. Only mocks of 20+ marks are used for the readiness estimate.

**Evaluate a handwritten answer** — *Answer Evaluation* → type the question and marks → **Photograph handwriting** (on iPhone this opens the camera) → correct the OCR text → **Evaluate answer**.

**Back up your data** — *Settings → Create backup now*, or:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\backup.ps1 -Destination E:\ExamCoachBackups
```
Backups (`data\backups\examcoach-backup-*.zip`) contain a consistent SQLite copy, your documents, settings, the vector index and a checksummed manifest. Restore with `scripts\restore.ps1 -Path <zip>` (validates checksums + DB integrity, asks you to type RESTORE, takes a safety backup first). *Settings → Export* downloads a profile as JSON.

## MacBook and iPhone access

The PC is the server; the MacBook and iPhone only need a browser. Three modes (switch with `scripts\network.ps1 -Mode …`, then `scripts\restart.ps1`):

| Mode | Who can connect | How |
|---|---|---|
| `local_only` (default) | this PC only | `http://127.0.0.1:8765` |
| `lan` | devices on your Wi-Fi | `http://<PC-IP>:8765` — firewall rule limited to *Private* networks and your local subnet |
| `tailscale` | your own devices anywhere | `https://<pc-name>.<tailnet>.ts.net` via Tailscale Serve (private tailnet, HTTPS) |

Step-by-step Windows/MacBook/iPhone instructions, including Tailscale: **[docs/REMOTE_ACCESS.md](docs/REMOTE_ACCESS.md)**. The PC must stay on, awake and online for remote access; the app shows a banner when the host is unreachable. On iPhone, Safari → Share → *Add to Home Screen* gives an app-like icon.

## Security model

* Login with Argon2id hashes; server-side sessions (only an HMAC of the token is stored), `HttpOnly` + `SameSite=Strict` cookies (`Secure` over HTTPS); CSRF token required on every state-changing request; sessions expire (72 h default); password change signs out other sessions.
* Every profile, document, question, mock and task is authorised against its owner.
* Rate limits on login (10/min) and AI endpoints (30/min); bounded LLM queue.
* Uploads: extension allow-list, magic-byte check, size limit (50 MB default), UUID storage names (user file names never touch the file system), path-traversal protection, duplicate detection. Answer-sheet uploads are deleted after text extraction.
* Never served: `data/` (database, vector store, documents, backups, secrets), `config/`, the Ollama API, API docs (`/docs` and OpenAPI are disabled). Documents are only downloadable by their signed-in owner.
* Local-only AI is enforced in code: the Ollama URL must be a loopback address, cloud models (`*-cloud`) are refused, settings cannot disable it, ChromaDB telemetry is off, and a test scans the code for cloud AI SDKs/endpoints.
* Agents use a **controlled tool registry** (purpose, validated input, permission level, timeout, per-agent allow-list, logging). There is no shell/PowerShell/file-system tool. Destructive tools (e.g. deleting a document) pause for your approval on the Agent Activity page.
* Audit log of logins, failed logins, uploads, deletions, settings, model and backup actions (*Settings*).
* The session secret is generated locally in `data\secrets\` — no secrets in code or git.

## Configuration

`config\settings.json` (created on first start; most options are in *Settings*):

| Key | Default | Notes |
|---|---|---|
| `access_mode` | `local_only` | `local_only` / `lan` / `tailscale` — use `scripts\network.ps1` |
| `port` | `8765` | change if the port is taken, then restart |
| `chat_model` / `embedding_model` | `qwen3:4b` / `embeddinggemma` | change in Model Manager |
| `context_length` | `4096` | try 8192 if VRAM allows |
| `chunk_tokens` / `chunk_overlap_tokens` | `600` / `80` | retrieval tuning |
| `max_upload_mb` | `50` | |
| `ocr_language` / `ocr_low_confidence` | `eng` / `70` | install extra Tesseract languages for e.g. `eng+hin` |
| `default_target_pct` | `75` | per-profile targets override it |
| `max_daily_study_hours` | `10` | planner cap |
| `srs_initial_intervals` | `[1,3,7,14,30]` | spaced-repetition steps (days) |

## Development and tests

```powershell
.venv\Scripts\python -m pip install -r backend\requirements-dev.txt
.venv\Scripts\python -m pytest -m "not ollama"        # 52 fast tests, no AI needed
.venv\Scripts\python -m pytest -m ollama -v           # 13 end-to-end tests against the real local models
cd frontend; npm run dev                              # UI dev server on :3000 proxying /api to :8765
```
See [docs/TEST_REPORT.md](docs/TEST_REPORT.md) for what was executed and the results.
