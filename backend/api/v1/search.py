"""Global semantic search + course-wide tutor API (Roadmap Phase 2.2,
"Ask anything").

Endpoints:
    GET  /api/v1/search?q=...          — ⌘K palette: lectures/slides/concepts/worksheets
    POST /api/v1/search/ask            — course-wide grounded tutor

Both endpoints are scoped server-side to the caller's own courses
(professor-owned or student-enrolled) — never to unenrolled/unpublished
content. See `search_service.py` for the scoping logic and
`ai/tutor.chat_with_course` for the grounding/refusal logic.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from backend.api.v1.courses import _is_professor
from backend.core.auth_middleware import _user_id, verify_token
from backend.core.database import supabase_admin
from backend.core.rate_limit import limiter
from backend.repositories.event_repo import insert_event
from backend.services import search_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/search", tags=["search"])

MAX_QUERY_CHARS = 300


class AskRequest(BaseModel):
    course_id: str
    question: str = Field(..., max_length=2_000)
    history: Optional[List[Dict[str, str]]] = None
    allow_ungrounded: bool = False
    ai_model: str = "llama3"


@router.get("")
@limiter.limit("20/minute")
async def search(
    request: Request,
    q: str = Query(..., min_length=1, max_length=MAX_QUERY_CHARS),
    user: Any = Depends(verify_token),
) -> Dict[str, List[Dict[str, Any]]]:
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    is_prof = await run_in_threadpool(_is_professor, user)
    results = await search_service.global_search(uid, is_prof, q)

    try:
        await insert_event(supabase_admin, uid, "search_performed", {
            "query": q[:MAX_QUERY_CHARS],
            "result_counts": {k: len(v) for k, v in results.items()},
        })
    except Exception as e:
        logger.warning("Failed to log search_performed event: %s", e)

    return results


@router.post("/ask")
@limiter.limit("20/minute")
async def ask_course_tutor(
    request: Request,
    body: AskRequest,
    user: Any = Depends(verify_token),
) -> Dict[str, Any]:
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    is_prof = await run_in_threadpool(_is_professor, user)

    try:
        result = await search_service.ask_course(
            uid,
            is_prof,
            body.course_id,
            body.question,
            chat_history=body.history,
            ai_model=body.ai_model,
            allow_ungrounded=body.allow_ungrounded,
        )
    except PermissionError:
        raise HTTPException(status_code=403, detail="Not enrolled in this course.")
    except Exception as e:
        logger.error("Course tutor ask failed: %s", e)
        raise HTTPException(status_code=500, detail="The course tutor failed to respond.")

    return result
