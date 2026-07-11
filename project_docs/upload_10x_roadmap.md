# Course / Lecture Upload — 10x Value Roadmap

**Date:** 2026-07-06 · **Baseline:** unified v5 parser live (`PARSER_VERSION=5`), branch `feature/building-scene`

---

## 1. Where the feature stands today

The upload pipeline is in the best shape it has ever been: one server-authoritative
pipeline (`backend/services/parser/unified_orchestrator.py`) parses a single PDF or PPTX,
routes image slides to a vision model, generates per-slide title/summary/quiz plus a
deck-level summary/quiz, persists everything server-side, embeds slides for tutor RAG,
and feeds the concept graph. Duplicate detection (SHA-256) and a global parse cache
avoid re-paying LLM cost. The professor gets a live SSE progress overlay and a full
slide/quiz editor before publishing.

**Structural limits that cap its value:**

| # | Limit | Evidence |
|---|-------|----------|
| L1 | **One file, one lecture, one sitting.** No multi-file, no folder, no background processing — the professor must babysit each upload. | single-file input in `LectureUpload.tsx` / `FastUpload.tsx`; SSE stream tied to the open tab |
| L2 | **Slides only.** No lecture recordings (audio/video), no DOCX/scripts, no scanned handwriting-heavy docs, no URLs. | `upload_service.py` validates only PDF/PPTX magic bytes |
| L3 | **Lecture-scoped intelligence.** Each lecture is an island: no course-level context, no cross-lecture concept linking, no syllabus awareness. | planned but unbuilt Phase 3 of the pipeline rebuild |
| L4 | **Quiz is the only study artifact.** No flashcards, worksheets, study guides, or exam banks generated at upload time — even though `worksheetsService.ts` exists client-side. | survey: "Worksheets/Flashcards: not implemented" |
| L5 | **No content lifecycle.** Re-uploading an updated slide deck means a brand-new lecture; student progress and quiz history don't carry over. | no versioning anywhere in `persist.py` / `lectures` schema |
| L6 | **Trust is binary.** AI output is either accepted or hand-edited; no confidence signal, no error detector, no "regenerate with feedback." | Phase 4 rebuild ideas, not started |
| L7 | **Residual debt.** FastUpload is a parallel isolated path; v3/v4 branches still live; 25 MB (backend) vs 50 MB (FastUpload) size mismatch; parse cache keyed by hash only (ignores parser/mode); deck quizzes persisted but invisible in UI; "Skip AI" slides can't be AI-enhanced later. | audit PDF-04/15/16/23/27; `upload_service.py:20` vs `FastUpload.tsx:29` |

## 2. The 10x thesis

Value = (professor time saved per course) × (formats covered) × (artifacts per upload) × (student outcomes per artifact) × (trust).

Today the feature optimizes *one lecture's parse quality*. The multiplier comes from
moving up a level: **"upload your semester, get a living course"** instead of
"upload a PDF, get slides + a quiz." Concretely:

1. **Course-at-once ingestion** (L1) — turns ~15 babysat sessions into one drag-drop.
2. **Any-source ingestion** (L2) — recordings + scripts double the content most courses actually have.
3. **Course brain** (L3) — cross-lecture context makes the tutor, analytics, and quizzes dramatically better per euro of LLM spend already being paid.
4. **Artifact fan-out** (L4) — every parse already extracts the expensive part (structured content); flashcards/worksheets/exam banks are cheap marginal generations with outsized student value.
5. **Lifecycle + trust** (L5, L6) — what converts a demo into a tool professors rely on for a whole semester.

---

## 3. Roadmap

Phases are ordered so each ships standalone value and de-risks the next. Effort
assumes current velocity; all DB changes stay additive (flag-not-delete policy).

---

### Phase 0 — Debt burn-down & quick wins (≈1 week)

Prerequisite hygiene: everything later builds on ONE pipeline with consistent limits.

