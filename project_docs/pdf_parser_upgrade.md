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

Wrap the per-slide processing loop in a `try/except` so one bad slide cannot
kill the entire stream. The frontend already handles the `slide_error` event type —
it renders a placeholder card and continues.

Replace the current slide iteration loop with:

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
    METADATA = "metadata"    # already handled by is_metadata_slide()


def classify_slide(text: str, page: fitz.Page) -> SlideType:
    """
    Determine processing strategy for a single slide.
    Call this after PyMuPDF text extraction, before any AI call.
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
The `slide_type` value from this classifier should be stored in the output JSON `_meta` block
(see Part 4).

---

## Part 3 — New Module: `llm_client.py` (reliability wrapper)

Create `backend/services/llm_client.py`. This wraps every LLM call with retry logic
and a hard timeout. All AI calls in `ai_service.py` must be routed through this wrapper —
do not call the LLM SDKs directly from `ai_service.py` anymore.

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
async def _call_with_retry(coro):
    try:
        return await coro
    except Exception as exc:
        if _is_retryable(exc):
            raise LLMRateLimitError(str(exc)) from exc
        raise  # non-retryable errors propagate immediately


async def call_llm(coro, timeout_seconds: float = 25.0):
    """
    Wraps any LLM coroutine with:
    - 25s hard timeout (raises LLMTimeoutError)
    - 3x exponential backoff on rate limits / transient errors

    Usage:
        result = await call_llm(gemini.generate(prompt, image=img))
    """
    try:
        return await asyncio.wait_for(
            _call_with_retry(coro),
            timeout=timeout_seconds,
        )
    except asyncio.TimeoutError:
        raise LLMTimeoutError(f"LLM call exceeded {timeout_seconds}s timeout")
```

Update every `await llm.generate(...)` call in `ai_service.py` to:
```python
result = await call_llm(llm.generate(prompt, image=image))
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
    """
    tokens = _enc.encode(text)
    original_count = len(tokens)
    if original_count > MAX_TEXT_TOKENS_PER_SLIDE:
        tokens = tokens[:MAX_TEXT_TOKENS_PER_SLIDE]
        text = _enc.decode(tokens) + "\n[content truncated]"
    return text, min(original_count, MAX_TEXT_TOKENS_PER_SLIDE)
```

---

## Part 6 — JPEG Resolution Reduction

In `file_parse_service.py`, find the `pdf2image` / `convert_from_bytes` call and
change the resolution parameters:

```python
# Before
images = convert_from_bytes(pdf_bytes, dpi=150, fmt="jpeg")

