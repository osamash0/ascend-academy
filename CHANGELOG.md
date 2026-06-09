# Changelog

All notable changes to Learnstation are documented in this file.

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
