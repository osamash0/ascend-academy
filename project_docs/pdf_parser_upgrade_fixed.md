# PDF Parser Upgrade — Ascend Academy
## Implementation Spec for Claude Code

This document is a full implementation brief. Read it entirely before writing any code.
Apply all changes to the existing codebase. Do not rewrite working code unless a section
explicitly says to replace it.

---

## Context & Current State

The existing pipeline is in:
- `backend/api/upload.py` — FastAPI endpoint `/api/upload/parse-pdf-stream`
- `backend/services/file_parse_service.py` — orchestration logic
- `backend/services/ai_service.py` — LLM interaction (Gemini / Groq / Ollama)
- `src/components/PDFUploadOverlay.tsx` — frontend SSE consumer

The current flow:
1. PDF uploaded → `pdf2image` converts every page to 1280px JPEG
2. Each slide → one AI call (vision + text in parallel)
3. Results stream back via SSE one slide at a time
4. `is_metadata_slide()` suppresses quiz generation for non-educational slides

**What works and must not break:**
- SSE streaming to the frontend
- Dual-track routing (vision vs text-only fallback)
- `is_metadata` flag and quiz suppression
- The final JSON schema shape (title, content, summary, questions, slide_type, is_metadata)

---

## Part 1 — Deploy Blockers (implement first, in this order)

### 1.1 — Poppler system dependency in Dockerfile

`pdf2image` requires `poppler-utils` at OS level. Without it, every upload returns
`OSError: Unable to get page count`. Add to `Dockerfile` **before** the pip install step:

```dockerfile
RUN apt-get update && apt-get install -y \
    poppler-utils \
    libpoppler-cpp-dev \
    && rm -rf /var/lib/apt/lists/*
```

Also pin versions in `requirements.txt`:
```
pdf2image==1.17.0
pymupdf==1.24.0
tenacity==8.2.3
tiktoken==0.7.0
```

### 1.2 — File validation gate in `upload.py`

Add this check at the very top of the upload endpoint handler, before any processing:

```python
import fitz  # PyMuPDF

MAX_FILE_MB = 25
MAX_PAGES = 80

async def validate_upload(file: UploadFile) -> bytes:
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are supported.")

    content = await file.read()

    if len(content) > MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(413, f"File exceeds the {MAX_FILE_MB}MB limit.")

    try:
        doc = fitz.open(stream=content, filetype="pdf")
        page_count = len(doc)
        doc.close()
    except Exception:
        raise HTTPException(400, "File appears to be corrupted or password-protected.")

    if page_count == 0:
        raise HTTPException(400, "PDF has no pages.")

    if page_count > MAX_PAGES:
        raise HTTPException(400, f"Max {MAX_PAGES} slides supported. This file has {page_count}.")

    return content
```

Call `content = await validate_upload(file)` as the first line of the endpoint.

### 1.3 — Per-slide SSE error boundary in `file_parse_service.py`

First, create a safe wrapper around whatever the existing single-slide analysis function
is named in `file_parse_service.py` (e.g. `analyze_slide`, `process_slide`, etc.).
Rename it `analyze_slide_safe` or add this alias at the top of the module:

```python
# Alias the existing single-slide handler so the error boundary below can reference it.
# If the function is already named differently, update this assignment to match.
analyze_slide_safe = analyze_slide  # replace `analyze_slide` with the actual function name
```

Then replace the current slide iteration loop with:

```python
async def parse_slides_stream(pages: list):
    for i, page in enumerate(pages):
        try:
            result = await analyze_slide_safe(page)
            yield {"event": "slide", "data": result}
        except Exception as e:
            yield {
                "event": "slide_error",
                "data": {
                    "page": i + 1,
                    "error": str(e),
                    "title": f"Slide {i + 1} — could not be parsed",
                    "is_metadata": True,
                },
            }
            continue  # never break the stream
```

---

## Part 2 — New Module: `slide_classifier.py`

Create `backend/services/slide_classifier.py`. This module makes the routing decision
explicit and testable rather than buried in AI prompts.