# After — reduces vision token cost by ~40% with no quality loss on text slides
images = convert_from_bytes(
    pdf_bytes,
    dpi=120,
    fmt="jpeg",
    size=(900, None),   # width=900px, height scales automatically
    jpegopt={"quality": 85, "optimize": True},
)
```

---

## Part 7 — Batch Processing for Text-Only Slides

This is the highest-impact change. Instead of one API call per `SlideType.TEXT` slide,
collect all text slides and send them in a single batch call.

### 7.1 — New prompt in `prompts.py` (create this file)

Create `backend/services/prompts.py`:

```python
BATCH_SLIDE_PROMPT = """\
You will receive a batch of university lecture slides separated by === SLIDE N === markers.
For EACH slide, return a JSON object with exactly these fields:
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

Add this function to `ai_service.py`:

```python
import json
from .prompts import BATCH_SLIDE_PROMPT
from .llm_client import call_llm


async def batch_analyze_text_slides(slides: list[dict]) -> list[dict]:
    """
    slides: list of {"page_number": int, "text": str}
    Returns: list of parsed slide result dicts, same order as input.
    """
    if not slides:
        return []

    # Build batch prompt
    parts = []
    for s in slides:
        parts.append(f"=== SLIDE {s['page_number']} ===\n{s['text']}")

    prompt = BATCH_SLIDE_PROMPT + "\n\n".join(parts)

    raw = await call_llm(llm.generate(prompt))

    # Parse — handle models that wrap output in ```json fences
    cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()

    try:
        results = json.loads(cleaned)
    except json.JSONDecodeError:
        # If batch parse fails, return error placeholders for each slide
        return [
            {
                "title": f"Slide {s['page_number']}",
                "content": s["text"],
                "summary": "",
                "questions": [],
                "slide_type": "content_slide",
                "is_metadata": False,
                "parse_error": "batch_json_decode_failed",
            }
            for s in slides
        ]

    # Ensure we got the right number of results
    if len(results) != len(slides):
        # Fallback: pad or trim to match input length
        while len(results) < len(slides):
            results.append({"title": "Unknown slide", "content": "", "summary": "",
                            "questions": [], "slide_type": "content_slide", "is_metadata": False})

    return results[:len(slides)]
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
        classifications.append((slide_type, text, token_count))

        if needs_vision(slide_type):
            image = render_page_to_jpeg(page, width=900)
            vision_queue.append({"index": i, "page_number": i+1, "text": text, "image": image})
        elif slide_type != SlideType.TITLE:
            text_batch.append({"index": i, "page_number": i+1, "text": text})

    # Pass 2a: batch all text slides in one call
    text_results = {}
    if text_batch:
        batch_output = await batch_analyze_text_slides(text_batch)
        for slide_input, result in zip(text_batch, batch_output):
            text_results[slide_input["index"]] = result

    # Pass 2b: vision slides individually (concurrently, capped at 3 at a time)
    vision_results = {}
    semaphore = asyncio.Semaphore(3)

    async def process_vision_slide(vs):
        async with semaphore:
            try:
                result = await call_llm(
                    analyze_vision_slide(vs["text"], vs["image"])
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

        if slide_type == SlideType.TITLE:
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

Add to `ai_service.py`:

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
        llm.generate(SUMMARIZER_PROMPT + "\n\n" + all_slide_text),
        timeout_seconds=40.0,
    )

async def generate_deck_quiz(summary: str) -> list[dict]:
    """Stage 2: generate cross-slide quiz from the summary."""
    raw = await call_llm(llm.generate(DECK_QUIZ_PROMPT + summary))
    cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return []
```

Trigger these after all slides are streamed. Yield the result as a final SSE event:

```python
# After the slide loop in parse_pdf_stream()
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

```python
import hashlib
from .cache import get_cached_parse, store_cached_parse  # implement with your DB

def compute_pdf_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()

# In the upload endpoint, after validate_upload():
pdf_hash = compute_pdf_hash(content)
cached = await get_cached_parse(pdf_hash)
if cached:
    # Stream cached results directly, no AI calls needed
    async def cached_stream():
        for slide in cached["slides"]:
            yield f"data: {json.dumps({'event': 'slide', 'data': slide})}\n\n"
        yield f"data: {json.dumps({'event': 'deck_complete', 'data': cached['deck']})}\n\n"
    return StreamingResponse(cached_stream(), media_type="text/event-stream")

# ... proceed with full parse, then store result:
await store_cached_parse(pdf_hash, {"slides": results, "deck": deck_data})
```

Implement `get_cached_parse` / `store_cached_parse` against whatever database
the project already uses (PostgreSQL / Redis / SQLite). Store the full result JSON
keyed by hash. TTL of 30 days is appropriate.

---

## Part 10 — Helper: Page to JPEG Renderer

Replace the `pdf2image` call with a `PyMuPDF`-native renderer to remove a dependency
and reduce overhead. Add to `file_parse_service.py`:

```python
def render_page_to_jpeg(page: fitz.Page, width: int = 900) -> bytes:
    """Render a single PDF page to JPEG bytes at target width."""
    scale = width / page.rect.width
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    return pix.tobytes("jpeg", jpg_quality=85)
```

If the project has other dependencies on `pdf2image` (e.g., thumbnail generation),
keep `pdf2image` for those and use this function only in the parse pipeline.

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
| `backend/services/llm_client.py` | **Create** | `call_llm()` with timeout + tenacity retry |
| `backend/services/prompts.py` | **Create** | `BATCH_SLIDE_PROMPT`, `SINGLE_VISION_SLIDE_PROMPT`, `SUMMARIZER_PROMPT`, `DECK_QUIZ_PROMPT` |

---

## Implementation Order

Work in this exact sequence. Each step is independently testable before moving on.

1. **Dockerfile + requirements.txt** — verify Docker build succeeds locally
2. **`validate_upload()`** — test with a password-protected PDF, a 0-byte file, a 100-page PDF
3. **SSE error boundary** — manually throw inside the loop and confirm stream continues
4. **`slide_classifier.py`** — unit test with synthetic slide objects covering all 5 types
5. **`llm_client.py`** — mock an LLM that returns 429 three times, confirm retry and success on 4th
6. **`safe_truncate_text()`** — test with a 2000-word slide, confirm truncation at 800 tokens
7. **`render_page_to_jpeg()`** — verify output dimensions are ≤ 900px wide
8. **Metadata `_meta` block** — confirm it appears in every SSE event, including error events
9. **`batch_analyze_text_slides()`** — test with a 10-slide deck, confirm single API call
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
- If the existing `ai_service.py` uses a class-based LLM client, adapt `call_llm()` to
  wrap the method call rather than a standalone function.
- The `all-MiniLM-L6-v2` embedding model mentioned in the research is for a future RAG
  feature — do not add it in this implementation.
- Async job queues (Celery, Redis Streams) are explicitly out of scope — the SSE model stays.
- If you find the existing code uses a different variable name for the slide text or page
  object, preserve those names and adapt accordingly rather than renaming.
