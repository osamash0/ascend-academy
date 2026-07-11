"""Course context: structured syllabus facts (instructor, exam dates, grading
scheme) extracted from administrative slides, Roadmap Phase 3 "course brain".

A course has no `course_context` row until the first admin-slide extraction
runs (or a professor fills it in manually via the editor card) — callers
should treat a missing row as "no facts yet", not an error.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

from backend.core.database import get_db_connection

logger = logging.getLogger(__name__)


async def get_course_synthesis_context(
    course_id: UUID,
    *,
    exclude_lecture_id: Optional[UUID] = None,
    max_lectures: int = 10,
) -> Dict[str, Any]:
    """Prior-lecture titles + each one's strongest concept + course facts, for
    threading into synthesis prompts (Roadmap Phase 3.4, "new-upload
    awareness"). Read-only; callers wrap this in try/except — a failure here
    must never block a parse.

    Returns:
        {"prior_lectures": [{"id": str, "title": str, "top_concept": str|None}, ...]
                            (most recent first, capped at max_lectures),
         "instructor": str|None, "grading_scheme": str|None}
    """
    async with await get_db_connection() as conn:
        lecture_rows = await conn.fetch(
            """
            SELECT l.id, l.title,
              (SELECT c.canonical_name FROM concept_lectures cl
               JOIN concepts c ON c.id = cl.concept_id
               WHERE cl.lecture_id = l.id
               ORDER BY cl.weight DESC LIMIT 1) AS top_concept
            FROM lectures l
            WHERE l.course_id = $1 AND ($2::uuid IS NULL OR l.id != $2)
            ORDER BY l.created_at DESC
            LIMIT $3
            """,
            course_id, exclude_lecture_id, max_lectures,
        )
        context_row = await conn.fetchrow(
            "SELECT instructor, grading_scheme FROM course_context WHERE course_id = $1",
            course_id,
        )

    return {
        "prior_lectures": [
            {"id": str(r["id"]), "title": r["title"], "top_concept": r["top_concept"]}
            for r in lecture_rows
        ],
        "instructor": context_row["instructor"] if context_row else None,
        "grading_scheme": context_row["grading_scheme"] if context_row else None,
    }


def build_course_context_hint(ctx: Dict[str, Any]) -> str:
    """Format `get_course_synthesis_context`'s result into a short prompt
    block. Returns "" when there's nothing to say (no prior lectures, no
    facts) — callers rely on this to skip touching the prompt at all."""
    lines: List[str] = []
    prior = ctx.get("prior_lectures") or []
    titles = [p["title"] for p in prior if p.get("title")]
    if titles:
        lines.append("Earlier lectures in this course: " + "; ".join(titles))
    seen: set = set()
    concepts: List[str] = []
    for p in prior:
        c = p.get("top_concept")
        if c and c not in seen:
            concepts.append(c)
            seen.add(c)
    if concepts:
        lines.append("Concepts already covered: " + ", ".join(concepts))
    if ctx.get("instructor"):
        lines.append(f"Instructor: {ctx['instructor']}")
    return "\n".join(lines)


def _as_json(value: Any) -> Any:
    """asyncpg may return jsonb columns as str or as already-decoded values
    depending on the connection's type codec setup — normalize either way."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return value
    return value


async def get_course_context(course_id: UUID) -> Optional[Dict[str, Any]]:
    async with await get_db_connection() as conn:
        row = await conn.fetchrow(
            "SELECT course_id, instructor, exam_dates, syllabus_facts, grading_scheme, updated_at "
            "FROM course_context WHERE course_id = $1",
            course_id,
        )
    if not row:
        return None
    return {
        "course_id": str(row["course_id"]),
        "instructor": row["instructor"],
        "exam_dates": _as_json(row["exam_dates"]) or [],
        "syllabus_facts": _as_json(row["syllabus_facts"]) or {},
        "grading_scheme": row["grading_scheme"],
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
    }