```python
from enum import Enum
import fitz


class SlideType(Enum):
    TITLE    = "title"       # short text only, no quiz
    TEXT     = "text"        # text-heavy, batch with others
    DIAGRAM  = "diagram"     # vision required
    MIXED    = "mixed"       # vision + text
    METADATA = "metadata"    # title/agenda/copyright slides identified by is_metadata_slide()


def classify_slide(text: str, page: fitz.Page) -> SlideType:
    """
    Determine processing strategy for a single slide.
    Call this after PyMuPDF text extraction, before any AI call.
    Note: METADATA is assigned by the caller after running is_metadata_slide(),
    not returned by this function directly.
    """
    words = len(text.split())
    has_images = len(page.get_images(full=False)) > 0

    if words < 15:
        return SlideType.TITLE

    if has_images and words < 80:
        return SlideType.DIAGRAM

    if has_images and words >= 80:
        return SlideType.MIXED

    return SlideType.TEXT


def needs_vision(slide_type: SlideType) -> bool:
    return slide_type in (SlideType.DIAGRAM, SlideType.MIXED)
```

Import and use this classifier in `file_parse_service.py` before the AI routing decision.
After calling `classify_slide()`, override the result with `SlideType.METADATA` for any
slide where the existing `is_metadata_slide()` returns `True`:

```python
slide_type = classify_slide(text, page)
if is_metadata_slide(text):
    slide_type = SlideType.METADATA
```

The `slide_type` value should be stored in the output JSON `_meta` block (see Part 4).

---

## Part 3 — New Module: `llm_client.py` (reliability wrapper)

Create `backend/services/llm_client.py`. This wraps every LLM call with retry logic
and a hard timeout.

**IMPORTANT — callable factory pattern:** Python coroutines are single-use objects.
Passing a coroutine directly to a retry loop causes `RuntimeError: cannot reuse already
awaited coroutine` on the second attempt. Always pass a zero-argument callable (lambda or
`functools.partial`) so the retry loop can create a fresh coroutine each attempt.

```python
import asyncio
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)


class LLMTimeoutError(Exception):
    pass


class LLMRateLimitError(Exception):
    pass


def _is_retryable(exc: Exception) -> bool:
    """Return True for rate limits and transient errors, False for bad inputs."""
    msg = str(exc).lower()
    return any(k in msg for k in ("429", "rate limit", "quota", "503", "timeout"))


@retry(
    retry=retry_if_exception_type(LLMRateLimitError),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=12),
    reraise=True,
)
async def _call_with_retry(fn):
    """
    fn must be a zero-argument callable that returns a coroutine when called.
    Called fresh on each retry attempt to avoid coroutine reuse errors.
    """
    try:
        return await fn()
    except Exception as exc:
        if _is_retryable(exc):
            raise LLMRateLimitError(str(exc)) from exc
        raise  # non-retryable errors propagate immediately


async def call_llm(fn, timeout_seconds: float = 25.0):
    """
    Wraps any LLM call with:
    - 25s hard timeout (raises LLMTimeoutError)
    - 3x exponential backoff on rate limits / transient errors

    fn must be a CALLABLE (lambda or partial), NOT a coroutine.

    Usage:
        result = await call_llm(lambda: gemini.generate(prompt, image=img))

    WRONG — coroutine passed directly, will fail on retry:
        result = await call_llm(gemini.generate(prompt, image=img))  # ❌
    """
    try:
        return await asyncio.wait_for(
            _call_with_retry(fn),
            timeout=timeout_seconds,
        )
    except asyncio.TimeoutError:
        raise LLMTimeoutError(f"LLM call exceeded {timeout_seconds}s timeout")
```

Update every `await llm.generate(...)` call in `ai_service.py` to use the callable pattern:

```python
result = await call_llm(lambda: llm.generate(prompt, image=image))
```

If the existing `ai_service.py` uses a class-based LLM client, wrap the method call:

```python
result = await call_llm(lambda: self.llm.generate(prompt))
```

---

## Part 4 — Metadata Enrichment

Extend the output schema to include a `_meta` block on every slide object.
This block is for internal debugging and is **not shown to the student** — the frontend
must ignore keys prefixed with `_`.

