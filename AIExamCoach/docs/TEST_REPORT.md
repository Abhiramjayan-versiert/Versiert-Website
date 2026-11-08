# Test report

Date: 8 November 2026. Every result below was **actually executed**; items that could not be executed are listed as such with the reason.

## Where the tests ran

Development and testing happened in a **Linux cloud container** (4 vCPU, 15.7 GB RAM, **no GPU**), not on the target Windows PC — no Windows machine was attached to the development session. Real Ollama **0.40.15** was installed in the container with the real models **qwen3:4b (Q4_K_M, 2.5 GB)** and **embeddinggemma (768-dim)**, plus Tesseract 5.3.4, so all AI tests ran against the same local models the app uses on Windows — on CPU, at ~7.8 tokens/s.

## Automated suites

| Suite | Command | Result |
|---|---|---|
| Unit + API + security (no AI) | `pytest -m "not ollama"` | **52 passed** |
| End-to-end against real Ollama | `pytest -m ollama -v` | **13 passed** (11 min 40 s on CPU) |
| Frontend type-check + production build | `npm run build` | **passed** — 21 static pages, 0 type errors |
| Browser end-to-end (Playwright/Chromium) | `ui_test.js` (desktop 1440×900 + iPhone 14) | **passed** — 0 console errors, 0 horizontal overflow on iPhone |

## Required test list

