"""Stage 2 — Document-level synthesis.

One LLM call on a compact projection of the deck (page index + first 50 chars
of text per page). Returns a DeckOutline that every Stage 3 per-slide prompt
will receive as context.

This is the stage most pipelines skip and where most of the quality comes from.
Without it, per-slide generation has no idea what course it's summarising.
"""
from __future__ import annotations

import json
import logging
import time
from uuid import UUID

from openai import AsyncOpenAI

from backend.core.config import settings
from backend.domain.parse_models import DeckOutline, ExtractedPage, OutlineSection
from backend.services.parser import repos

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
You are an expert academic curriculum analyst.
Given a compact index of slides from a lecture PDF, produce a structured outline.

Output ONLY valid JSON matching this schema (no markdown fences):
{
  "course_topic": "<short course / lecture title, e.g. 'Introduction to Databases'>",
  "sections": [
    {
      "title": "<section title>",
      "page_indices": [<0-based page indices belonging to this section>],
      "summary": "<1–2 sentence summary of what this section covers>"
    }
  ],
  "glossary": {
    "<term>": "<one-line definition>"
  }
}

Rules:
- Group consecutive pages into logical sections (aim for 3–8 sections).
- Admin pages (timetable, exam dates, textbook refs) form their own section titled "Course Info".
- Decorative / blank pages can be included in their nearest logical section.
- Glossary should contain 5–15 key technical terms introduced in this deck.
- page_indices are 0-based integers.
"""


def _build_input(extracted: list[ExtractedPage]) -> str:
    lines = []
    for p in extracted:
        preview = p.text[:60].replace("\n", " ").strip() if p.text else "(no text)"
        lines.append(f"P{p.page_index} | {preview}")
    return "\n".join(lines)


async def synthesize(
    extracted: list[ExtractedPage],
    run_id: UUID,
    *,
    emit,
) -> DeckOutline:
    """Call the outline LLM and persist the result in parse_runs.outline.

    If the run already has an outline (resume path), returns it immediately
    without a new LLM call.

    Args:
        extracted: All ExtractedPage objects from Stage 1.
        run_id: The current parse run UUID.
        emit: Async callable (event_type, data) → None for SSE.
    """
    # Resume: skip if already computed
    run = await repos.get_run_by_id(run_id)
    if run and run.outline:
        logger.info("Run %s: outline already present, skipping synthesis", run_id)
        await emit("outline_ready", run.outline.model_dump())
        return run.outline

    client = AsyncOpenAI(
        api_key=settings.litellm_client_key,
        base_url=settings.litellm_base_url,
    )

    user_content = _build_input(extracted)
    t0 = time.monotonic()

    try:
        resp = await client.chat.completions.create(
            model="stage-outline",
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
        outline = _parse_outline(data, extracted)
    except Exception as e:
        logger.warning("Outline LLM call failed (%s); using fallback outline", e)
        outline = _fallback_outline(extracted)

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    logger.info("Run %s: outline generated in %dms, %d sections", run_id, elapsed_ms, len(outline.sections))

    await repos.set_outline(run_id, outline)
    await emit("outline_ready", outline.model_dump())
    return outline


# ── Helpers ───────────────────────────────────────────────────────────────────


def _parse_outline(data: dict, extracted: list[ExtractedPage]) -> DeckOutline:
    """Parse LLM JSON response into a DeckOutline; fall back gracefully."""
    try:
        sections = [
            OutlineSection(
                title=s.get("title", "Section"),
                page_indices=[int(i) for i in s.get("page_indices", [])],
                summary=s.get("summary", ""),
            )
            for s in data.get("sections", [])
        ]
        return DeckOutline(
            course_topic=data.get("course_topic", "Lecture"),
            sections=sections or _single_section(extracted),
            glossary=data.get("glossary", {}),
        )
    except Exception:
        return _fallback_outline(extracted)


def _single_section(extracted: list[ExtractedPage]) -> list[OutlineSection]:
    return [OutlineSection(
        title="Main Content",
        page_indices=[p.page_index for p in extracted],
        summary="",
    )]


def _fallback_outline(extracted: list[ExtractedPage]) -> DeckOutline:
    return DeckOutline(
        course_topic="Lecture",
        sections=_single_section(extracted),
        glossary={},
    )