Add this helper to `file_parse_service.py`:

```python
import time

def build_slide_meta(
    source_file: str,
    slide_number: int,
    slide_type: str,
    word_count: int,
    has_images: bool,
    vision_used: bool,
    tokens_input: int,
    processing_ms: int,
) -> dict:
    return {
        "source_file":    source_file,
        "slide_number":   slide_number,
        "slide_type":     slide_type,
        "word_count":     word_count,
        "has_images":     has_images,
        "vision_used":    vision_used,
        "tokens_input":   tokens_input,
        "processing_ms":  processing_ms,
    }
```

Merge `_meta` into every slide result dict before yielding it from the SSE generator:

```python
t_start = time.monotonic()
result = await analyze_slide_safe(page)
result["_meta"] = build_slide_meta(
    source_file=filename,
    slide_number=i + 1,
    slide_type=slide_type.value,
    word_count=word_count,
    has_images=has_images,
    vision_used=needs_vision(slide_type),
    tokens_input=token_count,
    processing_ms=int((time.monotonic() - t_start) * 1000),
)
yield {"event": "slide", "data": result}
```

---

## Part 5 — Token Cap per Slide

Add to `file_parse_service.py`. Call `safe_truncate_text()` on every extracted text
string before passing it to any AI call.

```python
import tiktoken

_enc = tiktoken.get_encoding("cl100k_base")
MAX_TEXT_TOKENS_PER_SLIDE = 800


def safe_truncate_text(text: str) -> tuple[str, int]:
    """
    Returns (truncated_text, token_count).
    Truncates to MAX_TEXT_TOKENS_PER_SLIDE if needed.
    The .strip() after decode removes any partial whitespace that can appear
    at token boundaries.
    """
    tokens = _enc.encode(text)
    original_count = len(tokens)
    if original_count > MAX_TEXT_TOKENS_PER_SLIDE:
        tokens = tokens[:MAX_TEXT_TOKENS_PER_SLIDE]
        text = _enc.decode(tokens).strip() + "\n[content truncated]"
    return text, min(original_count, MAX_TEXT_TOKENS_PER_SLIDE)
```

---

## Part 6 — JPEG Resolution Reduction

> **Superseded by Part 10.** Part 10 replaces `pdf2image` entirely with PyMuPDF's
> native renderer. Do not apply this change. The target width of 900px and JPEG quality
> of 85 are already baked into `render_page_to_jpeg()` in Part 10.
>
> If `pdf2image` is retained elsewhere in the project (e.g. thumbnail generation),
> apply these parameters to those remaining call sites only:
> ```python
> images = convert_from_bytes(
>     pdf_bytes,
>     dpi=120,
>     fmt="jpeg",
>     size=(900, None),
>     jpegopt={"quality": 85, "optimize": True},
> )
> ```

---

## Part 7 — Batch Processing for Text-Only Slides

This is the highest-impact change. Instead of one API call per `SlideType.TEXT` slide,
collect all text slides and send them in a single batch call.

### 7.1 — New prompt in `prompts.py` (create this file)

Create `backend/services/prompts.py`:

```python
BATCH_SLIDE_PROMPT = """\
You will receive a batch of university lecture slides separated by === SLIDE N === markers,
where N is the original slide number.
For EACH slide, return a JSON object with exactly these fields:
- "page_number": the integer N from the === SLIDE N === marker (required for ordering)
- "title": concise AI-generated title (string)
- "content": educational content in GitHub-flavored Markdown (string)
- "summary": 2-3 sentence overview for quick review (string)
- "questions": array with exactly ONE multiple-choice question object:
    { "question": string, "options": [A, B, C, D], "answer": "A"|"B"|"C"|"D" }
- "slide_type": one of "content_slide", "diagram_slide", "title_slide"
- "is_metadata": false

Return a JSON array — one object per slide, in the same order as input.
Return ONLY the JSON array. No preamble, no explanation, no markdown fences.

Slides:
"""

SINGLE_VISION_SLIDE_PROMPT = """\
Analyze this lecture slide image and its extracted text.
Return a single JSON object with exactly these fields:
- "title": concise AI-generated title (string)
- "content": educational content in GitHub-flavored Markdown (string)
- "summary": 2-3 sentence overview (string)
- "questions": array with exactly ONE multiple-choice question object:
    { "question": string, "options": [A, B, C, D], "answer": "A"|"B"|"C"|"D" }
- "slide_type": "diagram_slide" or "content_slide"
- "is_metadata": boolean

Return ONLY the JSON object. No preamble, no markdown fences.

Extracted text from slide:
{text}
"""
```