async def upsert_course_context_facts(course_id: UUID, facts: Dict[str, Any]) -> None:
    """Merge newly-extracted facts into the course's context row.

    Merge semantics — a best-effort per-slide extraction must never clobber a
    good prior value with an empty one, since this runs once per admin-slide
    batch per parse and multiple lectures in a course each contribute facts:
      - instructor / grading_scheme: only overwritten when the new value is
        non-empty (last-non-empty-write-wins across lectures).
      - exam_dates: appended to, deduped by (label, date), never replaced.
      - syllabus_facts: shallow-merged; new non-empty keys win.
    """
    instructor = (facts.get("instructor") or "").strip() or None
    grading_scheme = (facts.get("grading_scheme") or "").strip() or None
    new_exam_dates = facts.get("exam_dates") or []
    if not isinstance(new_exam_dates, list):
        new_exam_dates = []
    new_other = facts.get("other_facts") or {}
    if not isinstance(new_other, dict):
        new_other = {}

    async with await get_db_connection() as conn:
        existing = await conn.fetchrow(
            "SELECT instructor, exam_dates, syllabus_facts, grading_scheme "
            "FROM course_context WHERE course_id = $1",
            course_id,
        )
        if existing:
            merged_instructor = instructor or existing["instructor"]
            merged_grading = grading_scheme or existing["grading_scheme"]
            existing_dates = _as_json(existing["exam_dates"]) or []
            seen = {
                (d.get("label"), d.get("date")) for d in existing_dates if isinstance(d, dict)
            }
            merged_dates = list(existing_dates)
            for d in new_exam_dates:
                if isinstance(d, dict) and (d.get("label"), d.get("date")) not in seen:
                    merged_dates.append(d)
                    seen.add((d.get("label"), d.get("date")))
            existing_facts = _as_json(existing["syllabus_facts"]) or {}
            merged_facts = {**existing_facts, **{k: v for k, v in new_other.items() if v}}
        else:
            merged_instructor = instructor
            merged_grading = grading_scheme
            merged_dates = new_exam_dates
            merged_facts = new_other

        await conn.execute(
            """
            INSERT INTO course_context (course_id, instructor, exam_dates, syllabus_facts, grading_scheme, updated_at)
            VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, now())
            ON CONFLICT (course_id) DO UPDATE SET
                instructor = EXCLUDED.instructor,
                exam_dates = EXCLUDED.exam_dates,
                syllabus_facts = EXCLUDED.syllabus_facts,
                grading_scheme = EXCLUDED.grading_scheme,
                updated_at = now()
            """,
            course_id, merged_instructor, json.dumps(merged_dates), json.dumps(merged_facts), merged_grading,
        )


async def replace_course_context_fields(course_id: UUID, patch: Dict[str, Any]) -> Dict[str, Any]:
    """Professor-authored correction: a plain partial update, no merge.

    Unlike `upsert_course_context_facts` (best-effort extraction, never
    clobbers a good value with an empty one), an explicit professor edit is
    authoritative — clearing a field to empty must actually clear it. Only
    keys present in `patch` are touched; omitted keys keep their current value.
    """
    async with await get_db_connection() as conn:
        existing = await conn.fetchrow(
            "SELECT instructor, exam_dates, syllabus_facts, grading_scheme "
            "FROM course_context WHERE course_id = $1",
            course_id,
        )
        instructor = patch["instructor"] if "instructor" in patch else (existing["instructor"] if existing else None)
        grading_scheme = (
            patch["grading_scheme"] if "grading_scheme" in patch
            else (existing["grading_scheme"] if existing else None)
        )
        exam_dates = (
            patch["exam_dates"] if "exam_dates" in patch
            else (_as_json(existing["exam_dates"]) if existing else [])
        )
        syllabus_facts = (
            patch["syllabus_facts"] if "syllabus_facts" in patch
            else (_as_json(existing["syllabus_facts"]) if existing else {})
        )

        await conn.execute(
            """
            INSERT INTO course_context (course_id, instructor, exam_dates, syllabus_facts, grading_scheme, updated_at)
            VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, now())
            ON CONFLICT (course_id) DO UPDATE SET
                instructor = EXCLUDED.instructor,
                exam_dates = EXCLUDED.exam_dates,
                syllabus_facts = EXCLUDED.syllabus_facts,
                grading_scheme = EXCLUDED.grading_scheme,
                updated_at = now()
            """,
            course_id, instructor, json.dumps(exam_dates or []), json.dumps(syllabus_facts or {}), grading_scheme,
        )

    result = await get_course_context(course_id)
    assert result is not None
    return result
