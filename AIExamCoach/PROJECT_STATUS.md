# Project status

_Last updated: 8 Nov 2026_

## Current state
Feature-complete v1.0. Backend, agents, frontend, scripts and docs are implemented; automated tests pass (52 unit/API, 13 end-to-end with real qwen3:4b + embeddinggemma, browser E2E). Not yet run on the target Windows PC — see "Next steps".

## Checklist
### Phases
- [x] 1 PC inspection — `scripts/inspect.ps1` (read-only; must be run on the PC)
- [x] 2 Project structure and environment
- [x] 3 Ollama + models verified (in dev container; env vars checked against `ollama serve --help` 0.40.15)
- [x] 4 Backend, SQLite, authentication
- [x] 5 Model manager + local inference service
- [x] 6 Extraction, OCR, embeddings, RAG with real citations
- [x] 7 Orchestrator + 7 specialised agents + tool registry
- [x] 8 Profiles, syllabus management, study planning
- [x] 9 Question generation, mock exams, answer evaluation
- [x] 10 Revision, analytics, 75 % target engine
- [x] 11 Responsive frontend (15 pages)
- [x] 12 Windows management scripts, backup/restore
- [x] 13 LAN + Tailscale configuration (script + docs)
- [x] 14 Tests, fixes, documentation

### Pending / to verify on the Windows PC
- [ ] Run `scripts\inspect.ps1`, then `scripts\install.ps1` (approve each step)
- [ ] Confirm GPU placement (Model Manager → *Loaded now* should say **GPU**; `scripts\status.ps1`)
- [ ] Try `network.ps1 -Mode lan` (as Administrator) and/or `-Mode tailscale`; open from MacBook and iPhone
- [ ] Optional: test `context_length` 8192 and `OLLAMA_MAX_LOADED_MODELS=2` if VRAM allows

## Known issues / limitations
- PowerShell scripts not executed on Windows yet (no Windows machine attached during development).
- Tailscale flow not executed (needs your account/devices).
- GPU speed not measured (dev container had no GPU; CPU speed was ~7.8 tokens/s).
- Handwriting OCR uses Tesseract, which is weaker on cursive handwriting than on print; the app always shows the extracted text for correction and requires confirmation when confidence is low. PaddleOCR was not added (heavy dependency, uncertain on this hardware).
- DOCX files have no page numbers; citations use the section heading instead (never an invented page).
- With `OLLAMA_MAX_LOADED_MODELS=1`, Ollama swaps between the chat and embedding models (a few seconds).
- Single-process backend: in-memory rate limits and task handles reset on restart (interrupted tasks are marked failed and can be re-run; submitted mocks can be re-evaluated).

## How to resume development
- Backend: `AIExamCoach/backend` (FastAPI). Entry `backend/main.py`. Tests `backend/tests` (`pytest -m "not ollama"` / `-m ollama`).
- Frontend: `AIExamCoach/frontend` (Next.js static export → `frontend/out`, served by FastAPI).
- Agents: `backend/agents/orchestrator.py` (routing rules + handlers), `tools.py` (tool registry), one module per agent.
- Docs: `README.md`, `docs/`.
