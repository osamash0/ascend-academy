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

> **Execution status (2026-07-11):** a reality-check survey (same method as
> Phase 3/4) found this AC's three items are at wildly different levels of
> readiness — one already fully done, one already ~90% done (just needed a
> cosmetic signal), and one genuinely large and correctly left unbuilt.
> Shipped this pass: the vision-routing signal (AC2's remaining gap). AC1
> (DOCX/MD/TXT) is **deliberately deferred** — full rationale below; it's a
> bigger, riskier lift than anything built solo elsewhere in this roadmap
> pass and deserves its own dedicated design session rather than a rushed
> architecture change to the live parsing pipeline.

**Acceptance criteria**
- [ ] DOCX, Markdown, and TXT accepted; routed through MarkItDown and chunked into sections by headings. **Deferred — genuinely unbuilt, and harder than the roadmap implies.** Findings:
  - MD/TXT text extraction already works with zero code/dependency changes: `markitdown_service.extract_pages()` (`backend/services/markitdown_service.py`) is already format-agnostic — it passes the real file extension straight to the vendored `MarkItDown` library, whose plain-text converter natively handles `.txt/.md` today. DOCX needs exactly one new dependency (`mammoth`, not in `requirements.txt` yet) — the converter code is already vendored.
  - The real blocker: `office_convert.to_pdf()` is **hardcoded** to force a `.pptx` extension on whatever it's given (so LibreOffice always treats the input as a slide deck), and the entire unified pipeline is PDF-page-centric (`unified_orchestrator._extract_pages` always does `fitz.open(..., filetype="pdf")`). This works for PPTX only because LibreOffice's PPTX→PDF conversion happens to produce exactly one PDF page per slide, which is what lets `odl_pages[i+1]` line up with `fitz` page `i`. A DOCX/MD/TXT document has no natural "page" concept, so generalizing `to_pdf()` does NOT automatically preserve a page-count that lines up with heading-chunk-count — a real architectural risk the original roadmap text doesn't mention at all.
  - Heading-based chunking logic doesn't exist anywhere in the codebase and must be built from scratch (no `MarkdownHeaderTextSplitter`-equivalent, no reusable heading-split utility — only a heading-*picker*, `markitdown_service._title_from_chunk`, used for labeling, not splitting).
  - A pre-existing, unrelated gap must be solved as a shared prerequisite before this can reach the Phase-1 batch upload path at all: `/upload/batch` already explicitly rejects `.pptx` per-file ("upload it individually") because the markitdown+LibreOffice conversion path was never wired into the batch job loop — DOCX/MD/TXT would hit the identical gap.
  - Two architecturally distinct paths were identified for whoever picks this up: **(a)** generalize `office_convert.to_pdf` for real DOCX/TXT LibreOffice conversion and force a page break per heading before conversion, so the existing page-per-chunk invariant holds; or **(b)** add a genuinely separate, non-PDF code path that builds "slides" directly from MarkItDown's heading-chunked text without ever touching `fitz`/vision/PDF storage (justifiable since these formats are born-digital text with no scanned-image case) — this changes `_extract_pages`'s page source and `_store_lecture_pdf`'s "always a real PDF" assumption, and makes the student PDF viewer optional for these lectures. Neither is a trivial reuse; picking between them is a real design decision, not a default to guess at solo.
  - Frontend also needs two independent changes regardless of which path is chosen: `usePDFUpload.ts::validatePdfFile` (single-file) and `MultiFileDropzone.tsx::ACCEPTED_EXTENSIONS` (batch) are both hardcoded PDF/PPTX allow-lists with no shared source of truth.
- [x] Scanned/handwritten-heavy PDFs detected (near-zero extractable text) are routed to the OCR/vision path automatically rather than producing empty slides; the parser pill in the overlay reflects this. **The core mechanism already worked before this pass** — `unified_orchestrator._synthesize_slide`'s `_MIN_TEXT_FOR_SYNTH` (25-char) threshold already routes any near-empty-text page to the vision model today, per-page, with zero code changes needed; this mirrors the "more infrastructure already existed" pattern found in Phase 3/4. The one genuine gap — no signal anywhere that vision-rescue happened, and `slide_type` alone is unreliable for detecting it (a vision-routed slide can still come back typed `math-diagram`/`graph`/`mixed`, not just `image-only`) — is now closed: a new explicit `vision_routed: bool` field is set on both `_synthesize_slide` branches, threaded through the per-slide SSE event, and surfaced in `PDFUploadOverlay` as a small "N vision-assisted" badge next to the extraction-engine pill whenever any processed slide needed rescue. Purely additive metadata — doesn't touch slide content, `slide_type`, or existing synthesis behavior. 6 new backend unit tests (both branches + the failure path + the `slide_type`-independence regression guard + SSE propagation) + 3 new frontend tests (shows with count, hides when none, hides pre-arrival).
- [x] Unsupported formats fail fast at validation with a message listing supported types. **Already fully satisfied before this pass, no work needed** — `upload_service.validate_upload()`'s `"Only PDF and PowerPoint (.pptx) files are supported."` already fires before any parsing/LLM work, on both the single-file and batch endpoints. The only remaining work is updating this message (and `ACCEPTED_UPLOAD_EXTENSIONS`) once DOCX/MD/TXT actually ship, so the "supported types" list stays accurate.

#### 2.3 Import by link (stretch, gate behind a flag)
**Acceptance criteria**
- [ ] Paste a URL to a PDF or a YouTube/streaming lecture; server fetches/downloads and enters the same queue. Domain allow-list configurable; fetch failures reported per-item in the queue UI.

---

### Phase 3 — The course brain (≈3–4 weeks)

Turns N parsed lectures into one coherent course model. This is the planned
`course_context` tier; it multiplies the value of the tutor, analytics, and quizzes
without new content from the professor.

> **Execution status (2026-07-11): DONE.** A pre-implementation survey found
> this phase's original scope was overestimated — cross-lecture concept dedup
> (3.2's hard part) and course-scoped tutor retrieval (3.3) were **already
> shipped** from an earlier, undocumented effort (`concept_graph.py`,
> `retrieval.py::retrieve_relevant_slides_course_scoped`, `chat_with_course`,
> `/search/ask`, plus a real grounding-eval test suite). The genuine gaps were
> narrower — `course_context`, new-upload awareness, and a concept-map merge
> endpoint — plus **one real bug found along the way**: concept-graph
> ingestion was client-side-only (fired from `useLectureSubmit.ts`), so
> Phase-1's batch upload silently never ran it at all. Everything below ships
> additively behind a new `FEATURE_COURSE_BRAIN` flag (default off), matching
> the project's established `feature_review_engine`/`feature_exam_mode`/
> `feature_global_search`/`feature_student_uploads` convention — with the flag
> off, parsing behaves byte-for-byte as before this phase (regression-guard
> unit test asserts this explicitly). Gates: backend 804 pass (unit+integration)
> + 120 pass (`-m db`, zero pre-existing failures — a concurrent session's
> unrelated fixes cleared them); vitest 393 pass / 3 pre-existing fails (2
> Onboarding + 1 new Luna-component a11y regression from a **different**,
> concurrent session — confirmed via `git status`, not touched by this work);
> tsc 0.

#### 3.0 Concept-ingestion bug fix (found during this phase, not an original line item)
**Finding:** `concept_graph.ingest_lecture_concepts` was only ever triggered
client-side (3 call sites in `useLectureSubmit.ts`); the Phase-1 batch-upload
flow (`useBatchUpload.ts` + `POST /upload/batch`) had zero trigger anywhere —
every batch-uploaded lecture silently skipped concept-graph ingestion.
**Fix:** trigger `ingest_lecture_concepts` server-side from
`parse_pdf_unified`'s finalize step (covers single **and** batch uploads
automatically, since both enqueue the same job). A second finding shaped the
fix: `ingest_lecture_concepts`'s own auto-fetch reads a `lecture_blueprints`
row (a v3/v4-only artifact the unified pipeline never writes) and falls back
to `quiz_questions.metadata.concept` — which `_map_deck_quiz` populates with
the question's **difficulty** string, not a concept name. Calling it naively
would have tagged the shared concept catalog with "easy"/"medium"/"hard"
across every lecture. Fixed by using `analyze_lecture_meta`'s already-generated
`keyTopics` (previously computed, never read) as the concept source instead.
- [x] Server-side trigger fires for single AND batch uploads, gated behind `FEATURE_COURSE_BRAIN` + `ai_mode` (skipped for Skip-AI/`on_demand` parses — no synthesized topics to extract). *(unit tests: fires when on, skipped when off/on_demand, non-fatal on failure.)*

#### 3.1 Course context record
**Acceptance criteria**
- [x] Additive migration: `course_context` (course_id PK/FK, instructor, exam_dates JSONB, syllabus_facts JSONB, grading_scheme, updated_at) — `supabase/migrations/20260711000000_course_context.sql`, RLS mirrors `courses`' own three-policy shape exactly. *(9 db-marked RLS tests; 108→120 db suite total across the phase.)*
- [x] Administrative slides auto-extract instructor/exam-dates/grading-scheme into `course_context`; professor sees an editable "Course facts" card and can correct any field. *(Finding: `content_filter.is_metadata_slide` — the admin-slide classifier — was NOT wired into the live v5 pipeline at all before this; this is its first use there, as a parallel side-channel that doesn't change existing synthesis/quiz behavior. New `synthesis.extract_syllabus_facts` LLM call + `course_context_service.upsert_course_context_facts` merge-not-clobber semantics (10 db tests) + `GET`/`PATCH /courses/{id}/context` endpoints + `CourseFactsCard` on `ProfessorCourseDetail.tsx`.)*
- [x] Organizational slides feed course_context via a side-channel that does not touch existing quiz-suppression/generation behavior (scope note: v5 doesn't currently suppress admin-slide quiz generation at all — a separate, pre-existing gap this phase deliberately did not touch, to avoid changing live synthesis output as a side effect of adding fact-extraction).

#### 3.2 Cross-lecture concept graph
**Acceptance criteria**
- [x] Concept dedup — **already shipped** pre-phase (`concept_graph.py::_ensure_concept`, name-key + embedding-similarity, `concept_lectures` bipartite table). Confirmed working, not rebuilt.
- [x] `GET /api/v1/courses/{course_id}/concept-map` merges `concept_lectures` per course with "builds on" ordering **derived from `lectures.created_at`** (no new schema/column) — first chronological appearance = "introduces", later ones = "reinforces". Reuses the course-visibility check from `GET /courses/{id}`. *(6 integration tests + 2 db-marked cascade tests.)*
- [x] Deleting a lecture leaves no orphaned `concept_lectures` row (pre-existing `ON DELETE CASCADE`, regression-guarded by new db tests since a course-level view now depends on it).

#### 3.3 Course-scoped retrieval
**Acceptance criteria**
- [x] Already shipped pre-phase and confirmed working: `match_slides_scoped`/`retrieve_relevant_slides_course_scoped` (RRF-fused vector+keyword, course_id-scoped), `chat_with_course`, `POST /search/ask`, plus an existing grounding-eval test suite (`test_course_tutor_grounding.py`). Not rebuilt.
- [ ] Recap-slide dedup/down-weighting at retrieval time — **not done**, deferred. Lower priority once 3.3 was found already-shipped; a real fix needs production usage data to know if it's actually a problem worth solving.
- [ ] A curated ≥10-pair real-course RAG eval set — **not done**, deferred (needs real course data + professor time to curate, out of scope for an engineering-only pass).

#### 3.4 New-upload awareness
**Acceptance criteria**
- [x] New lecture's synthesis prompt receives course context (prior lecture titles + each one's strongest concept + course facts) when `FEATURE_COURSE_BRAIN` + a `course_id` are present — threaded into both `analyze_lecture_meta` (lecture-level title/summary) and the per-slide `lecture_context` used by `analyze_slide`. **Regression-guarded**: with no `course_id`, the prompt/context is byte-identical to pre-Phase-3 behavior (explicit unit test asserts this, not just "close enough").
- [x] Deck quiz may include ≤2 "connects to earlier material" questions referencing a concept from a prior lecture, tagged in `quiz_questions.metadata.source_lecture_id`/`source_lecture_title`. Best-effort, non-fatal, capped at 2, skipped entirely when the course has no prior lectures with concepts yet.
- [ ] Snapshot tests of exact prompt assembly — not done as literal snapshot tests; covered instead by unit tests asserting the hint's presence/content and the byte-identical-when-absent regression guard, which test the same contract more robustly than a brittle string snapshot would.

---

### Phase 4 — Artifact fan-out (≈2–3 weeks)

The parse already produces structured, embedded content; each additional artifact is a
cheap generation with direct student value. Generate on upload (professor-approvable),
regenerable on demand.

> **Execution status (2026-07-11): a reality-check survey (mirroring Phase 3's)
> found this phase's original scope was overestimated too** — 4.1's SM-2
> scheduler and 4.2's generation/attempt/grading infra already existed from
> earlier, undocumented work (Roadmap Phase 1.1 "Daily Ascent" review engine;
> `practice_sheets.py`). **`worksheetsService.ts` is a completely separate,
> already-finished file-attachment feature** (professors manually upload a
> PDF/DOC to a bucket) — the roadmap's original framing of it as "the thing
> to wire up" was stale; `practice_sheets.py`/`practice_sheet_questions` is
> the actual generation target. Given the scope of what remained (see each
> sub-section), this pass shipped: a cross-cutting data-quality bug fix, full
> professor visibility/control over 4.1's review cards, and 4.4's study guide
> end-to-end (genuinely unbuilt, unlike 4.1–4.3). **4.2's real AI-generated
> open/calc/transfer questions + PDF export and 4.3's professor-composable
> exam bank + real difficulty recalibration were deliberately NOT attempted**
> — each is a substantial standalone effort (new prompt design + grounding
> checks; a new professor screen + a stats pipeline), not a quick win, and
> better scoped as its own future session rather than done partially here.
> Gates: backend 812 pass / 1 pre-existing order-dependent fail (unrelated,
> confirmed via `git stash`); db 136 pass (confirmed earlier in this session
> — Docker was unavailable at final-sweep time, an environment issue, not a
> regression); tsc 0; new frontend/service tests (33) all pass in isolation
> (the full vitest run has ~20 failures, ALL confirmed via `git status` to be
> from a concurrent session's in-progress Landing/Auth/LectureView/
> StudentDashboard/i18n rework — zero overlap with anything built here).

#### 4.0 Cross-cutting data-quality fix (found during this phase, not an original line item)
**Finding:** `synthesis._map_deck_quiz` mapped `"concept": q.get("difficulty", "")`
— every deck-level quiz question's `metadata.concept` actually held the
difficulty string ("easy"/"medium"/"hard"), never a real concept name. This
silently poisoned the `QuizCard` "Concept ·" badge (Phase 0) for deck
questions and would have poisoned any Phase-4 concept-based filtering.
**Fix:** the deck-quiz prompt now asks for `concept` AND `difficulty` as
independent fields; `_map_deck_quiz` maps both correctly. Regression-guarded
by 2 new unit tests; existing `test_synthesis_quiz_mapping.py` unaffected
(none of its cases touched these fields).

#### 4.1 Flashcards (spaced repetition)
**Finding:** the SM-2 scheduler + `review_cards`/`review_schedule`/`review_log`
schema already existed (Roadmap Phase 1.1, `backend/services/review/`) —
solid, real spaced repetition. The term "flashcard" doesn't appear anywhere
in the codebase; cards are internally "review cards", 100% quiz-question-
shaped (never term/definition or concept-QA/cloze — that source_type is
schema-ready but has zero writers, deliberately deferred back in Phase 1.1).

**Acceptance criteria**
- [ ] Every AI-enhanced lecture yields a flashcard deck (term/definition + concept-tagged Q/A) — **not done**; cards remain quiz-question-shaped. Generating genuine term/definition cards from slide content directly is a real, separately-scoped effort (needs its own prompt + grounding design), not attempted here.
- [x] Professor can review/edit/delete cards before publishing — **shipped as soft-hide, not delete**: `review_schedule`/`review_log` both `ON DELETE CASCADE` on card_id, so a hard delete would destroy every student's SM-2 progress/grade history for that card. New `GET /review/lecture/{id}/cards`, `POST /review/cards/{id}/hide|unhide` (reusing `FEATURE_REVIEW_ENGINE`, no new flag) + a `ProfessorReviewCardsPanel` on the lecture editor's "Lecture" tab. A hidden card stops being served (new activation AND already-scheduled students) while every row and student history survives, restorable via unhide. 8 db-marked tests including a dedicated "hiding preserves existing student progress" regression guard.
- [ ] Card count scales with content, none from title/TOC/administrative slides — **not done**; per-slide quiz generation itself doesn't suppress admin slides yet (a separate, pre-existing gap noted in Phase 3), so card_factory inherits that gap. The new hide/unhide control (above) is the professor's manual workaround in the meantime.

#### 4.2 Worksheets / practice sheets
**Finding:** `worksheets.py` (file upload, complete, unrelated) vs
`practice_sheets.py` (the real target) are two separate features — the
original roadmap conflated them. Auto-generation exists but is a pure
MCQ-copy from `quiz_questions`, never open/calc/transfer questions; a
model-answer/rubric field exists but only for manually-authored questions;
no PDF export exists anywhere in the codebase.

**Acceptance criteria**
- [ ] "Generate worksheet" produces open/calculation/transfer questions grounded in lecture content, exportable as PDF — **not attempted**. Deliberately deferred: real open-question generation needs its own grounding/prompt design (distinct from the existing MCQ pipeline) and PDF export needs new infra from scratch: both substantial, separately-scoped efforts.
- [ ] Model answer + rubric for auto-generated items — **not attempted** (only manually-authored practice-sheet questions have this field populated today).

#### 4.3 Exam bank with difficulty calibration
**Finding:** a course-wide question-pool aggregator + weighted/seeded sampler
+ timed session/grading/concept-report already existed (Roadmap Phase 1.2,
`exam_service.py`) — but it's 100% student-self-service ("generate my mock
exam"), not a professor-browsable/composable bank, and item difficulty is
only ever the LLM's static a-priori tag (no recalibration from real attempts
anywhere in the codebase).

**Acceptance criteria**
- [ ] Professor composes a mock exam by concept/cognitive-level/lecture filters + count, exports it — **not attempted**. Needs a new professor-facing screen plus new filtered-query endpoints; a substantial standalone effort.
- [ ] Item difficulty re-estimated from real student answer data (≥20 attempts, >40pt discrepancy flag) — **not attempted**. Needs a new stats pipeline (per-item correct-rate aggregation) with no existing scaffold to build on.

#### 4.4 Study guide
**Finding:** genuinely unbuilt — zero references anywhere in the codebase
before this pass (confirmed by grep across migrations/backend/frontend),
unlike 4.1–4.3's hidden prior work.

**Acceptance criteria**
- [x] One-click per course: a structured study guide (per-lecture synopsis, merged key concepts with definitions, exam-relevant facts from course_context), viewable in-app. *(New `study_guides` table (additive, RLS mirrors `course_context`'s shape exactly) + `study_guide_service.py` (aggregation-first: lecture synopses/concepts come straight from persisted data, only concept one-line definitions need a single best-effort LLM call) + `GET /courses/{id}/study-guide[?regenerate]` behind `FEATURE_STUDY_GUIDE` (off by default) + a manually-triggered `StudyGuideCard` on `ProfessorCourseDetail` — manual, not auto-fetch-on-mount, since generation can call an LLM and shouldn't fire silently on every page view.)*
- [~] Exportable as PDF — **not attempted**: no PDF-export infrastructure exists anywhere in the codebase (confirmed via survey); building one from scratch was out of scope for this pass. In-app viewing ships; PDF export is a clean, separately-schedulable follow-up once the in-app shape is validated.
- [x] Regenerating after new uploads incorporates new lectures and is idempotent. *(`source_lecture_count` cache-invalidation: a changed lecture count triggers regeneration; `force_regenerate=true` always reruns; the upsert is a single `ON CONFLICT ... DO UPDATE` row, never accumulating duplicate sections — both behaviors covered by dedicated db tests.)*

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
