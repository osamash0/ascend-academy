"""Server-authoritative persistence for the unified parse pipeline.

Unlike v4 (which delegated all persistence to the frontend), the unified
orchestrator writes the parse output to the real domain tables — `lectures`,
`slides`, `quiz_questions` — making the database the single source of truth.
This is the prerequisite for the queryable three-level context (slide /
lecture / course) the product is built around.

All writes go through the shared asyncpg pool. Every JSONB column is passed as
an explicit ``json.dumps(...)::jsonb`` to avoid relying on an asyncpg type
codec. Quiz answer indices are resolved with the shared validator and
DROPPED — never silently defaulted — when they can't be matched to an option
(see Phase 0 / quiz_validator).
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from backend.core.database import get_db_connection
from backend.services.ai.quiz_validator import _normalize_answer_index, coerce_linked_slides

logger = logging.getLogger(__name__)


# ── low-level helpers (mirror fast_upload.execute_query convention) ──────────

async def _fetchval(query: str, *args):
    async with await get_db_connection() as conn:
        return await conn.fetchval(query, *args)


async def _fetch(query: str, *args):
    async with await get_db_connection() as conn:
        return await conn.fetch(query, *args)


async def _execute(query: str, *args):
    async with await get_db_connection() as conn:
        return await conn.execute(query, *args)


# ── lecture ──────────────────────────────────────────────────────────────────

async def create_lecture(
    *,
    title: str,
    professor_id: UUID,
    pdf_hash: str,
    pdf_url: Optional[str] = None,
) -> UUID:
    """Create the lecture row up front and return its id.

    `professor_id` is NOT NULL in the schema — the caller must supply the
    authenticated uploader's user id.
    """
    if professor_id is None:
        raise ValueError("create_lecture requires a professor_id (lectures.professor_id is NOT NULL)")
    lecture_id = uuid4()
    await _execute(
        """
        INSERT INTO lectures (id, title, description, professor_id, total_slides, pdf_url, pdf_hash)
        VALUES ($1, $2, '', $3, 0, $4, $5)
        """,
        lecture_id,
        title,
        professor_id,
        pdf_url,  # NULL initially; set to the lecture-pdfs path after upload
        pdf_hash,
    )
    return lecture_id


async def set_lecture_pdf_url(lecture_id: UUID, pdf_url: str) -> None:
    """Set the lecture's source-PDF storage path (resolved by the viewer)."""
    await _execute("UPDATE lectures SET pdf_url = $1 WHERE id = $2", pdf_url, lecture_id)


async def set_lecture_title(lecture_id: UUID, title: str) -> None:
    """Update the lecture title (used when reusing a lecture on re-parse)."""
    await _execute("UPDATE lectures SET title = $1 WHERE id = $2", title, lecture_id)


async def finalize_lecture(lecture_id: UUID, description: str, total_slides: int) -> None:
    await _execute(
        "UPDATE lectures SET description = $1, total_slides = $2 WHERE id = $3",
        description or "",
        int(total_slides),
        lecture_id,
    )


async def set_run_lecture(run_id: UUID, lecture_id: UUID) -> None:
    """Link a parse_runs row to the lecture created during the run."""
    await _execute(
        "UPDATE parse_runs SET lecture_id = $1 WHERE run_id = $2",
        lecture_id,
        run_id,
    )


async def clear_lecture_content(lecture_id: UUID) -> None:
    """Delete a lecture's slides so a re-parse replaces content instead of
    duplicating it. quiz_questions rows cascade via the slides FK
    (ON DELETE CASCADE), so they're removed too.
    """
    await _execute("DELETE FROM slides WHERE lecture_id = $1", lecture_id)


# ── slides ─────────────────────────────────────────────────────────────────

async def insert_slide(
    lecture_id: UUID,
    slide_index: int,
    slide: Dict[str, Any],
    *,
    ai_enhanced: bool = True,
    parser_engine: str = "unified",
) -> UUID:
    """Insert one slide row (mapping the SSE slide dict → slides columns).

    ``ai_enhanced=False`` + ``parser_engine='heuristic-v1'`` marks a slide that
    skipped LLM synthesis (parsing_mode='on_demand'); the editor can later
    enhance it via the enhance-slide endpoint.
    """
    slide_id = uuid4()
    await _execute(
        """
        INSERT INTO slides
          (id, lecture_id, slide_number, title, content_text, summary,
           slide_type, context_note, image_url, ai_enhanced, parser_engine)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        """,
        slide_id,
        lecture_id,
        slide_index + 1,  # slide_number is 1-based; SSE index is 0-based
        slide.get("title") or f"Slide {slide_index + 1}",
        slide.get("content", "") or "",
        slide.get("summary", "") or "",
        slide.get("slide_type"),
        slide.get("context_note"),
        slide.get("image_url"),
        ai_enhanced,
        parser_engine,
    )
    return slide_id