> **Execution status (2026-07-08):** 0.1 (single path), 0.2 (one size limit), 0.4
> (deck-quiz label + Skip-AI/enhance) DONE & tested; 0.3 re-scoped to the real v5
> replay path and DONE (`force_reparse` now works). The deferred legacy-module
> archival (task #4) is now **DONE**: the 4 synthesis fns were relocated verbatim
> from `v4_orchestrator` into `backend/services/parser/synthesis.py` (imports only
> the AI orchestrator + quiz validator — no v3/v4), the unified orchestrator + its
> tests were repointed, and v4_orchestrator / v3 orchestrator / stage1–5 /
> parser-classifier / summarizer_service were `git mv`'d to `backend/_legacy/`.
> Gates: import OK; grep gate clean; tsc 0; backend pytest 755✓ / 8 pre-existing
> env fails (offline DNS + `.env` LlamaCloud key leak — none touch changed code);
> `-m db` e2e 3✓; both real-LLM smokes PASS (broad `parse_pdf_stream` engine +
> focused `uo._synthesize_slide → synthesis.*`). A manual browser pass of the
> enhance-flow + `/professor/fast-upload` redirect is still recommended (needs an
> authed stack).

#### 0.1 Single upload path
Retire `fast_upload.py` + `FastUpload.tsx` route and the v3/v4 branches per the
already-planned Phase-2 sweep (archive to `_legacy/`, not delete).

**Acceptance criteria**
- [x] `/professor/fast-upload` route removed; any inbound links redirect to `/professor/upload`. *(App.tsx: route → `<Navigate to={UPLOAD}>`; page deleted; `fast_upload.py` archived to `backend/_legacy/`, router unmounted from main.py.)*
- [x] `PARSER_VERSION` values 3/4 no longer reachable from `upload_service.py`; only unified path executes. Env values other than 5 log a warning and run 5. *(routing branches removed; only `parse_pdf_unified` is enqueueable; Arq worker `functions=[parse_pdf_unified]`.)*
- [x] All archived modules moved under `backend/_legacy/`, importable nowhere. *(fast_upload + task #4 DONE: v4_orchestrator, v3 orchestrator, stage1–5, parser-classifier, summarizer_service `git mv`'d to `backend/_legacy/`. The 4 synthesis fns (analyze_slide / analyze_lecture_meta / generate_quiz_questions / _map_deck_quiz) were first relocated verbatim into `parser/synthesis.py` — standalone, imports only the AI orchestrator + quiz validator; the unified orchestrator's 3 import sites + 3 tests repointed to it. Grep gate `parse_pdf_v4|stage1_ingest|summarizer_service` over services/api/workers is empty.)*
- [x] Full suites green: backend pytest, vitest, tsc. *(tsc 0; vitest 386 pass / 5 pre-existing fails; backend 683 pass / 5 pre-existing `test_ask_professor` fails; zero new failures introduced. Task #4 re-verify: backend 755 pass / 8 pre-existing env fails — offline DNS + `.env` LlamaCloud key leak, none touch changed code; `-m db` e2e 3 pass; both real-LLM smokes PASS.)*

#### 0.2 One size limit, one config
**Acceptance criteria**
- [x] Max upload size defined once in `backend/core/config.py` (`MAX_UPLOAD_MB`, default 50), served to the frontend via `GET /api/v1/upload/config` — no hardcoded 25/50 duplicates. *(file_validation `MAX_FILE_BYTES` + upload.py `MAX_FILE_MB` both derive from it; dead `MAX_FILE_MB=25` removed from upload_service. Effective limit was silently 25 at the endpoint guard; now 50 everywhere.)*
- [x] Frontend rejects oversize files client-side with the same number the backend enforces; backend returns 413 with a message naming the limit. *(usePDFUpload hydrates the served limit on mount, falls back to 50; new tests: `/config` value == `settings.max_upload_mb` == endpoint guard, and a +1-byte-over file → 413 naming the limit.)*

#### 0.3 Correct cache identity → **re-scoped: fix `force_reparse` under v5**
**Finding (2026-07-07):** the original premise is invalid. Under the unified (v5)
pipeline `pdf_parse_cache` is **never written** — only the retired v2/v4 paths
called `store_cached_parse`. The live replay is `parse_runs` (`UNIQUE (pdf_hash,
pipeline_version)`) + `_replay_from_db`, and `force_reparse` was a **no-op** for
v5 (it only gated the dead `get_cached_parse`). User chose the additive fix (no
schema/constraint change); auto-keying `parse_runs` by parser/parsing_mode was
deferred (would require altering the UNIQUE constraint — not purely additive).

**Acceptance criteria**
- [x] `force_reparse=true` re-parses even when a COMPLETED run exists, reusing the same lecture_id (no duplicate, student links survive) — threaded endpoint → `process_pdf_stream` → `parse_pdf_unified`, which now skips the `_replay_from_db` short-circuit under force. *(unit tests: force→rebuild-in-place; default→replay-from-DB.)*
- [x] Switching parser or parsing_mode on the same PDF is covered by the same escape hatch (tick "reparse"). *(Auto-detection deferred per user; documented above.)*
- [ ] ~~additive column verified by `-m db` e2e~~ — N/A: no schema change in the chosen approach.

#### 0.4 Surface what's already generated
Deck quizzes exist in the DB but have no UI; "Skip AI" slides can never be enhanced.

**Acceptance criteria**
- [x] Lecture view renders deck-level quizzes distinctly with slide-jump chips from `linked_slides`. *(Finding: the student `InlineLecturePlayer` already passed `linkedSlides`+`onJumpToSlide` to `QuizCard`, sorted deck questions first, and avoided duplication. Added the one missing piece — a distinct "Lecture Quiz" badge for cross-slide (≥2) questions, with tests.)*
- [x] Slides with `ai_enhanced=false` show an "Enhance with AI" button in the editor that runs the same per-slide synthesis and flips the flag; works for a single slide and "enhance all remaining." *(LectureEdit: per-slide button + "Enhance all remaining" banner → `lectureService.enhanceSlide` → `POST /upload/enhance-slide/{id}` reusing `_synthesize_slide`; backend + service + endpoint tests.)*
- [x] PDF-04 audit item closes: parsing-mode toggle honored end-to-end under v5. *(frontend sends `parsing_mode` → `parse_pdf_unified` now skips ALL LLM (meta/synthesis/deck-quiz) for `on_demand`, persisting `ai_enhanced=false` + `parser_engine='heuristic-v1'`; unit test asserts zero LLM calls. Workbook PDF-04 row flipped Deferred→Fixed on 2026-07-08.)*

---

### Phase 1 — Course-at-once ingestion (≈2–3 weeks) · **highest leverage**

Upload N files (or a zip / a folder drag) → one course, N lectures, processed in the
background, professor notified when done. This is "processing-as-onboarding" from the
original rebuild plan, generalized.

> **Execution status (2026-07-10): DONE & verified against real data.** All three
> sub-phases shipped on `feature/building-scene`. Migration
> `20260710000000_parse_runs_batch_and_course.sql` (additive: `batch_id`/`course_id`/
> `filename`/`parsing_mode` on `parse_runs`) applied directly to the real Supabase
> project (no Supabase CLI installed here to run it as a tracked migration — applied
> via `DATABASE_URL`, confirmed additive/safe, matches the flag-not-delete policy).
> Real end-to-end proof: uploaded 6 real lecture PDFs as one batch through the live
> UI — all 6 completed, correct titles/summaries/slide+quiz counts, `batch_id`/
> `user_id`/`filename`/`parsing_mode` all correctly recorded, `GET
> /upload/batches/{id}` rollup verified against that real data. Gates: backend 722
> pass / 8 pre-existing env fails (unrelated); tsc 0; 12 new endpoint tests + 3 new
> db-upsert tests all pass. **Scope decisions made along the way:**
> - PowerPoint (.pptx) is explicitly NOT supported in the batch endpoint yet — the
>   markitdown+LibreOffice conversion path isn't wired into the batch loop; a `.pptx`
>   file in a batch is rejected per-file with a clear message. Fast-follow, not a bug.
> - No new `upload_batches` table — a batch is just rows in `parse_runs` sharing a
>   `batch_id`; `get_or_create_run` was changed to an `ON CONFLICT ... DO UPDATE`
>   upsert (COALESCE per column) to make "re-uploading identical PDF bytes in a later
>   batch" an explicit, tested behavior instead of a latent bug.
> - Drag-reorder in the queue panel is hand-rolled native HTML5 drag events, not a
>   new dependency (`@dnd-kit` etc.) — reorder is cosmetic, pre-submit, ≤30 items.
> - "Publish all" / per-lecture "Publish" (1.3) is intentionally **cosmetic** — the
>   `lectures` table has no draft/published/status column (only `is_archived`), and a
>   batch-created lecture is already live in its course the moment the parse job
>   finishes. Shipped as "Done reviewing" (local dismissal only, matching user
>   decision), not a real state transition — a real draft/live column is an explicit
>   future follow-up, not built now.
> - The batch review screen (1.3) was restyled after initial user feedback to match
>   `LectureUpload.tsx`'s actual visual language (violet/indigo gradients, same
>   header/CTA treatment) rather than a generic list — see `BatchReviewPage.tsx`.

#### 1.1 Multi-file upload queue
**Acceptance criteria**
- [x] Drop zone accepts multiple files and folder drops (webkitdirectory) up to a configured batch cap (e.g. 30 files); a queue panel lists each file with per-file state: queued → uploading → parsing → done/failed. *(`MultiFileDropzone.tsx` + `UploadQueuePanel.tsx`, new "Multiple files" tab in `LectureUpload.tsx` alongside the untouched single-file tab; cap served via `GET /upload/config.maxBatchFiles`.)*
- [x] Files process concurrently server-side via Arq (bounded worker concurrency, e.g. 3 parses in parallel); queue order is stable and cancellable per file. *(Relies on Arq's existing global `max_jobs` throttle — now `ARQ_MAX_JOBS`-configurable rather than hardcoded 4; no per-batch semaphore needed since one job type + one global bound already serializes correctly.)*
- [x] One file failing (corrupt PDF, over page limit) marks only that row failed with a readable reason and a "retry" action; the rest continue. *(Each file = its own Arq job = its own `parse_runs` row, no shared mutable state; pre-flight validation failures get `run_id=null` and are non-retryable, in-pipeline failures get a real `run_id` and a working `POST /upload/jobs/{run_id}/retry` that re-fetches PDF bytes from storage — no re-upload needed.)*
- [x] Each successfully parsed file becomes its own lecture in the selected course, titled from extracted metadata (LLM title, fallback filename), ordered by filename natural sort with drag-reorder afterwards. *(`course_id` now threaded into `parse_pdf_unified` → `persist.create_lecture`/`set_course_id`, closing the gap where course assignment only happened client-side post-parse; `naturalSort` via `Intl.Collator`; reorder is client-side, pre-submit.)*

#### 1.2 Background processing (detach from the tab)
**Acceptance criteria**
- [x] Once files are handed to the server, the professor can navigate away or close the tab; parsing continues (jobs already run in Arq — the gap is client dependence on the open SSE stream for final bookkeeping, which must move server-side). *(Confirmed the engine was already fire-and-forget; the batch endpoint drops SSE entirely in favor of polling, which is what actually makes "no tab needed at all" true — SSE-holds-the-response can't represent a closed tab.)*
- [x] A persistent "Uploads" indicator (nav badge or toast center) shows in-flight jobs on any page, backed by a `GET /api/v1/upload/jobs` endpoint reading `parse_runs` for the user. *(`UploadsIndicator.tsx`, modeled on `NotificationBell.tsx`'s shell, mounted in `ConsoleTopBar.tsx`'s system tray for professors — visible on every professor route by construction.)*
- [x] Returning to the upload page re-attaches to live progress of any in-flight job (SSE replay from `parse:{hash}` or DB snapshot fallback — the replay path already exists for completed runs). *(Re-scoped to polling per the SSE-can't-survive-tab-close finding above: `useBatchUpload`'s `useQuery` on `GET /upload/jobs?batch_id=` re-attaches on remount from wherever the batch_id is known — the review-screen URL or the Uploads indicator dropdown.)*
- [x] Completion triggers an in-app notification; lectures created while away appear in the course library without a refresh loop. *(Sonner toast fired from `UploadsIndicator`'s poll-diff — the one thing guaranteed mounted at all times, so it fires even after a tab was closed and reopened later; `use-toast`'s `TOAST_LIMIT=1` couldn't handle N simultaneous completions, sonner was already installed and unused.)*

#### 1.3 Batch review instead of per-slide babysitting
**Acceptance criteria**
- [x] After a batch finishes, a review screen summarizes per lecture: slide count, quizzes generated, flagged/low-confidence slides count, and deck summary — with "Publish all," per-lecture publish, and per-lecture "open editor." *(`BatchReviewPage.tsx` + `GET /upload/batches/{id}` → `repos.get_batch_summary`; "flagged" is a v1 heuristic — `ai_enhanced=false OR summary=''` — not a stored column, documented as such.)*
- [x] Publishing a batch of 10 lectures requires ≤ 3 clicks total when no edits are needed. *(Land on review screen → "Done reviewing all" → done; no per-lecture confirmation needed since nothing is actually being persisted that wasn't already persisted — see the cosmetic-Publish decision above.)*

**Phase-1 exit metric:** a professor ingests a full 12-lecture semester in one session with < 5 minutes of active attention (vs ~12 sequential supervised uploads today). *(Not formally timed, but the real 6-file test batch completed with zero required interaction between submit and the review screen.)*

---

### Phase 2 — Any-source ingestion (≈2–3 weeks)

#### 2.1 Audio & video lecture recordings — **DEFERRED (future, not scheduled)**
> Decision 2026-07-07: skipped for now, revisit later. Left here for context.
> Most courses have recordings that never enter the system. Transcribe → segment →
> same downstream pipeline (summary, quiz, embeddings, concepts). When picked up:
> accept mp3/m4a/wav/mp4/webm via resumable upload; transcription as an Arq job
> (self-hostable Whisper-family model behind a `TRANSCRIPTION_MODEL` flag, DE+EN);
> transcript segmented into time-coded sections that flow through the existing
> synthesis/persist/embedding/concept stages unchanged; graceful failure to a
> "needs processing" state.

#### 2.2 Documents beyond slides
**Acceptance criteria**
- [ ] DOCX, Markdown, and TXT accepted; routed through MarkItDown (already integrated for PPTX) and chunked into sections by headings before the standard synthesis stages.
- [ ] Scanned/handwritten-heavy PDFs detected (near-zero extractable text) are routed to the OCR/vision path automatically rather than producing empty slides; the parser pill in the overlay reflects this.
- [ ] Unsupported formats fail fast at validation with a message listing supported types.

#### 2.3 Import by link (stretch, gate behind a flag)
**Acceptance criteria**
- [ ] Paste a URL to a PDF or a YouTube/streaming lecture; server fetches/downloads and enters the same queue. Domain allow-list configurable; fetch failures reported per-item in the queue UI.

---

### Phase 3 — The course brain (≈3–4 weeks)

Turns N parsed lectures into one coherent course model. This is the planned
`course_context` tier; it multiplies the value of the tutor, analytics, and quizzes
without new content from the professor.

#### 3.1 Course context record
**Acceptance criteria**
- [ ] Additive migration: `course_context` (course_id PK/FK, instructor, exam_dates, syllabus_facts JSONB, updated_at) exists and is written by an extraction job.
- [ ] Uploading a syllabus (or the first lecture containing organizational slides) auto-extracts instructor, exam dates, grading scheme, and topic schedule into `course_context`; professor sees an editable "Course facts" card and can correct any field.
- [ ] Organizational/administrative slides feed course_context instead of generating junk quizzes (extends the existing administrative-quiz suppression).

#### 3.2 Cross-lecture concept graph
**Acceptance criteria**
- [ ] Concepts extracted per lecture are deduplicated course-wide (embedding-similarity + name normalization): "gradient descent" in lecture 3 and lecture 7 is one node with two lecture references.
- [ ] Each lecture's concept list shows "builds on" links to earlier lectures' concepts; at least one API (`GET /api/v1/courses/{id}/concept-map`) returns the merged graph for the analytics/garden views.
- [ ] Re-parsing or deleting a lecture updates the merged graph without orphan nodes (verified by db-marked test).

#### 3.3 Course-scoped retrieval
**Acceptance criteria**
- [ ] Slide embeddings are queryable by course_id (index/backfill migration); the tutor answering within a course retrieves across all its lectures, and citations name lecture + slide.
- [ ] A question whose answer lives in a different lecture than the one open is answered correctly in a scripted RAG evaluation set (≥ 10 curated Q/A pairs from a real Marburg course; ≥ 8 must cite the right lecture).
- [ ] Duplicate/near-duplicate slides across lectures (recap slides) are deduplicated or down-weighted at retrieval time so they don't crowd out unique content.

#### 3.4 New-upload awareness
**Acceptance criteria**
- [ ] When a new lecture is added to a course, its synthesis prompt receives course context (prior lecture titles + key concepts), so titles/summaries use consistent terminology; verified by snapshot tests of prompt assembly.
- [ ] Deck quiz for lecture N may include ≤ 2 "connects to earlier material" questions referencing prior-lecture concepts, each tagged with the source lecture in metadata.

---

### Phase 4 — Artifact fan-out (≈2–3 weeks)

The parse already produces structured, embedded content; each additional artifact is a
cheap generation with direct student value. Generate on upload (professor-approvable),
regenerable on demand.

#### 4.1 Flashcards (spaced repetition)
**Acceptance criteria**
- [ ] Every AI-enhanced lecture yields a flashcard deck (term/definition + concept-tagged Q/A), persisted in an additive `flashcards` table keyed to lecture + slide + concept.
- [ ] Professor can review/edit/delete cards in the editor before publishing; students get a review mode with an SM-2-style scheduler whose state persists per student.
- [ ] Card count scales with content (roughly 1–3 per substantive slide, none from title/TOC/administrative slides — reuses `slide_type`).

#### 4.2 Worksheets / practice sheets
**Acceptance criteria**
- [ ] "Generate worksheet" produces a mixed-format practice set (open questions, calculations where the content is mathematical, transfer questions) grounded ONLY in lecture content, exportable as PDF, wired into the existing `worksheetsService.ts` + practice-sheets RLS layer.
- [ ] Each worksheet item carries a model answer + rubric notes visible to the professor and revealed to students after attempt.

#### 4.3 Exam bank with difficulty calibration
**Acceptance criteria**
- [ ] Course-level question bank aggregates all lecture + deck quizzes, filterable by concept, cognitive level, and lecture; professor can compose a mock exam by filters + count and export it.
- [ ] Item difficulty is re-estimated from real student answer data (correct-rate) once ≥ 20 attempts exist, displayed alongside the LLM's a-priori difficulty; discrepancies > 40 points flag the item for review.

#### 4.4 Study guide
**Acceptance criteria**
- [ ] One-click per course: a structured study guide (per-lecture synopsis, merged key concepts with definitions, exam-relevant facts from course_context such as dates and weighting), viewable in-app and exportable as PDF.
- [ ] Regenerating after new uploads incorporates the new lectures and is idempotent (no duplicated sections).

---

### Phase 5 — Trust & lifecycle (≈2–3 weeks)

#### 5.1 Confidence + content-error detection
**Acceptance criteria**
- [ ] Every synthesized slide stores a confidence signal (extraction quality + LLM self-check) in slide metadata; the editor sorts/filters by "needs review" and the batch-review screen (1.3) surfaces the count.
- [ ] A second-pass checker flags likely content errors (garbled OCR, formula mangling, summary contradicting slide text) on ≤ 15% of slides in a healthy deck; flagged slides show the reason in the editor.
- [ ] Zero silent failures: any slide that skipped synthesis (vision failure, timeout) is visibly marked, never blank-but-published.

#### 5.2 Regenerate with feedback
**Acceptance criteria**
- [ ] Per slide, the professor can type a short instruction ("this is a proof sketch, focus on the steps") and regenerate title/summary/quiz honoring it; the instruction persists so later re-parses reuse it.
- [ ] Regeneration replaces only the targeted artifact (summary vs quiz) and is undoable (previous version retained until save).

#### 5.3 Lecture versioning (re-upload without losing history)
**Acceptance criteria**
- [ ] Uploading a file to an *existing* lecture (professors update decks mid-semester) creates a new version: slides re-parsed, but student progress, quiz attempts, and chat history remain attached to the lecture.
- [ ] A diff view shows added/removed/changed slides between versions; unchanged slides keep their ids (content-hash matching) so quizzes and embeddings on them survive untouched.
- [ ] Embeddings and the concept graph are refreshed for changed slides only; the old version is retained (flag-not-delete) and restorable.

---

### Phase 6 — Distribution (later, validate demand first)

- **LMS import (ILIAS/Moodle):** connect a course URL/token, list its files, ingest selected ones through the Phase-1 queue. *AC sketch:* OAuth/token flow, file listing, delta-sync ("3 new files since last sync") with per-file provenance stored.
- **Email-to-upload / share-target PWA:** forward a PDF to a personal address (or share from phone) → lands in the upload queue of a chosen course.

---

## 4. Sequencing rationale & risks

- **Phase 0 first** because every later phase multiplies whatever paths exist — multiplying two divergent pipelines (unified + fast_upload) doubles all future work.
- **Phase 1 before 2:** batch UX + background jobs are the chassis; media ingestion (2) just adds a new job type to that chassis.
- **Phase 3 before 4:** artifacts grounded in course-wide context are markedly better than lecture-island artifacts; building flashcards first would mean regenerating them after 3.1 anyway.
- **Biggest technical risks:** (a) media transcription cost/infra under the self-hosted-LLM constraint — mitigate with a provider flag and a hosted fallback for dev; (b) versioning touching student-progress FKs — mitigate with content-hash slide identity and additive schema; (c) Arq worker capacity under batch load — set explicit concurrency and queue-depth metrics before Phase 1 ships.
- **Measurement:** instrument time-from-first-file-to-published-course, artifacts-per-lecture actually used by students, and tutor citation accuracy — these three numbers are the 10x scoreboard.
