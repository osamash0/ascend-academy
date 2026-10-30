# Changelog

All notable changes to Learnstation are documented in this file. Since 2026-06 the unit is the merged pull request; one line each, grouped by area, newest first. Earlier sections are release notes.

## 2026-10-24 to 2026-10-30 — v4 and Luna live for real people

**Reader and Luna**
- #139 instant reader: cinema and scroll, timeline, read before Luna is done
- #145 Luna lights up: faces arrive page by page while she reads (LS-039)
- #143 looking back no longer wipes progress (LS-055); the reader no longer bounces back a Lesson
- #147 reader confusions from the punch list (LS-053/054/056/057/059/061)
- #135 Luna provider fallback within 20 s, opener at once, content-page planning
- #131 the PDF is fetched in 16 KB pieces; #132 the reader's copy is stored with its objects packed; #119 the deck opens without a blank wait
- #125 Luna study sessions, a study partner beside the reader (flagged; on in prod since 2026-10-29)

**Spaces, Home, Library**
- #126 one app for students: classic rooms retired, New Space made on the stage (LS-050)
- #128 / #130 the owner runs their Space on the stage: add Lessons, publish (LS-072)
- #137 each Space seen through its own first page
- #148 Spaces basics: Open says what it does, chips open, members can leave (LS-073/077/078)
- #122 a shared Lesson link to a Space you have not joined offers Join (LS-045)
- #117 Settings shows only real controls, the hub can make a Space, Studio stops flagging junk (LS-003..005)
- #118 buttons say where they go, Home and Space agree, nothing falls off a phone (LS-006..013)
- #140 six papercuts from the 2026-10-29 rehearsal
- #133 the reader records what the analytics engine needs; #142 the Space engine behind the owner's door ("How it's landing", plans 1 and 2)
- #146 the people in your Spaces see you only if you say so (LS-036)

**Sign-up, first run, auth**
- #115 sign-up and first run on the v4 stage; #113 Start opens sign-up, shared links survive sign-in, a missing Space says so
- #124 a shared link survives sign-up, email confirmation and first run (LS-047)
- #123 / #127 "Pick one for me" rolls a friendly alias and never lands on the name it started from
- #116 new passwords need 8 characters; sign-in still accepts older ones
- #111 no redirect loop for admins or a failed role; v4 can sign out, export and delete

**Language**
- #120 German mode stops speaking English (LS-014..017, 019); #109 the German Library guard reads text node by text node
- #105 v4 in German: Social, people, Profile, Rank, History, Settings, and the guard that keeps it

**Legal, privacy, security**
- #141 / #144 real operator and full postal address in the Impressum and privacy policy, only services in use (LS-001, LS-002); #150 names Resend, which now sends the account emails
- #110 audit week 1: tutor visibility, broken title endpoints, fail-closed controls, Sentry PII, honest privacy page, RLS scoping
- #112 audit week 2: erasure gaps, upload quota bypass, failed AI as errors, shared rate limits, tutor-event minimisation, embedding accounting
- #114 the public lecture-pdfs bucket is closed on prod; owner-only PDF writes
- #129 an account that owns lessons can be deleted again (LS-112)
- #134 no committed default passwords for seed accounts
- #136 v4 and feature flags reach the prod frontend build (LS-037, LS-032)

**Dependencies and CI**
- #106 / #108 the advisories that turned CI red: Pillow 13, pypdf 6.21.2, zod 4

**AI spend and content**
- #98 parse-time calls are attributed to the uploader; students' monthly parse spend is capped
- #96 v4 on real data: the world, Home, reading, practice, Social, notes, search
- #95 real pages pipeline: files in, Studio pages out (flag off)

## 2026-10-10 to 2026-10-19 — the reader, Luna's face, launch prep

- #75 Reader: deck reader, Explain, checkpoints, fading light, exam rehearsal; #83 Teach it back, exam date plan, map of what builds on what
- #68 the Lesson Reader (design-v4)
- #76 / #87 / #88 Luna avatar system, Ask Luna tutor, one avatar app-wide with photo upload, server-side unlock guard
- #80 / #81 / #82 Home: Luna alive; puffy suit, 17 looks, the Learnstation ID card
- #78 one look across the app: monochrome brand, the stage everywhere, a landing page that is the product; #86 practice that lights up
- #104 the landing demo shows what the reader really does; #100 the live page fills its frame; #93 top bar fits phones
- #97 / #102 one language setting, the reader, Space page, shell, Home, hub, dialogs and Library in German
- #84 AI and parser: plan the deck first, ground the quiz, fix two live cost bugs; #74 silent failures made loud, provider chains revived; #99 importing the orchestrator never overwrites the process env
- #92 launch prep: OpenAI-only AI, real users, Launch Control, catalog enrichment
- #90 complete data export and ordered, retried account erasure
- #77 / #79 revoke anon EXECUTE on SECURITY DEFINER functions
- #72 / #73 / #103 parser: stranded runs swept, course ownership checked on upload, code in a reply no longer discards the batch
- #89 an internal university wiki export removed from the public repo; #101 nightly gitleaks no longer re-trips

