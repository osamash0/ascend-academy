"""Stage 5 — Deck-level finalization.

Two LLM calls:
  1. Deck summary  — condenses all per-slide summaries (≤ 2k token input).
  2. Deck quiz     — 5 cross-slide questions tagged by concept, using the outline
                     sections as grounding context.

Then marks parse_runs.status = COMPLETED and emits the final SSE event.
"""
from __future__ import annotations

import json
import logging
import time
from uuid import UUID

from openai import AsyncOpenAI

from backend.core.config import settings
from backend.core.database import get_client
from backend.domain.parse_models import (
    DeckOutline,
    QuizQuestion,
    RunStatus,
    SlideContent,
    PIPELINE_VERSION,
)
from backend.services.parser import repos

logger = logging.getLogger(__name__)

_SUMMARY_SYSTEM = """\
You are an expert academic summariser.
Given a list of per-slide summaries from a lecture, write a single cohesive
deck-level summary in 3–5 sentences. Focus on the main themes, key concepts,
and what a student should take away.

Output ONLY the summary text — no headers, no JSON.
"""

_QUIZ_SYSTEM = """\
You are an expert academic quiz author.
Given a lecture outline and its key concepts, write exactly 5 cross-slide
multiple-choice questions that test understanding across multiple sections.

Output ONLY a JSON array of 5 objects (no markdown fences), each with:
{
  "question": "<question text>",
  "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
  "answer": "<A|B|C|D>",
  "explanation": "<1 sentence>",
  "concept": "<concept>",
  "cognitive_level": "<recall|apply|analyze|evaluate>",
  "linked_slides": [<0-based page indices this question references>]
}
"""


async def finalize(
    lecture_id: UUID,
    run_id: UUID,
    outline: DeckOutline,
    slides: list[SlideContent],
    *,
    emit,
) -> dict:
    """Stage 5 entry point.

    Generates deck-level summary + quiz, writes quiz to quiz_questions,
    marks the run COMPLETED, and emits the final SSE event.

    Returns a dict with "deck_summary" and "deck_quiz" keys.
    """
    client = AsyncOpenAI(api_key=settings.litellm_client_key, base_url=settings.litellm_base_url)

    # ── Deck summary ──────────────────────────────────────────────────────────
    summaries_text = "\n".join(
        f"- Slide {s.page_index + 1}: {s.summary}"
        for s in slides
        if not s.is_metadata and s.summary
    )
    deck_summary = ""
    try:
        t0 = time.monotonic()
        resp = await client.chat.completions.create(
            model="stage-deck",
            messages=[
                {"role": "system", "content": _SUMMARY_SYSTEM},
                {"role": "user", "content": f"Lecture: {outline.course_topic}\n\n{summaries_text}"},
            ],
            temperature=0.2,
        )
        deck_summary = resp.choices[0].message.content or ""
        logger.info("Run %s: deck summary in %dms", run_id, int((time.monotonic() - t0) * 1000))
    except Exception as e:
        logger.warning("Run %s: deck summary failed: %s", run_id, e)
        deck_summary = f"Lecture covering: {outline.course_topic}"

    # ── Deck quiz ──────────────────────────────────────────────────────────────
    outline_text = "\n".join(
        f"Section '{s.title}' (slides {s.page_indices}): {s.summary}"
        for s in outline.sections
    )
    key_concepts = ", ".join(list(outline.glossary.keys())[:10])
    deck_quiz: list[dict] = []
    try:
        resp = await client.chat.completions.create(
            model="stage-deck",
            messages=[
                {"role": "system", "content": _QUIZ_SYSTEM},
                {"role": "user", "content": (
                    f"Lecture: {outline.course_topic}\n\n"
                    f"Outline:\n{outline_text}\n\n"
                    f"Key concepts: {key_concepts}"
                )},
            ],
            temperature=0.3,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or "[]"
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            parsed = next(iter(parsed.values()), [])
        deck_quiz = parsed if isinstance(parsed, list) else []
    except Exception as e:
        logger.warning("Run %s: deck quiz failed: %s", run_id, e)

    # ── Persist deck quiz ──────────────────────────────────────────────────────
    await _write_deck_quiz(deck_quiz, lecture_id)

    # ── Mark run complete ─────────────────────────────────────────────────────
    await repos.set_status(run_id, RunStatus.COMPLETED)

    result = {"deck_summary": deck_summary, "deck_quiz": deck_quiz, "course_topic": outline.course_topic}
    await emit("deck_complete", result)
    return result


async def _write_deck_quiz(quiz_data: list[dict], lecture_id: UUID) -> None:
    if not quiz_data:
        return
    sb = get_client(use_admin=True)
    rows = []
    for q in quiz_data:
        if not isinstance(q, dict) or "question" not in q:
            continue
        rows.append({
            "lecture_id": str(lecture_id),
            "question": q.get("question", ""),
            "options": q.get("options", []),
            "answer": q.get("answer", "A"),
            "explanation": q.get("explanation", ""),
            "type": "mcq",
            "difficulty": q.get("cognitive_level", "apply"),
            "metadata": {
                "concept": q.get("concept", ""),
                "pipeline_version": PIPELINE_VERSION,
                "cognitive_level": q.get("cognitive_level", "apply"),
                "linked_slides": q.get("linked_slides", []),
                "deck_level": True,
            },
        })
    if rows:
        try:
            sb.table("quiz_questions").insert(rows).execute()
        except Exception as e:
            logger.warning("Failed to write deck quiz for %s: %s", lecture_id, e)