### 7.2 — Batch processor in `ai_service.py`

Add this function to `ai_service.py`. The `llm` variable refers to whatever LLM client
object is already instantiated in this file — do not change how it is created.

```python
import json
from .prompts import BATCH_SLIDE_PROMPT
from .llm_client import call_llm


async def batch_analyze_text_slides(slides: list[dict]) -> dict[int, dict]:
    """
    slides: list of {"index": int, "page_number": int, "text": str}
    Returns: dict keyed by index (not page_number) → parsed slide result dict.

    Results are matched back to input slides by the "page_number" field each
    result object must return. This makes the mapping robust to models that
    reorder or skip items in the batch output.
    """
    if not slides:
        return {}

    # Build batch prompt
    parts = []
    for s in slides:
        parts.append(f"=== SLIDE {s['page_number']} ===\n{s['text']}")

    prompt = BATCH_SLIDE_PROMPT + "\n\n".join(parts)

    raw = await call_llm(lambda: llm.generate(prompt))

    # Parse — handle models that wrap output in ```json fences
    cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()

    # Build a lookup from page_number → input slide index
    page_to_index = {s["page_number"]: s["index"] for s in slides}

    try:
        results = json.loads(cleaned)
    except json.JSONDecodeError:
        # Batch parse failed — return error placeholders keyed by index
        return {
            s["index"]: {
                "title": f"Slide {s['page_number']}",
                "content": s["text"],
                "summary": "",
                "questions": [],
                "slide_type": "content_slide",
                "is_metadata": False,
                "parse_error": "batch_json_decode_failed",
            }
            for s in slides
        }

    # Map results back to input indices via page_number.
    # Handles models that reorder, skip, or add extra items.
    output = {}
    for result in results:
        pn = result.get("page_number")
        if pn in page_to_index:
            output[page_to_index[pn]] = result

    # Fill any slides the model silently dropped
    for s in slides:
        if s["index"] not in output:
            output[s["index"]] = {
                "title": f"Slide {s['page_number']}",
                "content": s["text"],
                "summary": "",
                "questions": [],
                "slide_type": "content_slide",
                "is_metadata": False,
                "parse_error": "missing_from_batch_response",
            }

    return output
```

### 7.3 — Updated orchestration loop in `file_parse_service.py`

Replace the current slide-by-slide loop with this two-pass approach:

```python
from .slide_classifier import classify_slide, SlideType, needs_vision
from .ai_service import batch_analyze_text_slides, analyze_vision_slide

