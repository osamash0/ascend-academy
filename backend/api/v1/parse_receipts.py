"""Parse receipts API (Arc 5).

    GET /api/v1/lectures/{lecture_id}/parse-receipt
        The latest receipt for a lecture the caller owns: deck skeleton,
        per-slide synthesis provenance (incl. serving provider/model/cost),
        the deck-quiz grounding summary, and the run's LLM usage totals.

The read goes through the service-role client (RLS bypassed, mirroring
worksheets.py), so ownership is enforced here: the course professor or the
student owner of a private upload. A lecture the caller does not own gets
the same 404 as a missing one, so lecture ids are not enumerable. The
`parse_receipts` RLS policy is the matching defense-in-depth layer for
direct client access.

`supabase_admin` is read from `backend.core.database` at call time (not
imported by name) so the test suite's client patch applies without a
per-module patch in conftest.
"""
import logging
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from backend.core import database as _database
from backend.core.auth_middleware import _user_id, verify_token
from backend.core.rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter(tags=["parse-receipts"])

_RECEIPT_COLUMNS = (
    "run_id", "lecture_id", "deck_skeleton", "slide_provenance", "quiz_grounding",
    "llm_usage", "created_at",
)


def _owns_lecture(user_id: str, lecture_id: str) -> bool:
    rows = (
        _database.supabase_admin.table("lectures")
        .select("id, professor_id, student_owner_id")
        .eq("id", lecture_id)
        .execute()
        .data
        or []
    )
    if not rows:
        return False
    lecture = rows[0]
    return user_id in (lecture.get("professor_id"), lecture.get("student_owner_id"))


def _latest_receipt(lecture_id: str) -> Optional[dict]:
    rows = (
        _database.supabase_admin.table("parse_receipts")
        .select(", ".join(_RECEIPT_COLUMNS))
        .eq("lecture_id", lecture_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    return {col: rows[0].get(col) for col in _RECEIPT_COLUMNS} if rows else None


@router.get("/lectures/{lecture_id}/parse-receipt")
@limiter.limit("60/minute")
async def get_parse_receipt(
    request: Request,
    lecture_id: UUID,
    user: Any = Depends(verify_token),
):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")
    lid = str(lecture_id)

    def _load() -> dict:
        if not _owns_lecture(uid, lid):
            raise HTTPException(status_code=404, detail="Lecture not found.")
        receipt = _latest_receipt(lid)
        if receipt is None:
            raise HTTPException(status_code=404, detail="No parse receipt for this lecture.")
        return receipt

    try:
        data = await run_in_threadpool(_load)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("parse receipt load failed for lecture %s: %s", lid, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load parse receipt.")
    return {"success": True, "data": data}
