"""Global semantic search + course-wide tutor ("Ask anything").

Two entry points, both scoped to the caller's own courses (professor's
own, student's enrolled — via direct or assignment enrollment, same
union `courses.py._student_visible_course_ids` uses):

- `global_search`: keyword hits for lectures/concepts/worksheets, plus a
  vector+keyword RRF-fused slide search — feeds the ⌘K command palette.
- `ask_course`: the course-wide grounded tutor. Retrieval + refusal logic
  live in `ai.retrieval` / `ai.tutor`; this module only enforces that the
  caller may actually see the requested course before either runs.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi.concurrency import run_in_threadpool

from backend.api.v1.courses import _student_visible_course_ids
from backend.core.database import supabase_admin
from backend.services.ai.retrieval import (
    DEFAULT_THRESHOLD,
    DEFAULT_COURSE_K,
    retrieve_relevant_slides_course_scoped,
)
from backend.services.ai.tutor import chat_with_course

logger = logging.getLogger(__name__)

# Search (not tutor) results can surface loosely-relevant slides — the
# refusal gate only applies to the Ask flow, not the palette list.
SEARCH_SLIDE_THRESHOLD = 0.3


async def _resolve_scope_course_ids(user_id: str, is_professor: bool) -> List[str]:
    """Course ids the caller may search/ask within.

    Professor -> courses they own. Student -> same union
    `courses.py._student_visible_course_ids` uses for lecture visibility
    (direct `course_enrollments` + assignment-derived enrollment) — reused
    directly rather than re-derived, so the two never drift.
    """
    if is_professor:
        res = (
            supabase_admin.table("courses")
            .select("id")
            .eq("professor_id", user_id)
            .eq("is_archived", False)
            .execute()
        )
        return [r["id"] for r in (res.data or []) if r.get("id")]

    visible = await run_in_threadpool(_student_visible_course_ids, user_id)
    return list(visible)


async def _keyword_rpc(
    rpc_name: str, query: str, course_ids: List[str], limit: int
) -> List[Dict[str, Any]]:
    try:
        res = supabase_admin.rpc(rpc_name, {
            "search_query": query,
            "scoped_course_ids": course_ids,
            "match_count": limit,
        }).execute()
        return res.data or []
    except Exception as e:
        logger.warning("%s failed: %s", rpc_name, e)
        return []


async def global_search(
    user_id: str, is_professor: bool, query: str, limit: int = 6
) -> Dict[str, List[Dict[str, Any]]]:
    """Fan out a query across lectures/slides/concepts/worksheets, scoped
    to the caller's own courses. Returns empty sections (not an error) for
    a blank query, no course access, or an underlying RPC failure — the
    palette should degrade to "no results", never crash the page."""
    query = (query or "").strip()
    empty: Dict[str, List[Dict[str, Any]]] = {
        "lectures": [], "slides": [], "concepts": [], "worksheets": [],
    }
    if not query:
        return empty

    course_ids = await _resolve_scope_course_ids(user_id, is_professor)
    if not course_ids:
        return empty

    lectures = await _keyword_rpc("search_lectures_keyword", query, course_ids, limit)
    concepts = await _keyword_rpc("search_concepts_keyword", query, course_ids, limit)
    worksheets = await _keyword_rpc("search_worksheets_keyword", query, course_ids, limit)
    slides = await retrieve_relevant_slides_course_scoped(
        query, course_ids=course_ids, k=limit, threshold=SEARCH_SLIDE_THRESHOLD
    )

    return {
        "lectures": lectures,
        "slides": slides,
        "concepts": concepts,
        "worksheets": worksheets,
    }


async def ask_course(
    user_id: str,
    is_professor: bool,
    course_id: str,
    question: str,
    *,
    chat_history: Optional[List[Dict[str, str]]] = None,
    ai_model: str = "llama3",
    allow_ungrounded: bool = False,
) -> Dict[str, Any]:
    """Course-wide grounded tutor. Raises `PermissionError` if the caller
    doesn't have access to `course_id` — the router maps this to a 403."""
    course_ids = await _resolve_scope_course_ids(user_id, is_professor)
    if course_id not in course_ids:
        raise PermissionError("Not enrolled in this course.")

    retrieved = await retrieve_relevant_slides_course_scoped(
        question, course_ids=[course_id], k=DEFAULT_COURSE_K, threshold=DEFAULT_THRESHOLD
    )
    return await chat_with_course(
        question,
        retrieved,
        chat_history=chat_history,
        ai_model=ai_model,
        threshold=DEFAULT_THRESHOLD,
        allow_ungrounded=allow_ungrounded,
    )