async def parse_pdf_stream(pdf_bytes: bytes, filename: str):
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    # Pass 1: classify all slides, separate text from vision
    text_batch = []    # {"index": int, "page_number": int, "text": str}
    vision_queue = []  # {"index": int, "page_number": int, "text": str, "image": bytes}
    classifications = []

    for i, page in enumerate(doc):
        text = page.get_text("text").strip()
        text, token_count = safe_truncate_text(text)
        slide_type = classify_slide(text, page)
        # Let the existing is_metadata_slide() check override the classifier result
        if is_metadata_slide(text):
            slide_type = SlideType.METADATA
        classifications.append((slide_type, text, token_count))

        if needs_vision(slide_type):
            image = render_page_to_jpeg(page, width=900)
            vision_queue.append({"index": i, "page_number": i+1, "text": text, "image": image})
        elif slide_type not in (SlideType.TITLE, SlideType.METADATA):
            text_batch.append({"index": i, "page_number": i+1, "text": text})

    # Pass 2a: batch all text slides in one call
    # Returns dict[index → result]
    text_results = {}
    if text_batch:
        text_results = await batch_analyze_text_slides(text_batch)

    # Pass 2b: vision slides individually (concurrently, capped at 3 at a time)
    vision_results = {}
    semaphore = asyncio.Semaphore(3)

    async def process_vision_slide(vs):
        async with semaphore:
            try:
                result = await call_llm(
                    lambda: analyze_vision_slide(vs["text"], vs["image"])
                )
                vision_results[vs["index"]] = result
            except Exception as e:
                vision_results[vs["index"]] = {
                    "title": f"Slide {vs['page_number']}",
                    "content": vs["text"],
                    "summary": "",
                    "questions": [],
                    "slide_type": "diagram_slide",
                    "is_metadata": False,
                    "parse_error": str(e),
                }

    await asyncio.gather(*[process_vision_slide(vs) for vs in vision_queue])

    # Pass 3: yield results in original slide order
    for i, page in enumerate(doc):
        slide_type, text, token_count = classifications[i]
        t_start = time.monotonic()

        if slide_type in (SlideType.TITLE, SlideType.METADATA):
            # No AI was called for these slides; processing_ms will correctly be ~0.
            result = {
                "title": text[:80] if text else f"Slide {i+1}",
                "content": text,
                "summary": "",
                "questions": [],
                "slide_type": "title_slide",
                "is_metadata": True,
            }
        else:
            result = text_results.get(i) or vision_results.get(i) or {
                "title": f"Slide {i+1}",
                "content": text,
                "summary": "",
                "questions": [],
                "slide_type": "content_slide",
                "is_metadata": False,
                "parse_error": "not_processed",
            }

        result["_meta"] = build_slide_meta(
            source_file=filename,
            slide_number=i + 1,
            slide_type=slide_type.value,
            word_count=len(text.split()),
            has_images=needs_vision(slide_type),
            vision_used=needs_vision(slide_type),
            tokens_input=token_count,
            processing_ms=int((time.monotonic() - t_start) * 1000),
        )

        yield {"event": "slide", "data": result}

    doc.close()
```

---

## Part 8 — Summarization Layer for Quiz Generation

Add a two-stage quiz generation path. This does not replace the per-slide quiz
(students still see that) — it adds a deck-level quiz that is far more educationally
valuable and generated at a fraction of the cost.

Add to `ai_service.py`. The `llm` variable is the same client instance already in this
file.

```python
SUMMARIZER_PROMPT = """\
Compress this university lecture into a focused study summary.
Keep: key definitions, formulas, relationships between concepts, worked examples.
Drop: slide meta-text, repeated headers, filler phrases.
Target length: under 2000 tokens.
Format as structured Markdown with headers per topic.
"""

DECK_QUIZ_PROMPT = """\
Based on this lecture summary, generate 5 multiple-choice questions that test
conceptual understanding — not just recall. Include at least 2 questions that
connect ideas from different parts of the lecture.

Return a JSON array of question objects:
[{ "question": str, "options": [A,B,C,D], "answer": "A"|"B"|"C"|"D",
   "explanation": str, "topics": [str] }]

Return ONLY the JSON array.

Summary:
"""

async def generate_deck_summary(all_slide_text: str) -> str:
    """Stage 1: compress full deck text to ~2000 tokens."""
    return await call_llm(
        lambda: llm.generate(SUMMARIZER_PROMPT + "\n\n" + all_slide_text),
        timeout_seconds=40.0,
    )

async def generate_deck_quiz(summary: str) -> list[dict]:
    """Stage 2: generate cross-slide quiz from the summary."""
    raw = await call_llm(lambda: llm.generate(DECK_QUIZ_PROMPT + summary))
    cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return []
```

Trigger these after all slides are streamed. Yield the result as a final SSE event:

```python
# After the slide loop in parse_pdf_stream()
# Exclude TITLE and METADATA slides — they add noise without educational content.
# METADATA slides are now correctly excluded via SlideType.METADATA.
all_text = "\n\n".join(
    f"[Slide {i+1}] {c[1]}" for i, c in enumerate(classifications)
    if c[0] not in (SlideType.TITLE, SlideType.METADATA)
)

