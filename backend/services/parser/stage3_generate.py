"""Stage 3 — Context-aware per-slide AI generation.

Two concurrent paths:

TEXT path  — batches of ≤ 12 TEXT/TITLE slides per LLM call, Semaphore(2).
             Each call injects the DeckOutline section context.

VISION path — individual VISION/MIXED slides, Semaphore(3).
              JPEG fetched from Supabase Storage, sent with the extracted text
              and a structural hint (table_count, drawing_count, image_count).

METADATA/TITLE slides → rendered deterministically, no LLM call.

Every result is committed to parse_pages.content and emitted as an SSE event.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Optional
from uuid import UUID

from openai import AsyncOpenAI

from backend.core.config import settings
from backend.core.database import get_client
from backend.domain.parse_models import (
    DeckOutline,
    ExtractedPage,
    OutlineSection,
    QuizQuestion,
    SlideContent,
    SlideMeta,
    SlideRoute,
    PIPELINE_VERSION,
)
from backend.services.parser import repos

logger = logging.getLogger(__name__)

_TEXT_SEM = asyncio.Semaphore(2)
_VISION_SEM = asyncio.Semaphore(3)

_TEXT_BATCH_SIZE = 12

# ── Prompts ───────────────────────────────────────────────────────────────────

_TEXT_SYSTEM = """\
You are an expert academic content summariser producing structured study material.
You will receive a batch of lecture slides with their extracted text.
Each slide also has context about the lecture it belongs to.

For EACH slide, output a JSON object with this shape:
{
  "page_index": <int>,
  "title": "<concise slide title, max 10 words>",
  "markdown": "<rich markdown summary of the slide content, 2-6 sentences, preserve key terms>",
  "summary": "<1 sentence plain-English summary>",
  "questions": [
    {
      "question": "<question text>",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "answer": "<A|B|C|D>",
      "explanation": "<1 sentence explaining the correct answer>",
      "concept": "<key concept this tests>",
      "cognitive_level": "<recall|apply|analyze|evaluate>",
      "linked_slides": []
    }
  ],
  "is_metadata": false
}

Output ONLY a JSON array of these objects, one per slide — no markdown fences.
Aim for 2 quiz questions per content slide, 0 for title/metadata slides.
"""

_TEXT_USER_TEMPLATE = """\
Lecture: {course_topic}
Section: {section_title} — {section_summary}

Glossary terms relevant to this batch:
{glossary_snippet}

Slides to analyse:
{slides_text}
"""

_VISION_SYSTEM = """\
You are an expert academic content analyst processing a lecture slide image.
The slide may contain diagrams, charts, formulas, photos, or mixed content.

Output ONLY a single JSON object (no markdown fences):
{
  "page_index": <int>,
  "title": "<concise slide title, max 10 words>",
  "markdown": "<rich description of the slide in Markdown. For diagrams: describe as labelled flow (e.g. 'Input → Hidden Layer (ReLU) → Output'). For tables: reproduce as Markdown table. For formulas: use LaTeX in $...$. For photos: one sentence on the educational point illustrated.>",
  "summary": "<1 sentence plain-English summary>",
  "questions": [
    {
      "question": "<question>",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "answer": "<A|B|C|D>",
      "explanation": "<1 sentence>",
      "concept": "<concept>",
      "cognitive_level": "<recall|apply|analyze|evaluate>",
      "linked_slides": []
    }
  ],
  "is_metadata": false
}