def _quiz_metadata(q: Dict[str, Any], extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    meta: Dict[str, Any] = {}
    for key in ("explanation", "concept", "cognitive_level", "difficulty"):
        val = q.get(key)
        if val:
            meta[key] = val
    if extra:
        meta.update(extra)
    return meta


async def insert_slide_quizzes(slide_id: UUID, questions: List[Dict[str, Any]]) -> int:
    """Insert a slide's per-slide quiz questions. Returns the count inserted.

    Questions whose correct answer can't be resolved to an option index are
    dropped (and logged) — never silently defaulted to A.
    """
    inserted = 0
    for q in questions or []:
        if not isinstance(q, dict):
            continue
        idx = _normalize_answer_index(q)
        if idx is None:
            logger.warning(
                "unified persist: dropping slide quiz with unresolvable answer=%r",
                q.get("correctAnswer", q.get("answer")),
            )
            continue
        await _execute(
            """
            INSERT INTO quiz_questions (slide_id, question_text, options, correct_answer, metadata)
            VALUES ($1, $2, $3::jsonb, $4, $5::jsonb)
            """,
            slide_id,
            q.get("question", "") or "",
            json.dumps(q.get("options", [])),
            idx,
            json.dumps(_quiz_metadata(q)),
        )
        inserted += 1
    return inserted


async def insert_deck_quizzes(
    lecture_id: UUID,
    slide_db_ids: Dict[int, UUID],
    deck_quiz: List[Dict[str, Any]],
) -> int:
    """Insert cross-slide ("deck") quiz questions.

    quiz_questions.slide_id is NOT NULL, so each deck question is anchored to
    its first linked slide (falling back to the lecture's first slide). The
    full linked_slides list is preserved in metadata so the cross-slide nature
    survives.
    """
    if not slide_db_ids:
        return 0
    fallback_slide_id = slide_db_ids[min(slide_db_ids)]
    inserted = 0
    for q in deck_quiz or []:
        if not isinstance(q, dict):
            continue
        idx = _normalize_answer_index(q)
        if idx is None:
            logger.warning(
                "unified persist: dropping deck quiz with unresolvable answer=%r",
                q.get("correctAnswer", q.get("answer")),
            )
            continue
        linked = coerce_linked_slides(q.get("linked_slides"))
        anchor = next((slide_db_ids[i] for i in linked if i in slide_db_ids), fallback_slide_id)
        await _execute(
            """
            INSERT INTO quiz_questions (slide_id, question_text, options, correct_answer, metadata)
            VALUES ($1, $2, $3::jsonb, $4, $5::jsonb)
            """,
            anchor,
            q.get("question", "") or "",
            json.dumps(q.get("options", [])),
            idx,
            json.dumps(_quiz_metadata(q, {"linked_slides": linked, "is_deck": True})),
        )
        inserted += 1
    return inserted


# ── replay (idempotency safety for an already-COMPLETED run) ─────────────────

async def fetch_lecture_for_replay(lecture_id: UUID) -> Dict[str, Any]:
    """Reconstruct the SSE slide list + deck summary from persisted rows.

    Used when a re-enqueued run is already COMPLETED, so we replay from the DB
    instead of creating a duplicate lecture.
    """
    rows = await _fetch(
        """
        SELECT s.slide_number, s.title, s.content_text, s.summary, s.slide_type,
               q.question_text, q.options, q.correct_answer, q.metadata
        FROM slides s
        LEFT JOIN quiz_questions q ON q.slide_id = s.id
        WHERE s.lecture_id = $1
        ORDER BY s.slide_number, q.id
        """,
        lecture_id,
    )
    slides_by_num: Dict[int, Dict[str, Any]] = {}
    for r in rows:
        num = r["slide_number"]
        slide = slides_by_num.get(num)
        if slide is None:
            slide = {
                "index": num - 1,
                "slide_index": num - 1,
                "title": r["title"],
                "content": r["content_text"] or "",
                "summary": r["summary"] or "",
                "slide_type": r["slide_type"] or "text",
                "questions": [],
            }
            slides_by_num[num] = slide
        if r["question_text"] is not None:
            opts = r["options"]
            if isinstance(opts, str):
                try:
                    opts = json.loads(opts)
                except Exception:
                    opts = []
            slide["questions"].append({
                "question": r["question_text"],
                "options": opts or [],
                "correctAnswer": r["correct_answer"],
            })
    slides = [slides_by_num[n] for n in sorted(slides_by_num)]
    description = await _fetchval("SELECT description FROM lectures WHERE id = $1", lecture_id)
    return {"slides": slides, "deck_summary": description or ""}