try:
    summary = await generate_deck_summary(all_text)
    deck_quiz = await generate_deck_quiz(summary)
    yield {
        "event": "deck_complete",
        "data": {
            "deck_summary": summary,
            "deck_quiz": deck_quiz,
            "total_slides": len(classifications),
        },
    }
except Exception as e:
    yield {"event": "deck_error", "data": {"error": str(e)}}
```

---

## Part 9 — Content Hash Cache

Add to `upload.py`. Short-circuit the entire pipeline for re-uploaded PDFs.

First, create `backend/services/cache.py`. Two implementations are provided; use
whichever matches the database the project already uses. Do not add a new database
dependency.

**Option A — Redis (preferred if Redis is already in the stack):**

```python
import json
import redis.asyncio as aioredis

CACHE_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 days
_redis: aioredis.Redis | None = None

def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        # Uses REDIS_URL env var; falls back to localhost
        import os
        _redis = aioredis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))
    return _redis

async def get_cached_parse(pdf_hash: str) -> dict | None:
    raw = await get_redis().get(f"pdf_parse:{pdf_hash}")
    if raw is None:
        return None
    return json.loads(raw)

async def store_cached_parse(pdf_hash: str, data: dict) -> None:
    await get_redis().setex(
        f"pdf_parse:{pdf_hash}",
        CACHE_TTL_SECONDS,
        json.dumps(data),
    )
```

**Option B — PostgreSQL (if only Postgres is available):**

```python
import json
from datetime import datetime, timedelta, timezone
# Import your existing DB session/engine here, e.g.:
# from .database import get_db_session

CACHE_TTL_DAYS = 30

async def get_cached_parse(pdf_hash: str) -> dict | None:
    async with get_db_session() as db:
        row = await db.fetchrow(
            """
            SELECT result FROM pdf_parse_cache
            WHERE pdf_hash = $1 AND expires_at > NOW()
            """,
            pdf_hash,
        )
    return json.loads(row["result"]) if row else None

async def store_cached_parse(pdf_hash: str, data: dict) -> None:
    expires = datetime.now(timezone.utc) + timedelta(days=CACHE_TTL_DAYS)
    async with get_db_session() as db:
        await db.execute(
            """
            INSERT INTO pdf_parse_cache (pdf_hash, result, expires_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (pdf_hash) DO UPDATE
              SET result = EXCLUDED.result, expires_at = EXCLUDED.expires_at
            """,
            pdf_hash, json.dumps(data), expires,
        )