## 2026-08-28 to 2026-09-17 — the v4 design rebuild and the thesis apparatus

- #55 / #56 / #57 / #58 / #59 / #60 / #61 / #62 Learnstation v4 design rebuild: Library Studio, Profile and Social cells, Rank, study history, Moments, Discover, Luna asks first on Home
- #51 / #52 / #69 thesis figures, the LaTeX skeleton, the evaluation harness that produces the thesis's numbers
- #53 / #54 real ai_model on the Ask-across-course path; lectures readable again (409 dead end, concepts 403, language detection)
- #63 / #65 / #66 / #67 / #70 / #71 CI honesty: SCA advisories, the nightly gitleaks and AI-eval reds, the secrets audit corrected, phase 2 of the roadmap reconciled

## 2026-08-17 to 2026-08-18 — the consolidation and the Milestone-4 fix night

- #9 / #10 / #11 / #13 milestone consolidation: the security and platform fleet landed, stranded commits recovered, the baseline recorded
- #12 Supabase egress overage fixed: hero key art served from WebP posters
- #17 to #26 the whole-app audit report, consolidated and ranked
- #27 all 18 tsc errors cleared so tsconfig.app.json can gate CI
- #28 to #50 the audit fixes: ProtectedRoute fails closed (#29), fabricated telemetry removed (#30, #48), enrollment-scoped reads (#28), honest upload job states (#37), error-vs-empty states (#33, #36), legal-page reachability (#34), and the rest of the M- and R-numbered findings
- #14 / #15 / #16 / #21 / #22 onboarding re-entry, batch-upload failures surfaced, JSON-mode envelope, dashboard no longer hammering Supabase

## 2026-07-18

- #8 student course library, onboarding, AI content improvements, load-test tooling

## [3.0.0] - 2026-06-09

### 🚀 Major Release: Parser v3.0 Now Orbiting

Learnstation v3.0 introduces a complete rewrite of the content processing pipeline with intelligent PDF parsing, memory-safe job processing, and grounded AI tutoring.

#### Parser v3.0 Architecture

**Seven-Stage Pipeline** with resumable, deterministic processing:

1. **Validate + Hash** — Reject invalid PDFs (>200 pages, >50 MB)
2. **Register Run** — Create immutable parse_runs record in Postgres
3. **Index Pages** — Pre-allocate parse_pages rows for each page
4. **Extract & Classify** — Parallel text/image extraction with generator-aware routing
5. **Deck Outline** — Single LLM call to understand lecture structure
6. **Per-Slide AI** — Batched text analysis + single-shot vision slides
7. **Embeddings & Summary** — Local vector embedding + deck-level quiz generation

#### Key Improvements

##### Content Processing
- **Narrative-aware extraction** — Understands lecture structure, not just OCR
- **Generator routing** — Auto-detects PDF source (LaTeX vs PowerPoint vs Keynote) for optimal processing
  - Real numbers: 99/143 PowerPoint pages misclassified as decorative by v2 are now correct
- **Visual-first handling** — Diagrams, tables, photos handled as first-class content
  - Tables extracted as Markdown before LLM call (more reliable than re-OCR)
  - Formulas preserved as LaTeX `$...$`
  - Diagrams described as labeled flows
- **Context injection** — Deck outline injected into per-slide prompts for consistent terminology

##### Infrastructure
- **Memory-safe** — Processes 200-slide / 40 MB decks in constant ~150 MB memory (vs unlimited leak in v2)
  - Bounded concurrency: 8 extraction workers, 3 vision workers
  - Thread-local pixmap handling, immediate JPEG upload to Supabase Storage
  - `gc.collect()` at stage boundaries
- **Resumable jobs** — Crashed uploads deterministically resume from last committed state
  - Per-page checkpoints in `parse_pages` table
  - Same PDF + version = same output, byte-for-byte
  - SSE replay from database for client reconnects