| # | Test | Status | Evidence |
|---|---|---|---|
| 1 | Ollama installation detection | ✅ Executed | `test_01`: version + installed models detected, nothing missing. `inspect.ps1`/`status.ps1` do the same on Windows (not executed — see below). |
| 2 | Qwen3 4B inference | ✅ Executed | `test_02`: reply received, no `<think>` leakage, 7.85 tok/s on CPU. |
| 3 | GPU acceleration verification | ⚠️ Logic only | No GPU in the container. Placement is computed from `ollama ps` (`size_vram / size`) and `nvidia-smi`; in the container it correctly reported **CPU**. Must be confirmed on the GTX 1660 Super with `scripts\status.ps1` / Model Manager. |
| 4 | EmbeddingGemma inference | ✅ Executed | `test_03`: 768-dimension vectors. |
| 5 | Document upload | ✅ Executed | `test_04`, browser test; validation tests reject `.exe`, spoofed PDFs, empty files, traversal file names. |
| 6 | PDF text extraction | ✅ Executed | `test_pdf_pages_are_real` (page numbers preserved), DOCX headings + tables, PPTX slides, XLSX, CSV, cp1252 TXT. |
| 7 | OCR | ✅ Executed | Tesseract on a rendered image (confidence > 50 %) and on a scanned PDF page (auto-OCR fallback). |
| 8 | Vector indexing | ✅ Executed | `test_04`: chunks embedded and stored in ChromaDB, status *indexed*. |
| 9 | Source retrieval | ✅ Executed | Search returns `fm_textbook.pdf`, **page 2** (the real page). Chat answer cites `[S1] fm_textbook.pdf, p. 2`; test requires ≥1 real citation. |
| 10 | Syllabus extraction | ✅ Executed | `test_05`: all units/topics extracted, **every topic verified against the source text** (no hallucinations), marks read (100 total; 15/25/30/30 per unit), exam date `15/03/2027` found, draft applied. |
| 11 | Study plan generation | ✅ Executed | Unit: never exceeds daily hours, ends before exam, learn/revise/mock sessions, cap on unrealistic hours, reschedule after a missed session. E2E `test_06`: chat "Create a 20-day study plan…" → Orchestrator → Planner → plan saved, ≤ 20 days. |
| 12 | Question generation | ✅ Executed | `test_07`: validated MCQs (option/answer indices checked, citations only to real chunks). `test_08`: numerical answer equals Python evaluation of the expression. |
| 13 | Mock examination | ✅ Executed | Unit + browser: start, timer, autosave, mark-for-review, submit; answer key hidden before submission in exam mode; deadline enforced server-side; practice mode reveals per question. |
| 14 | Objective answer marking | ✅ Executed | MCQ, MSQ partial/wrong-option rule, T/F, fill-in-blank with typo tolerance, numerical tolerance, negative marking; mock scored 5/6 = 83.3 % and 3/3 in the browser. |
| 15 | Descriptive answer evaluation | ✅ Executed | `test_09` real model: good 5-mark answer **4.0/5**; keyword-only list **0.0/5**. All 10 required feedback fields present. `test_10`: student's wrong arithmetic (`5000*8*3/100 = 1300`) detected by Python, marks capped. |
| 16 | SQLite persistence | ✅ Executed | All features persist through the API; DB integrity check; backup → verify → tamper detection; restore requires confirmation. |
| 17 | Revision scheduling | ✅ Executed | SM-2 intervals (1 → 3 days, lapse resets, ease grows), review via API, wrong answers become mistake cards due tomorrow, quick quiz grading. |
| 18 | Performance analytics | ✅ Executed | Readiness indicators, "insufficient data" when there is none, estimate only from ≥ 20-mark timed mocks (60 % mock → gap 15 to 75 %), dashboard + analytics endpoints, readiness via chat with disclaimer. |
| 19 | Authentication | ✅ Executed | Login required, setup only once, Argon2 hashes, wrong password, login rate limit (429), CSRF required, cross-user isolation (404 on another user's profile/documents), audit log, security headers. |
| 20 | Responsive frontend | ✅ Executed | Screenshots of all 15 pages (desktop) and 8 pages + menu (iPhone 14); no overflow; bottom navigation on mobile. |
| 21 | Local network access | ✅ Executed (Linux) | LAN mode: app reachable on the machine's network IP; Ollama port refused from the network. Local-only mode: network IP refused, 127.0.0.1 works. The Windows Firewall rule in `network.ps1` was not executed (no Windows). |
| 22 | Tailscale remote access | ❌ Not executed | Requires a Tailscale account and your devices. Implemented in `network.ps1 -Mode tailscale` (`tailscale serve --bg --https=443 http://127.0.0.1:8765`) and documented in `REMOTE_ACCESS.md`. Verify on the PC. |
| 23 | Offline inference | ✅ Executed | Ollama started inside a Linux network namespace with **no external network** (only loopback; `https://ollama.com` unreachable): qwen3:4b answered `{"answer": "144"}`, embeddinggemma returned 768-dim vectors. |

Also verified: local-only enforcement (remote Ollama URLs, `*-cloud` models and disabling the flag are all rejected; settings API cannot change them), a static scan finds no cloud AI SDKs/endpoints, controlled tool registry (unknown tools/agents refused, destructive tool requires approval, input validated), task cancellation (`test_13`), static-file path traversal blocked, data/config directories never served.

## Bugs found by testing and fixed
1. `ToolRegistry.call` received `tracker` twice → every agent tool call would have crashed. Fixed (found by unit test).
2. Arithmetic-step checker misread chained equalities (`SI = 5000*8*3/100 = 1200`). Rewritten.
3. qwen3:4b is a thinking model: with `think:false` reasoning leaked into answers; with thinking on, syllabus extraction ran past 10 minutes. Fixed with a thinking policy (structured calls: thinking off + grammar-constrained JSON — 61 s on CPU instead of a timeout; free text: thinking kept in a separate field and discarded, capped, with automatic retry).
4. Per-unit marks were omitted by the model → deterministic marks reader added.
5. Document questions were routed to the Tutor instead of cited Q&A → routing rule added; test now requires a real citation.
6. Next.js prefetches with `HEAD` → static route returned 405. Fixed.
7. Exam timer showed `00:00` before its first tick. Fixed.
8. A 2-question quiz produced "85 % — On target". Readiness estimate now requires ≥ 20-mark timed mocks.

## Not executed on Windows
The PowerShell scripts (`inspect`, `install`, `start`, `stop`, `restart`, `status`, `backup`, `restore`, `update`, `network`) were written for Windows PowerShell 5.1 and reviewed (ASCII-only, no PowerShell 7-only syntax, explicit exit-code checks), but **could not be executed** because no Windows machine was attached to the development session. The Python commands they call (`backend.main`, `backend.services.backup create/verify/restore`, DB init) were executed and tested. Please run `scripts\inspect.ps1` first on the PC; it is read-only.
