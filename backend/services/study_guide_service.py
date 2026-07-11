"""Study guide generation (Roadmap Phase 4.4): a cached, regeneratable
per-course study guide aggregating lecture synopses, merged key concepts
(reusing the Phase-3 concept graph, deduped course-wide) with one-line
definitions, and course_context facts (instructor/exam dates/grading).

Aggregation-first: lecture synopses and concept names come straight from
already-persisted data (no LLM call). Only the concept definitions need an
LLM, and that's a single best-effort call — a failure there means the guide
ships without definitions, not that generation fails outright.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

from backend.core.database import get_db_connection
from backend.services.ai.orchestrator import generate_text, parse_json_response
from backend.services.course_context_service import get_course_context

logger = logging.getLogger(__name__)

MAX_CONCEPTS = 30


async def _fetch_lecture_synopses(conn, course_id: UUID) -> List[Dict[str, Any]]:
    rows = await conn.fetch(
        "SELECT id, title, description FROM lectures "
        "WHERE course_id = $1 AND is_archived = false ORDER BY created_at",
        course_id,
    )
    return [
        {"lecture_id": str(r["id"]), "title": r["title"], "synopsis": r["description"] or ""}
        for r in rows
    ]


async def _fetch_merged_concepts(conn, course_id: UUID) -> List[str]:
    rows = await conn.fetch(
        """
        SELECT DISTINCT c.canonical_name
        FROM concept_lectures cl
        JOIN concepts c ON c.id = cl.concept_id
        JOIN lectures l ON l.id = cl.lecture_id
        WHERE l.course_id = $1
        ORDER BY c.canonical_name
        LIMIT $2
        """,
        course_id, MAX_CONCEPTS,
    )
    return [r["canonical_name"] for r in rows]


async def _define_concepts(concepts: List[str], ai_model: str) -> Dict[str, str]:
    """One combined LLM call for one-line definitions. Best-effort — see
    module docstring."""
    if not concepts:
        return {}
    prompt = f"""For each concept below, write ONE concise one-sentence definition suitable for a student study guide. Return ONLY a valid JSON object mapping each concept name to its definition string, no markdown.

Concepts:
{chr(10).join(f"- {c}" for c in concepts)}"""
    try:
        raw = await generate_text(prompt, ai_model=ai_model)
        res = parse_json_response(raw)
        if isinstance(res, dict):
            return {k: v for k, v in res.items() if isinstance(k, str) and isinstance(v, str)}
    except Exception as exc:
        logger.warning("concept definitions failed (non-fatal): %s", exc)
    return {}


async def get_or_generate_study_guide(
    course_id: UUID,
    *,
    force_regenerate: bool = False,
    ai_model: str = "cerebras",
) -> Dict[str, Any]:
    """Return the course's study guide, generating (and caching) it on the
    first call or when the lecture count has changed since it was last
    generated. Idempotent: an unchanged lecture set returns the cached
    content — no re-running the LLM call, no duplicated sections.
    """
    async with await get_db_connection() as conn:
        synopses = await _fetch_lecture_synopses(conn, course_id)
        lecture_count = len(synopses)

        if not force_regenerate:
            cached = await conn.fetchrow(
                "SELECT content, source_lecture_count FROM study_guides WHERE course_id = $1",
                course_id,
            )
            if cached and cached["source_lecture_count"] == lecture_count:
                content = cached["content"]
                return json.loads(content) if isinstance(content, str) else content

        concepts = await _fetch_merged_concepts(conn, course_id)
        definitions = await _define_concepts(concepts, ai_model)
        course_context = await get_course_context(course_id)

        content: Dict[str, Any] = {
            "lectures": synopses,
            "concepts": [{"name": c, "definition": definitions.get(c, "")} for c in concepts],
            "course_facts": {
                "instructor": course_context.get("instructor") if course_context else None,
                "exam_dates": course_context.get("exam_dates") if course_context else [],
                "grading_scheme": course_context.get("grading_scheme") if course_context else None,
            },
        }

        await conn.execute(
            """
            INSERT INTO study_guides (course_id, content, source_lecture_count, generated_at)
            VALUES ($1, $2::jsonb, $3, now())
            ON CONFLICT (course_id) DO UPDATE SET
                content = EXCLUDED.content,
                source_lecture_count = EXCLUDED.source_lecture_count,
                generated_at = now()
            """,
            course_id, json.dumps(content), lecture_count,
        )
        return content