- **Durable async** — Arq + Redis job queue for reliable background processing
  - Lost workers don't lose work
  - Can scale workers horizontally
  - Built-in retry logic

##### AI & Tutor
- **Grounded Socratic tutor** (`/api/tutor/{lecture_id}/ask`)
  - Retrieved only from `slide_chunks` for the specific lecture
  - Zero hallucination — canned refusal if off-topic
  - Cites slide numbers `[P12]` in responses
  - CI enforces negative-mode tests (questions known to be off-topic)
- **Free-tier LLM routing** — Cerebras → Groq → Gemini fallback chain
  - Outline: 1 call/deck (~2k in, 500 out)
  - Text analysis: ~17 calls/200-slide deck (batched ≤12 slides/call)
  - Vision: Groq Llama 3.2 Vision (rate-limited to 3 concurrent)
  - Embeddings: Local FastEmbed (free, 0 network latency)
  - Daily quota guard: raises `LLMQuotaExceededError` at 80% usage

##### Database & Storage
- **New tables** (v3 schema):
  - `parse_runs` — run-level state machine
  - `parse_pages` — per-page checkpoint (1 row = 1 atomic transaction)
  - `slide_chunks` — tutor grounding store (1–N chunks per slide, with pgvector embeddings)
  - `tutor_messages` — conversation history with citation tracking
- **pgvector integration** — IVFFlat indexes for fast semantic search
- **Storage** — Supabase Storage for slide JPEGs (`pdf_pages/{run_id}/{page_index}.jpg`)

##### TypeScript/Frontend
- **Skill Tree 3D** — React Three.js visualization of course concepts
- **Real-time progress** — SSE streaming of parse events
- **Tutor chat interface** — Ask questions about lecture content
- **Deck analytics** — Student engagement by slide and concept
- **i18n support** — English and German translations

#### Technical Details

##### New Dependencies
- `docling` — Intelligent PDF text extraction (Apache 2.0)
- `arq` — Async job queue backed by Redis
- `litellm` — LLM gateway with provider routing
- `fastembed` — Local ONNX embeddings (bge-small-en-v1.5, 384-d)
- `pgvector-python` — PostgreSQL vector support

##### Removed
- `pdf2image` (memory leak) — replaced by PyMuPDF only
- `file_parse_service.py` v2 (884 lines) — replaced by modular pipeline
- `summarizer_service.py` (functionality moved to Stage 7)

##### Database Migrations
- `20260503000008_parser_v3_schema.sql` — new tables + vector extension + RLS policies

#### Configuration

New env vars:
```bash
REDIS_URL=redis://localhost:6379
LITELLM_BASE_URL=http://localhost:4000
PARSER_VERSION=3  # default; v2 still available as fallback
```

Docker Compose now includes:
- `redis` — Job queue backend
- `litellm` — LLM proxy with fallback routing
- `worker` — Arq worker process

#### Testing

New test suites:
- `backend/tests/unit/parse_classifier.py` — routing for 30 representative pages
- `backend/tests/unit/parse_orchestrator.py` — stage transitions + semaphore bounds
- `backend/tests/integration/checkpoint_resume.py` — killed-mid-parse recovery
- `backend/tests/integration/tutor_grounding.py` — tutor stays on-topic, no cross-lecture leakage
- `backend/tests/perf/` — memory profiling (nightly)

#### Migration Guide

**For existing deployments:**

1. Deploy schema migration `20260503000008_parser_v3_schema.sql`
2. Add `redis` and `litellm` to Docker Compose (or run locally)
3. Set `PARSER_VERSION=3` in production `.env`
4. Run `docker compose up worker -d` to start Arq worker
5. New uploads use v3; old v2 pipeline continues to work
6. Monitor for 48h, then remove v2 modules (optional)

**Rollback:** Set `PARSER_VERSION=2` to use legacy pipeline (still available).

---

## [2.x] - Legacy

Previous versions used a monolithic `file_parse_service.py` pipeline with `pdf2image` (memory leak) and ad-hoc LLM orchestration. See git history for details.

---

## Unreleased

### Planned for v3.1
- [ ] Streaming JPEG upload (reduce memory spike)
- [ ] Deck-level cross-slide linking in quizzes
- [ ] Professor dashboard for parse metrics
- [ ] i18n for parser v3 schema labels

### Experimental (not yet shipped)
- Parser v4 (Docling v2 with faster LaTeX extraction)
- Multi-language lecture support
- Real-time collaborative annotations