Aim for 1-2 quiz questions. If the slide is purely decorative, set is_metadata=true and omit questions.
"""


# ── Text batch path ───────────────────────────────────────────────────────────


def _section_for_page(outline: DeckOutline, page_index: int) -> OutlineSection:
    for section in outline.sections:
        if page_index in section.page_indices:
            return section
    # Fallback: return first section or a dummy
    return outline.sections[0] if outline.sections else OutlineSection(
        title="Main Content", page_indices=[], summary=""
    )


def _glossary_snippet(outline: DeckOutline, n: int = 8) -> str:
    items = list(outline.glossary.items())[:n]
    return "\n".join(f"  {k}: {v}" for k, v in items) or "  (none)"


def _format_slides_text(batch: list[ExtractedPage]) -> str:
    parts = []
    for p in batch:
        parts.append(f"--- Slide {p.page_index + 1} (P{p.page_index}) ---\n{p.text or '(no text extracted)'}")
    return "\n\n".join(parts)


async def _analyze_text_batch(
    batch: list[ExtractedPage],
    outline: DeckOutline,
    run_id: UUID,
) -> list[SlideContent]:
    async with _TEXT_SEM:
        section = _section_for_page(outline, batch[0].page_index)
        user_content = _TEXT_USER_TEMPLATE.format(
            course_topic=outline.course_topic,
            section_title=section.title,
            section_summary=section.summary,
            glossary_snippet=_glossary_snippet(outline),
            slides_text=_format_slides_text(batch),
        )

        client = AsyncOpenAI(api_key="v3-stage-text", base_url=settings.litellm_base_url)
        t0 = time.monotonic()
        model_used = "stage-text"
        tokens_in = tokens_out = 0

        try:
            resp = await client.chat.completions.create(
                model="stage-text",
                messages=[
                    {"role": "system", "content": _TEXT_SYSTEM},
                    {"role": "user", "content": user_content},
                ],
                temperature=0.2,
                response_format={"type": "json_object"},
            )
            raw = resp.choices[0].message.content or "[]"
            usage = resp.usage
            if usage:
                tokens_in = usage.prompt_tokens
                tokens_out = usage.completion_tokens
            if resp.model:
                model_used = resp.model
            data = json.loads(raw)
            if isinstance(data, dict):
                # Some models return {"slides": [...]} or similar
                data = data.get("slides", list(data.values())[0] if data else [])
        except Exception as e:
            logger.warning("Text batch LLM failed for run %s: %s", run_id, e)
            data = []

        elapsed_ms = int((time.monotonic() - t0) * 1000)
        results_by_idx = {int(r["page_index"]): r for r in data if isinstance(r, dict) and "page_index" in r}

        outputs: list[SlideContent] = []
        for page in batch:
            raw_result = results_by_idx.get(page.page_index)
            if raw_result:
                content = _parse_slide_content(raw_result, page, model_used, tokens_in, tokens_out, elapsed_ms, vision_used=False)
            else:
                content = _fallback_content(page, model_used)
            outputs.append(content)
        return outputs


# ── Vision path ───────────────────────────────────────────────────────────────


async def _fetch_jpeg(image_url: str) -> Optional[bytes]:
    """Fetch JPEG bytes from Supabase Storage via signed URL."""
    try:
        sb = get_client(use_admin=True)
        signed = sb.storage.from_("pdf-pages").create_signed_url(image_url, 3600)
        url = signed.get("signedURL") or signed.get("signedUrl", "")
        if not url:
            return None
        import httpx
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.get(url)
            r.raise_for_status()
            return r.content
    except Exception as e:
        logger.warning("Failed to fetch JPEG for %s: %s", image_url, e)
        return None


async def _analyze_vision_slide(
    page: ExtractedPage,
    outline: DeckOutline,
    run_id: UUID,
) -> SlideContent:
    async with _VISION_SEM:
        hint = json.dumps({
            "table_count": page.table_count,
            "drawing_count": int(page.has_vector_drawings),
            "image_count": page.image_count,
            "page_index": page.page_index,
        })
        section = _section_for_page(outline, page.page_index)

        messages: list[dict] = [{"role": "system", "content": _VISION_SYSTEM}]

        user_parts: list[dict] = [
            {"type": "text", "text": (
                f"Lecture: {outline.course_topic}\n"
                f"Section: {section.title}\n"
                f"Page: {page.page_index + 1} (P{page.page_index})\n"
                f"Structural hint: {hint}\n"
                f"Extracted text (may be incomplete for image-dominant slides):\n{page.text or '(none)'}"
            )},
        ]

        jpeg_bytes: Optional[bytes] = None
        if page.image_url:
            jpeg_bytes = await _fetch_jpeg(page.image_url)

        if jpeg_bytes:
            import base64
            b64 = base64.b64encode(jpeg_bytes).decode()
            user_parts.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"},
            })
            del jpeg_bytes

        messages.append({"role": "user", "content": user_parts})

        client = AsyncOpenAI(api_key="v3-stage-vision", base_url=settings.litellm_base_url)
        t0 = time.monotonic()
        model_used = "stage-vision"
        tokens_in = tokens_out = 0

        try:
            resp = await client.chat.completions.create(
                model="stage-vision",
                messages=messages,
                temperature=0.2,
                response_format={"type": "json_object"},
            )
            raw = resp.choices[0].message.content or "{}"
            if resp.usage:
                tokens_in = resp.usage.prompt_tokens
                tokens_out = resp.usage.completion_tokens
            if resp.model:
                model_used = resp.model
            data = json.loads(raw)
        except Exception as e:
            logger.warning("Vision LLM failed for run %s page %d: %s", run_id, page.page_index, e)
            data = {}

        elapsed_ms = int((time.monotonic() - t0) * 1000)
        return _parse_slide_content(data, page, model_used, tokens_in, tokens_out, elapsed_ms, vision_used=True)


# ── Static renders (no LLM) ───────────────────────────────────────────────────


def _render_static_slide(page: ExtractedPage) -> SlideContent:
    """Title and metadata slides get a lightweight deterministic result."""
    title = page.text.strip().split("\n")[0][:80] if page.text.strip() else "Slide"
    is_meta = page.route == SlideRoute.METADATA
    return SlideContent(
        page_index=page.page_index,
        title=title,
        markdown=page.text.strip(),
        summary=title,
        questions=[],
        is_metadata=is_meta,
        route=page.route,
        meta=SlideMeta(
            pipeline_version=PIPELINE_VERSION,
            word_count=page.word_count,
            vision_used=False,
            tokens_input=0,
            tokens_output=0,
            model="static",
            latency_ms=0,
        ),
    )


# ── Public API ────────────────────────────────────────────────────────────────


async def generate(
    extracted: list[ExtractedPage],
    outline: DeckOutline,
    run_id: UUID,
    lecture_id: UUID,
    *,
    emit,
) -> list[SlideContent]:
    """Stage 3 entry point.

    Processes all pages concurrently (text in batches, vision individually),
    commits results to parse_pages, and emits SSE slide_ready events.
    """
    # Separate by route
    text_pages = [p for p in extracted if p.route in (SlideRoute.TEXT,)]
    vision_pages = [p for p in extracted if p.route in (SlideRoute.VISION, SlideRoute.MIXED)]
    static_pages = [p for p in extracted if p.route in (SlideRoute.TITLE, SlideRoute.METADATA)]

    all_results: dict[int, SlideContent] = {}

    # ── Text batches ──────────────────────────────────────────────────────────
    def _chunks(lst, n):
        for i in range(0, len(lst), n):
            yield lst[i : i + n]

    text_tasks = [
        _analyze_text_batch(batch, outline, run_id)
        for batch in _chunks(text_pages, _TEXT_BATCH_SIZE)
    ]
    text_batches = await asyncio.gather(*text_tasks)
    for batch_results in text_batches:
        for content in batch_results:
            all_results[content.page_index] = content

    # ── Vision (concurrent, bounded by semaphore) ─────────────────────────────
    vision_tasks = [_analyze_vision_slide(p, outline, run_id) for p in vision_pages]
    vision_results = await asyncio.gather(*vision_tasks)
    for content in vision_results:
        all_results[content.page_index] = content

    # ── Static ────────────────────────────────────────────────────────────────
    for page in static_pages:
        all_results[page.page_index] = _render_static_slide(page)

    # ── Persist + emit in page order ──────────────────────────────────────────
    ordered = [all_results[p.page_index] for p in sorted(extracted, key=lambda x: x.page_index)]
    for content in ordered:
        await repos.commit_content(run_id, content)
        await emit("slide_ready", content.model_dump())

    # Write quiz questions to the shared quiz_questions table
    await _write_quiz_questions(ordered, lecture_id)

    return ordered


# ── Helpers ───────────────────────────────────────────────────────────────────


def _parse_slide_content(
    data: dict,
    page: ExtractedPage,
    model: str,
    tokens_in: int,
    tokens_out: int,
    latency_ms: int,
    *,
    vision_used: bool,
) -> SlideContent:
    try:
        questions = [
            QuizQuestion(
                question=q["question"],
                options=q["options"][:4] if len(q.get("options", [])) >= 4 else (q.get("options", []) + ["A", "B", "C", "D"])[:4],
                answer=q.get("answer", "A"),
                explanation=q.get("explanation", ""),
                concept=q.get("concept", ""),
                cognitive_level=q.get("cognitive_level", "recall"),
                linked_slides=q.get("linked_slides", []),
            )
            for q in data.get("questions", [])
            if isinstance(q, dict) and "question" in q
        ]
    except Exception:
        questions = []

    return SlideContent(
        page_index=page.page_index,
        title=(data.get("title") or page.text.split("\n")[0][:80]).strip() or f"Slide {page.page_index + 1}",
        markdown=data.get("markdown") or page.text or "",
        summary=data.get("summary") or "",
        questions=questions,
        is_metadata=bool(data.get("is_metadata", False)),
        route=page.route,
        meta=SlideMeta(
            pipeline_version=PIPELINE_VERSION,
            word_count=page.word_count,
            vision_used=vision_used,
            tokens_input=tokens_in,
            tokens_output=tokens_out,
            model=model,
            latency_ms=latency_ms,
        ),
    )


def _fallback_content(page: ExtractedPage, model: str) -> SlideContent:
    return SlideContent(
        page_index=page.page_index,
        title=page.text.split("\n")[0][:80].strip() or f"Slide {page.page_index + 1}",
        markdown=page.text or "",
        summary="",
        questions=[],
        is_metadata=False,
        route=page.route,
        parse_error="LLM call failed; raw text shown",
        meta=SlideMeta(
            pipeline_version=PIPELINE_VERSION,
            word_count=page.word_count,
            vision_used=False,
            tokens_input=0,
            tokens_output=0,
            model=model,
            latency_ms=0,
        ),
    )


async def _write_quiz_questions(slides: list[SlideContent], lecture_id: UUID) -> None:
    """Write per-slide quiz items to the shared quiz_questions table."""
    from backend.core.database import get_client
    sb = get_client(use_admin=True)

    rows = []
    for slide in slides:
        for q in slide.questions:
            rows.append({
                "lecture_id": str(lecture_id),
                "question": q.question,
                "options": q.options,
                "answer": q.answer,
                "explanation": q.explanation,
                "type": "mcq",
                "difficulty": q.cognitive_level,
                "metadata": {
                    "concept": q.concept,
                    "slide_index": slide.page_index,
                    "pipeline_version": PIPELINE_VERSION,
                    "cognitive_level": q.cognitive_level,
                    "linked_slides": q.linked_slides,
                },
            })

    if not rows:
        return

    try:
        # Insert in batches of 50
        for i in range(0, len(rows), 50):
            sb.table("quiz_questions").insert(rows[i : i + 50]).execute()
    except Exception as e:
        logger.warning("Failed to write quiz questions for lecture %s: %s", lecture_id, e)