```

For Option B, add this migration before deploying:

```sql
CREATE TABLE IF NOT EXISTS pdf_parse_cache (
    pdf_hash   TEXT PRIMARY KEY,
    result     TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pdf_parse_cache_expires ON pdf_parse_cache (expires_at);
```

**In `upload.py`, after `validate_upload()`:**

```python
import hashlib
from .cache import get_cached_parse, store_cached_parse

def compute_pdf_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()

# In the upload endpoint, after validate_upload():
pdf_hash = compute_pdf_hash(content)
cached = await get_cached_parse(pdf_hash)
if cached:
    async def cached_stream():
        for slide in cached["slides"]:
            yield f"data: {json.dumps({'event': 'slide', 'data': slide})}\n\n"
        yield f"data: {json.dumps({'event': 'deck_complete', 'data': cached['deck']})}\n\n"
    return StreamingResponse(cached_stream(), media_type="text/event-stream")

# ... proceed with full parse, then store result:
await store_cached_parse(pdf_hash, {"slides": results, "deck": deck_data})
```

---

## Part 10 — Helper: Page to JPEG Renderer

Replace the `pdf2image` call in the parse pipeline with a `PyMuPDF`-native renderer to
remove a dependency and reduce overhead. Add to `file_parse_service.py`:

```python
def render_page_to_jpeg(page: fitz.Page, width: int = 900) -> bytes:
    """Render a single PDF page to JPEG bytes at target width."""
    scale = width / page.rect.width
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    return pix.tobytes("jpeg", jpg_quality=85)
```

Remove the `pdf2image` / `convert_from_bytes` call from the parse pipeline entirely and
use `render_page_to_jpeg` instead. If `pdf2image` is used elsewhere in the project
(e.g. thumbnail generation), leave those call sites unchanged.

---

## File Change Summary

| File | Action | What changes |
|---|---|---|
| `Dockerfile` | Edit | Add `poppler-utils` apt install |
| `requirements.txt` | Edit | Pin `pdf2image`, `pymupdf`, add `tenacity`, `tiktoken` |
| `backend/api/upload.py` | Edit | Add `validate_upload()`, hash cache check |
| `backend/services/file_parse_service.py` | Major edit | Two-pass classifier loop, SSE error boundary, token cap, metadata enrichment, JPEG renderer |
| `backend/services/ai_service.py` | Edit | Add `batch_analyze_text_slides()`, `generate_deck_summary()`, `generate_deck_quiz()`, route all calls through `llm_client` |
| `backend/services/slide_classifier.py` | **Create** | `SlideType` enum + `classify_slide()` function |
| `backend/services/llm_client.py` | **Create** | `call_llm()` with timeout + tenacity retry (callable factory pattern) |
| `backend/services/prompts.py` | **Create** | `BATCH_SLIDE_PROMPT`, `SINGLE_VISION_SLIDE_PROMPT`, `SUMMARIZER_PROMPT`, `DECK_QUIZ_PROMPT` |
| `backend/services/cache.py` | **Create** | `get_cached_parse()` / `store_cached_parse()` — Redis or PostgreSQL |

---

## Implementation Order

Work in this exact sequence. Each step is independently testable before moving on.

1. **Dockerfile + requirements.txt** — verify Docker build succeeds locally
2. **`validate_upload()`** — test with a password-protected PDF, a 0-byte file, a 100-page PDF
3. **SSE error boundary + `analyze_slide_safe` alias** — manually throw inside the loop and confirm stream continues
4. **`slide_classifier.py`** — unit test with synthetic slide objects covering all 5 types; confirm `is_metadata_slide()` overrides the classifier
5. **`llm_client.py`** — mock an LLM that returns 429 three times; confirm retry uses a fresh coroutine each attempt and succeeds on 4th call
6. **`safe_truncate_text()`** — test with a 2000-word slide, confirm truncation at 800 tokens with clean output
7. **`render_page_to_jpeg()`** — verify output dimensions are ≤ 900px wide; remove `pdf2image` from parse pipeline
8. **Metadata `_meta` block** — confirm it appears in every SSE event, including error events; confirm `processing_ms ≈ 0` for TITLE/METADATA slides is expected
9. **`batch_analyze_text_slides()`** — test with a 10-slide deck; confirm single API call; simulate model returning slides out of order and confirm correct index mapping
10. **Two-pass orchestration loop** — full end-to-end test with a real 20-slide lecture PDF
11. **Summarization layer** — test `deck_complete` SSE event is received by frontend
12. **Content hash cache** — upload same PDF twice, confirm second upload returns instantly

---

## What NOT to Change

- The SSE event format consumed by `PDFUploadOverlay.tsx` — only add new event types
  (`deck_complete`, `deck_error`, `slide_error`), never change the `slide` event shape
- The `is_metadata` detection logic — it already works correctly
- The Ollama / local model fallback path — keep it exactly as-is
- The `questions` array schema — frontend depends on this structure

---

## Notes for Claude Code

- Do not install new packages beyond what is listed in Part 1.1.
- All LLM calls must use the callable factory pattern: `lambda: llm.generate(...)` —
  never pass a bare coroutine to `call_llm()`.
- If the existing `ai_service.py` uses a class-based LLM client, adapt accordingly:
  `lambda: self.llm.generate(prompt)`.
- The `all-MiniLM-L6-v2` embedding model mentioned in the research is for a future RAG
  feature — do not add it in this implementation.
- Async job queues (Celery, Redis Streams) are explicitly out of scope — the SSE model stays.
- If you find the existing code uses a different variable name for the slide text or page
  object, preserve those names and adapt accordingly rather than renaming.
- For the cache module: pick Redis if `REDIS_URL` is already in the project's env config,
  otherwise pick PostgreSQL. Do not add both.
