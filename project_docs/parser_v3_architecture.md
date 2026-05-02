# Parser v3 — Clean-Slate Architecture

**Status:** Design proposal. Greenfield rewrite of the PDF → slides → quiz →
tutor pipeline. Replaces `file_parse_service.py`, `ai_service.py`, and the
ad-hoc orchestration in `upload.py`.

**Goals (from the brief)**

1. Memory-safe extraction of 100–200 slide decks.
2. Per-slide checkpoint / resume.
3. Narrative context (the deck is understood, not just OCR'd).
4. Meaningful titles, rich Markdown, concept-testing quizzes.
5. Socratic tutor grounded **only** in the deck (zero hallucination).
6. Visual elements (graphs, diagrams, tables, photos) handled as first-class.
7. Free-tier AI only (Gemini Flash + Groq Llama 3.2 Vision + Llama 3 text).

---

## 1. Architectural principles

| # | Principle | Consequence |
|---|---|---|
| P1 | **Stateless workers, durable state in Postgres.** | Any stage can crash; the next run resumes from the last committed row. |
| P2 | **One slide = one transaction.** | A slide is either fully written (text + image_ref + classification + content + quiz) or absent. No half-slides. |
| P3 | **Memory budget is a first-class constraint.** | All page-level work runs in a thread worker that opens its own `fitz.Document`, processes one page, and closes. Pixmaps are nullified inside the worker. RSS stays flat at ~150 MB regardless of deck size. |
| P4 | **Routing is explicit and stored.** | Each slide gets a `route` (`title`, `text`, `vision`, `mixed`, `metadata`) committed before the LLM call, so a re-run uses the same route and the diagnostics panel can show what happened. |
| P5 | **Ground truth = `slide_chunks` table.** | The tutor's only context source is `slide_chunks` filtered by `lecture_id`. The LLM never sees web search, never sees prior decks, never sees its own training "knowledge" bleeding through. |
| P6 | **Free-tier friendly.** | Batch text slides 1 call per ≤ 12 slides. Vision slides go single-shot but capped at 3 concurrent. Embeddings use a free local model (bge-small via FastEmbed) to avoid burning the daily Gemini quota. |
| P7 | **Versioned pipeline.** | Every artefact carries `pipeline_version`. Bumping the constant invalidates caches without DROP. |

---

## 2. Stage diagram

```
                       ┌──────────────────────────────────────────────┐
upload (PDF bytes)     │  Stage 0  Validate + hash                    │
        │              │           pdf_hash = sha256(bytes)           │
        ▼              │           reject > 200 pages or > 50 MB      │
  POST /parse          └────────────────┬─────────────────────────────┘
                                        ▼
                       ┌──────────────────────────────────────────────┐
                       │  Stage 1  Register run                        │
                       │           INSERT parse_runs (status='queued')│
                       │           returns run_id                      │
                       └────────────────┬─────────────────────────────┘
                                        ▼
                       ┌──────────────────────────────────────────────┐
                       │  Stage 2  Index pages (cheap, sync)           │
                       │           one row per page in parse_pages    │
                       │           with status='pending'              │
                       └────────────────┬─────────────────────────────┘
                                        ▼
                       ┌──────────────────────────────────────────────┐
                       │  Stage 3  Per-page extract + classify         │
                       │           (parallel, bounded by Semaphore(8))│
                       │  ── fitz worker: text, drawings, images      │
                       │  ── classifier: route ∈ {title,text,vision,  │
                       │                          mixed, metadata}    │
                       │  ── if vision/mixed: render JPEG, store ref  │
                       │  COMMIT parse_pages.status='extracted'       │
                       └────────────────┬─────────────────────────────┘
                                        ▼
                       ┌──────────────────────────────────────────────┐
                       │  Stage 4  Deck narrative pre-pass (1 LLM call)│
                       │           feed all titles + first 30 chars   │
                       │           of body per slide → outline +      │
                       │           topic clustering → write to        │
                       │           parse_runs.outline (jsonb)         │
                       └────────────────┬─────────────────────────────┘
                                        ▼
                       ┌──────────────────────────────────────────────┐
                       │  Stage 5  Per-slide AI                        │
                       │  ── text/title routes: BATCHED (≤12 / call)  │
                       │  ── vision/mixed: SINGLE, sem=3              │
                       │  ── prompt receives outline context so the   │
                       │     model knows *which lecture* this is in   │
                       │  COMMIT parse_pages.status='analyzed'         │
                       │  WRITE  slides + slide_chunks + quiz_questions│
                       └────────────────┬─────────────────────────────┘
                                        ▼
                       ┌──────────────────────────────────────────────┐
                       │  Stage 6  Embed for tutor (local, free)       │
                       │           FastEmbed bge-small → vector(384)   │
                       │           one row per slide_chunks            │
                       └────────────────┬─────────────────────────────┘
                                        ▼
                       ┌──────────────────────────────────────────────┐
                       │  Stage 7  Deck-level quiz + summary           │
                       │           summariser (≤2k tokens) → 5 cross-  │
                       │           slide questions tagged by concept   │
                       │  COMMIT parse_runs.status='completed'         │
                       └──────────────────────────────────────────────┘

            (all stages emit SSE events to the open /parse-pdf-stream)
```

Resume rule: on restart for the same `pdf_hash`, the orchestrator starts at
the lowest `parse_pages.status` that is not `'analyzed'` and skips Stage 4 if
`parse_runs.outline IS NOT NULL`.

---

## 3. Memory-safety strategy (P3)

The current pipeline leaks because `pdf2image` shells out to `pdftoppm` and
materialises **every** page as a PIL image in memory. The new design:

1. **Never load the whole PDF as images.** PyMuPDF only — `pdf2image` is removed
   from `requirements.txt`.
2. **Pixmap lifecycle is local to a thread worker.** This is the
   already-correct pattern in `pdf_reader.py::render_page_jpeg` — keep it,
   forbid pixmaps from crossing thread boundaries.
3. **One page open at a time per worker.** Each worker does
   `open → page = doc[i] → process → doc.close()`. We do not iterate the doc.
4. **JPEGs are written to Supabase Storage immediately**, then the bytes are
   freed. The `slides` row stores `image_url`, not `image_bytes`.
5. **Raw PDF bytes are kept once, in the orchestrator coroutine.** Workers
   receive a slice of the immutable bytes object; CPython reference-counts the
   buffer, no copy is made.
6. **Bounded concurrency.** `asyncio.Semaphore(8)` for extraction,
   `Semaphore(3)` for vision LLM, `Semaphore(1)` for batched text LLM. This
   caps peak RSS to roughly:

   `pdf_bytes + 8 × (1 page dict + 1 jpeg ≤ 250 KB) + 3 × (jpeg in flight)`
   ≈ **~150 MB** for a 200-slide / 40 MB deck.

7. **`gc.collect()` after each stage boundary** — cheap, and frees fitz's C
   heap after the burst.

---

## 4. Data structures (Pydantic v2)

These live in `backend/domain/parse_models.py`. All times are UTC.

```python
from datetime import datetime
from enum import Enum
from typing import Literal, Optional
from pydantic import BaseModel, Field

PIPELINE_VERSION = "3"

# ---------- Routing ----------------------------------------------------------

class SlideRoute(str, Enum):
    TITLE     = "title"      # short text only, no quiz, ~0 tokens
    TEXT      = "text"       # text-heavy, batched
    VISION    = "vision"     # image-dominant, single vision call
    MIXED     = "mixed"      # text + diagram, single vision call w/ text
    METADATA  = "metadata"   # cover/agenda/refs/thank-you, no quiz

class PageStatus(str, Enum):
    PENDING    = "pending"
    EXTRACTED  = "extracted"
    ANALYZED   = "analyzed"
    FAILED     = "failed"

class RunStatus(str, Enum):
    QUEUED      = "queued"
    EXTRACTING  = "extracting"
    OUTLINING   = "outlining"
    ANALYZING   = "analyzing"
    EMBEDDING   = "embedding"
    FINALIZING  = "finalizing"
    COMPLETED   = "completed"
    FAILED      = "failed"
    CANCELLED   = "cancelled"

# ---------- Extracted page (Stage 3 output) ---------------------------------

class ExtractedPage(BaseModel):
    page_index:   int                                   # 0-based
    text:         str                                   # cleaned, deduped
    word_count:   int
    has_vector_drawings: bool
    image_count:  int
    table_count:  int
    image_url:    Optional[str] = None                  # set only if vision route
    route:        SlideRoute

# ---------- Deck outline (Stage 4 output) -----------------------------------

class DeckOutline(BaseModel):
    course_topic: str                                   # "Intro to ML"
    sections:     list["OutlineSection"]
    glossary:     dict[str, str] = Field(default_factory=dict)

class OutlineSection(BaseModel):
    title:        str
    page_indices: list[int]
    summary:      str                                   # 1–2 sentences

# ---------- Slide AI result (Stage 5 output) --------------------------------

class QuizQuestion(BaseModel):
    question:        str
    options:         list[str]                          # always length 4
    answer:          Literal["A", "B", "C", "D"]
    explanation:     str
    concept:         str                                # links to outline
    cognitive_level: Literal["recall", "apply", "analyze", "evaluate"]
    linked_slides:   list[int] = []                     # for cross-slide deck quiz

class SlideContent(BaseModel):
    page_index:    int
    title:         str
    markdown:      str                                  # rendered to student
    summary:       str
    questions:     list[QuizQuestion]
    is_metadata:   bool
    route:         SlideRoute
    parse_error:   Optional[str] = None
    meta:          "SlideMeta"

class SlideMeta(BaseModel):
    pipeline_version: str = PIPELINE_VERSION
    word_count:       int
    vision_used:      bool
    tokens_input:     int
    tokens_output:    int
    model:            str                               # "gemini-1.5-flash" etc.
    latency_ms:       int
    retried:          int = 0

# ---------- Tutor grounding chunks (Stage 6 input) --------------------------

class SlideChunk(BaseModel):
    """One retrievable unit. A slide may produce 1–N chunks."""
    lecture_id:   str
    page_index:   int
    chunk_index:  int                                   # 0-based within slide
    text:         str                                   # ≤ 400 tokens
    section:      Optional[str]                         # outline section title
    embedding:    Optional[list[float]] = None          # 384-d, written by Stage 6
```

All models are JSON-serialisable; the SSE layer simply does `model.model_dump()`
before yielding.

---

## 5. Database schema

Greenfield tables. Keep the existing `lectures`, `quiz_questions`,
`slide_embeddings`, `pipeline_run_metrics`. **Drop** `slide_parse_cache` and
`pdf_parse_cache` — they are superseded by `parse_pages` (richer + transactional).

```sql
-- ---------------------------------------------------------------------------
-- Run-level state machine
-- ---------------------------------------------------------------------------
CREATE TABLE parse_runs (
    run_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pdf_hash         TEXT NOT NULL,
    lecture_id       UUID REFERENCES lectures(id) ON DELETE CASCADE,
    pipeline_version TEXT NOT NULL,
    status           TEXT NOT NULL,        -- RunStatus
    page_count       INT,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at      TIMESTAMPTZ,
    outline          JSONB,                -- DeckOutline, written in Stage 4
    error            TEXT,
    UNIQUE (pdf_hash, pipeline_version)    -- one live run per (pdf, version)
);
CREATE INDEX idx_parse_runs_lecture ON parse_runs(lecture_id);

-- ---------------------------------------------------------------------------
-- Per-page checkpoint table (P2: one row = one transaction)
-- ---------------------------------------------------------------------------
CREATE TABLE parse_pages (
    run_id           UUID REFERENCES parse_runs(run_id) ON DELETE CASCADE,
    page_index       INT  NOT NULL,
    status           TEXT NOT NULL,        -- PageStatus
    route            TEXT,                 -- SlideRoute, set in Stage 3
    extract          JSONB,                -- ExtractedPage minus image bytes
    content          JSONB,                -- SlideContent, written in Stage 5
    image_url        TEXT,                 -- Supabase Storage path
    error            TEXT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, page_index)
);
CREATE INDEX idx_parse_pages_status ON parse_pages(run_id, status);

-- ---------------------------------------------------------------------------
-- Tutor grounding store (P5)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE slide_chunks (
    id            BIGSERIAL PRIMARY KEY,
    lecture_id    UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    page_index    INT  NOT NULL,
    chunk_index   INT  NOT NULL,
    text          TEXT NOT NULL,
    section       TEXT,
    embedding     vector(384),             -- bge-small via FastEmbed
    pipeline_version TEXT NOT NULL,
    UNIQUE (lecture_id, page_index, chunk_index, pipeline_version)
);
CREATE INDEX idx_slide_chunks_vec
    ON slide_chunks USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
CREATE INDEX idx_slide_chunks_lecture ON slide_chunks(lecture_id);

-- ---------------------------------------------------------------------------
-- Tutor message log (used as conversation memory in the prompt)
-- ---------------------------------------------------------------------------
CREATE TABLE tutor_messages (
    id          BIGSERIAL PRIMARY KEY,
    lecture_id  UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('student','tutor')),
    content     TEXT NOT NULL,
    cited_pages INT[] DEFAULT '{}',         -- pages referenced by the tutor
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tutor_msgs_session
    ON tutor_messages(lecture_id, user_id, created_at);

-- ---------------------------------------------------------------------------
-- RLS — same backend-only pattern as pipeline_run_metrics
-- ---------------------------------------------------------------------------
ALTER TABLE parse_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE parse_pages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE slide_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full" ON parse_runs   TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service role full" ON parse_pages  TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service role full" ON slide_chunks TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "students read own" ON tutor_messages
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "students insert own" ON tutor_messages
    FOR INSERT WITH CHECK (auth.uid() = user_id AND role = 'student');
CREATE POLICY "service role full" ON tutor_messages TO service_role USING (true) WITH CHECK (true);
```

The existing `quiz_questions` and `slide_embeddings` are kept; this design
populates `quiz_questions.metadata` (jsonb, already shipped) with the
`SlideMeta` block, and `slide_embeddings` becomes a deprecated mirror that we
stop writing to once `slide_chunks` is live.

---

## 6. Async flow (orchestrator)

The orchestrator lives in `backend/services/parser/orchestrator.py`. One
function, ~120 lines. Each stage is a separate module so they can be unit-
tested in isolation.

```python
# backend/services/parser/orchestrator.py

async def parse_pdf(pdf_bytes: bytes, lecture_id: UUID, sse: SSESink) -> UUID:
    pdf_hash = sha256(pdf_bytes).hexdigest()

    # ---- Stage 0 + 1 ------------------------------------------------------
    run = await runs_repo.get_or_create(pdf_hash, lecture_id, PIPELINE_VERSION)
    sse.emit("run_started", {"run_id": str(run.run_id), "resumed": run.has_progress})

    if run.status == RunStatus.COMPLETED:
        await sse.replay_from_db(run.run_id)             # serve from cache
        return run.run_id

    reader = PDFReader(pdf_bytes)
    page_count = await reader.get_page_count()
    await runs_repo.set_page_count(run.run_id, page_count)

    # ---- Stage 2 ----------------------------------------------------------
    await pages_repo.ensure_rows(run.run_id, page_count)

    # ---- Stage 3: extract + classify (resumable) --------------------------
    pending = await pages_repo.list_with_status(run.run_id, PageStatus.PENDING)
    extract_sem = asyncio.Semaphore(8)

    async def extract_one(page_idx: int) -> ExtractedPage:
        async with extract_sem:
            ex = await extract_page(reader, page_idx)
            if ex.route in (SlideRoute.VISION, SlideRoute.MIXED):
                jpeg = await reader.render_page_jpeg(page_idx, zoom=1.5)
                ex.image_url = await storage.put_jpeg(run.run_id, page_idx, jpeg)
                del jpeg
            await pages_repo.commit_extract(run.run_id, ex)
            sse.emit("page_extracted", {"page": page_idx + 1, "route": ex.route})
            return ex

    extracted = await asyncio.gather(*(extract_one(i) for i in pending))
    await runs_repo.set_status(run.run_id, RunStatus.OUTLINING)
    gc.collect()

    # ---- Stage 4: outline (skip if cached) --------------------------------
    if run.outline is None:
        outline = await build_outline(extracted)
        await runs_repo.set_outline(run.run_id, outline)
        sse.emit("outline_ready", outline.model_dump())
    else:
        outline = DeckOutline.model_validate(run.outline)

    # ---- Stage 5: per-slide AI -------------------------------------------
    await runs_repo.set_status(run.run_id, RunStatus.ANALYZING)
    text_pages   = [e for e in extracted if e.route == SlideRoute.TEXT]
    vision_pages = [e for e in extracted if e.route in (SlideRoute.VISION, SlideRoute.MIXED)]

    # batch text in groups of 12 → one LLM call each
    for batch in chunked(text_pages, 12):
        results = await analyze_text_batch(batch, outline)
        for r in results:
            await pages_repo.commit_content(run.run_id, r)
            sse.emit("slide_ready", r.model_dump())

    vision_sem = asyncio.Semaphore(3)
    async def analyze_one_vision(p: ExtractedPage):
        async with vision_sem:
            r = await analyze_vision_slide(p, outline)
            await pages_repo.commit_content(run.run_id, r)
            sse.emit("slide_ready", r.model_dump())

    await asyncio.gather(*(analyze_one_vision(p) for p in vision_pages))

    # title + metadata routes are deterministic, no LLM
    for p in extracted:
        if p.route in (SlideRoute.TITLE, SlideRoute.METADATA):
            r = render_static_slide(p)
            await pages_repo.commit_content(run.run_id, r)
            sse.emit("slide_ready", r.model_dump())

    # ---- Stage 6: embeddings (local, free) -------------------------------
    await runs_repo.set_status(run.run_id, RunStatus.EMBEDDING)
    await embed_all_chunks(run.lecture_id, run.run_id)

    # ---- Stage 7: deck-level summary + concept quiz ----------------------
    await runs_repo.set_status(run.run_id, RunStatus.FINALIZING)
    deck_summary, deck_quiz = await generate_deck_capstone(run.lecture_id, outline)
    sse.emit("deck_complete", {"summary": deck_summary, "quiz": deck_quiz})

    await runs_repo.set_status(run.run_id, RunStatus.COMPLETED)
    return run.run_id
```

Three properties worth highlighting:

- **Idempotent**: every stage reads its starting point from the DB, so a
  killed pod resumes by simply re-invoking `parse_pdf(same_bytes, same_lecture)`.
- **Bounded**: three semaphores cap concurrency; no unbounded `gather` over
  the page count.
- **Observable**: each `sse.emit(...)` is mirrored to a row in
  `pipeline_run_metrics.totals` so the existing diagnostics panel keeps working.

---

## 7. Checkpoint / resume mechanics

A single rule decides what to redo:

```
Stage  | "done" predicate
-------|----------------------------------------------------
2      | parse_pages row exists for every page_index
3      | parse_pages.status >= 'extracted'
4      | parse_runs.outline IS NOT NULL
5      | parse_pages.status = 'analyzed'
6      | EXISTS slide_chunks WHERE lecture_id=? AND page_index=? AND embedding IS NOT NULL
7      | parse_runs.status = 'completed'
```

Resume = read the predicates, start at the lowest unmet one, and `WHERE
status != 'analyzed'` filters in the per-page loops. **No timestamps, no
heuristics, no "last-known-good slide" logic** — Postgres is the state machine.

`pipeline_version` bump invalidates everything for free: the `UNIQUE
(pdf_hash, pipeline_version)` constraint on `parse_runs` means a new row is
created and old rows are ignored by every query.

---

## 8. Narrative context (Stage 4)

This is what's missing from the current pipeline. We do **one** cheap LLM
call before per-slide analysis, on a compact projection of the deck:

```
Input:  for each page → "P12 │ <title-or-first-30-chars>"
Model:  gemini-1.5-flash (free tier, 1M ctx)
Output: DeckOutline { course_topic, sections[], glossary{} }
```

The outline is then injected into every per-slide prompt:

```
You are analysing slide {page_index+1} of a lecture on:
    {outline.course_topic}

This slide belongs to section: "{section_title}"
which we have summarised as: "{section_summary}"

Glossary terms already established in earlier slides:
    {top-K relevant glossary entries}
```

This gives the per-slide model the **lecture context** without re-feeding the
entire deck — typically <300 tokens of prefix per call. The deck-level quiz in
Stage 7 reuses the same outline, which is why cross-slide questions are
possible.

---

## 9. Grounded Socratic tutor (P5)

A separate router, `backend/api/tutor.py`, with one endpoint:

```
POST /api/tutor/{lecture_id}/ask     body: { "question": str }
```

Flow:

```
1. Auth: verify user_id has access to lecture_id.
2. Fetch last 6 turns from tutor_messages (ordered, same lecture_id+user_id).
3. Embed the question with the same bge-small model used in Stage 6.
4. Vector search:
       SELECT page_index, text, section
       FROM slide_chunks
       WHERE lecture_id = $1
       ORDER BY embedding <=> $2
       LIMIT 8;
5. Build a STRICT prompt:
       SYSTEM: "You are a Socratic tutor for this specific lecture.
                You may only use facts contained in <CONTEXT>.
                If the answer is not in <CONTEXT>, reply exactly:
                'That isn't covered in this lecture — let's stay on topic.'
                Cite slide numbers in [P12] form. Ask one guiding
                question back when appropriate."
       <CONTEXT>
         [P3 §Loss functions] {chunk text}
         [P5 §Loss functions] {chunk text}
         ...
       </CONTEXT>
       <HISTORY> ... </HISTORY>
       <QUESTION> {question} </QUESTION>
6. Call Gemini Flash, stream tokens to client.
7. Persist both the student question and the tutor reply to tutor_messages
   with cited_pages parsed out of the [Pn] tokens.
```

Three guarantees this design enforces by construction:

- The model **never** sees content from another `lecture_id` — RLS + the
  `WHERE lecture_id = $1` clause are belt-and-braces.
- The model **never** sees web content — there is no tool call available.
- A dedicated **negative-mode** test (in `backend/tests/integration/`) asks
  questions known to be off-topic and asserts the canned refusal string. If
  the model ever drifts, CI fails.

The retrieval is per-question, not per-session, so the tutor stays grounded
even on long conversations.

---

## 10. Free-tier model routing

| Stage | Model | Why | Daily-budget posture |
|---|---|---|---|
| 4 outline | Gemini 1.5 Flash | 1 call/deck, ~2 k tokens in, ~500 out | trivial |
| 5 text batch | Gemini 1.5 Flash | 1 call per ≤12 slides; 200-slide deck = ~17 calls | cheap |
| 5 vision | Groq Llama 3.2 11B Vision | free tier supports JPEG, fast | rate-limit governed by `Semaphore(3)` |
| 6 embed | FastEmbed `bge-small-en-v1.5` (local, ONNX) | runs on the same pod, no API quota | free, 0 ms network |
| 7 deck quiz | Gemini 1.5 Flash | 2 calls/deck (summarise + quiz) | trivial |
| Tutor | Gemini 1.5 Flash | per question | grounded prompt keeps tokens small |

Hard rule, enforced in `llm_client.py`: the Gemini call wrapper records
prompt+completion tokens in `pipeline_run_metrics.totals.tokens`, and a
per-day Postgres check raises `LLMQuotaExceededError` before issuing the call
when projected daily tokens would exceed 80% of the free-tier limit.

---

## 11. Visual elements

Each non-text route gets a JPEG in Supabase Storage (`pdf_pages/{run_id}/{page_index}.jpg`,
zoom 1.5 ≈ 900 px wide, ≤ 200 KB after JPEG q=85). The vision prompt receives
both the image and the extracted text plus a structured hint built from
PyMuPDF metadata:

```
hint = {
  "table_count": 1,
  "drawing_count": 12,
  "image_count": 1,
  "page_aspect": "16:9"
}
```

The model is instructed to:

- transcribe formulas as LaTeX inside `$...$`,
- describe diagrams as a labelled flow ("Input → Hidden Layer (ReLU) → Output (Softmax)"),
- reproduce tables as Markdown tables,
- caption photos with the educational point they illustrate.

Tables that PyMuPDF detects (`page.find_tables()`) are extracted to Markdown
**before** the LLM call and inserted verbatim into `markdown`, with the model
asked only to add a one-line interpretive caption. This is far more reliable
than asking vision models to re-OCR tables.

---

## 12. Testing posture

Mirrors the existing `backend/tests` tree:

- **unit/parse_classifier.py** — golden-file routing for 30 representative
  pages.
- **unit/parse_orchestrator.py** — runs the orchestrator with a fake
  `PDFReader` and a fake `LLMClient`, asserts stage transitions and
  semaphore caps.
- **integration/checkpoint_resume.py** — start a parse, kill it after
  Stage 3, restart, assert no LLM call is repeated and the final output
  matches the un-killed run byte-for-byte.
- **integration/tutor_grounding.py** — the negative-mode test described
  in §9; also asserts that questions about lecture A never retrieve
  chunks from lecture B.
- **db/parse_runs_state_machine.py** — only valid status transitions
  are accepted.
- **contract/sse_events.py** — every event emitted by the orchestrator
  matches a JSON schema the frontend depends on.

Memory test (nightly only, in `backend/tests/perf/`): parse a synthetic
200-slide deck and assert peak RSS < 250 MB via `tracemalloc` + `resource`.

---

## 13. What gets deleted

Once v3 ships behind a feature flag (`PARSER_VERSION=3`) and the nightly
parity tests pass:

- `backend/services/file_parse_service.py` (854 lines)
- `pdf2image` from `requirements.txt` and the Dockerfile
- `slide_parse_cache` and `pdf_parse_cache` migrations (data migrated to
  `parse_pages`)
- `summarizer_service.py` (its job moves into Stage 7)
- The `_meta` block hack — replaced by the typed `SlideMeta` model

What stays:
- `pdf_reader.py` (its open-process-close pattern is the right one)
- `llm_client.py` (already callable-factory + retry + timeout)
- `slide_classifier.py` heuristics (moved into Stage 3, output type renamed)
- `pipeline_run_metrics`, `quiz_questions.metadata` (consumed unchanged)

---

## 14. Rollout sequence

Each step is a project-task-sized chunk that can ship independently:

1. **Schema** — write the migration in §5; deploy. No code changes yet.
2. **Domain models** — `parse_models.py` from §4 + Pydantic round-trip tests.
3. **PDFReader extensions** — add `find_tables`, `get_drawings` if missing
   (already present, see `pdf_reader.py`).
4. **Stage 3 extractor + classifier rewrite** behind `PARSER_VERSION=3`.
5. **Outline pre-pass (Stage 4)** + golden-file tests.
6. **Batched text + vision analysis (Stage 5)**.
7. **FastEmbed + slide_chunks + tutor endpoint (Stages 6 + tutor)**.
8. **Deck capstone (Stage 7)**.
9. **SSE replay + checkpoint integration tests**.
10. **Flip the flag**, monitor for 48 h, delete the v2 modules.

Each step keeps the v2 pipeline live, so professors can keep uploading the
whole time.
