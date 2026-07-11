"""Student self-serve uploads — "My Materials" (Roadmap Phase 3.1).

A student's personal PDF runs through the same unified parse pipeline as a
professor's lecture (slides, quizzes, tutor chat, review cards, semantic
search) but stays private: `lectures.visibility='private_student'` +
`student_owner_id`. It never gets a `course_id`, so it's excluded from
course listings and professor analytics for free (those all scope by
course_id already). Concept-graph ingestion is skipped entirely for private
uploads — `concepts`/`concept_lectures` have no per-owner scope column today
(open "Authenticated read" RLS), and ingestion isn't wired into the parse
pipeline automatically for anyone, so the safest default is simply not to
call it for private lectures.

Known v1 scope cut: two different owners uploading byte-identical PDF bytes
each pay their own independent parse (no cross-owner content sharing) — see
the docstring on `parse_pdf_unified` for why. Private uploads therefore run
under a distinct `pipeline_version` namespace so they never collide with, or
silently replay into, a professor's (or another student's) `parse_runs` row
for the same `pdf_hash`.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import UploadFile

from backend.core.config import settings
from backend.core.database import get_db_connection, supabase_admin
from backend.core.file_validation import sanitize_filename
from backend.services import upload_service
from backend.services.cache import compute_pdf_hash
from backend.services.parser import repos as parser_repos
from backend.services.parser.unified_orchestrator import PIPELINE_VERSION_UNIFIED

logger = logging.getLogger(__name__)

STUDENT_PIPELINE_VERSION = f"{PIPELINE_VERSION_UNIFIED}-student"


class QuotaExceededError(Exception):
    def __init__(self, limit: int):
        self.limit = limit
        super().__init__(f"Monthly upload quota of {limit} reached.")


def _current_period(now: Optional[datetime] = None) -> str:
    now = now or datetime.now(timezone.utc)
    return f"{now.year:04d}-{now.month:02d}"


async def get_quota_status(user_id: str) -> Dict[str, Any]:
    period = _current_period()
    async with await get_db_connection() as conn:
        row = await conn.fetchrow(
            "SELECT uploads_used, quota_limit FROM upload_quotas WHERE user_id = $1 AND period = $2",
            UUID(user_id), period,
        )
    used = row["uploads_used"] if row else 0
    limit = row["quota_limit"] if row else settings.student_upload_monthly_limit
    return {
        "period": period,
        "uploads_used": used,
        "quota_limit": limit,
        "remaining": max(0, limit - used),
    }


async def _increment_quota(user_id: str) -> Dict[str, Any]:
    """Atomically claim one slot in this month's quota via the SECURITY
    DEFINER RPC (avoids a read-then-write race between two concurrent
    uploads from the same student)."""
    period = _current_period()
    async with await get_db_connection() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM increment_upload_quota($1, $2, $3)",
            UUID(user_id), period, settings.student_upload_monthly_limit,
        )
    return {
        "allowed": row["allowed"],
        "uploads_used": row["uploads_used"],
        "quota_limit": row["quota_limit"],
    }


async def find_existing_upload(user_id: str, pdf_hash: str) -> Optional[Dict[str, Any]]:
    """A student re-uploading a file they already have gets the existing
    lecture back instead of consuming quota / re-parsing."""
    res = (
        supabase_admin.table("lectures")
        .select("id, title, total_slides, created_at")
        .eq("student_owner_id", user_id)
        .eq("pdf_hash", pdf_hash)
        .eq("visibility", "private_student")
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


async def create_upload(user_id: str, file: UploadFile) -> Dict[str, Any]:
    """Validate, quota-check, store, and enqueue a private student upload."""
    content = await upload_service.read_upload_capped(file, settings.max_upload_mb)
    await upload_service.validate_upload(file.filename, content)  # raises ValueError on invalid file

    filename = sanitize_filename(file.filename)
    pdf_hash = compute_pdf_hash(content)

    existing = await find_existing_upload(user_id, pdf_hash)
    if existing:
        return {"status": "duplicate", "lecture_id": existing["id"], "title": existing["title"]}

    quota = await _increment_quota(user_id)
    if not quota["allowed"]:
        raise QuotaExceededError(quota["quota_limit"])

    await upload_service.upload_pdf_to_storage(pdf_hash, content)
    run = await parser_repos.get_or_create_run(
        pdf_hash, None, STUDENT_PIPELINE_VERSION,
        user_id=UUID(user_id), filename=filename,
    )
    pool = await upload_service.get_arq_pool()
    await pool.enqueue_job(
        "parse_pdf_unified",
        pdf_hash=pdf_hash,
        lecture_id="",
        run_id=str(run.run_id),
        ai_model=settings.parser_llm_model or "cerebras",
        user_id=user_id,
        filename=filename,
        parser_used="unified",
        force_reparse=False,
        parsing_mode="ai",
        visibility="private_student",
        student_owner_id=user_id,
    )
    return {"status": "queued", "run_id": str(run.run_id), "pdf_hash": pdf_hash, "filename": filename}


async def list_my_materials(user_id: str) -> List[Dict[str, Any]]:
    """One row per private-upload parse run, joined to the lecture it
    produced (once step 3 of the pipeline has created it)."""
    async with await get_db_connection() as conn:
        run_rows = await conn.fetch(
            """
            SELECT run_id, lecture_id, status, error, filename, started_at, finished_at
            FROM parse_runs
            WHERE user_id = $1 AND pipeline_version = $2
            ORDER BY started_at DESC
            """,
            UUID(user_id), STUDENT_PIPELINE_VERSION,
        )
        lecture_ids = [r["lecture_id"] for r in run_rows if r["lecture_id"]]
        lectures: Dict[Any, Any] = {}
        counts: Dict[Any, Any] = {}
        if lecture_ids:
            lecture_rows = await conn.fetch(
                """
                SELECT id, title, description, total_slides, created_at FROM lectures
                WHERE id = ANY($1::uuid[]) AND student_owner_id = $2
                """,
                lecture_ids, UUID(user_id),
            )
            lectures = {r["id"]: r for r in lecture_rows}
            agg_rows = await conn.fetch(
                """
                SELECT s.lecture_id, COUNT(*) AS slide_count,
                       (SELECT COUNT(*) FROM quiz_questions q
                          JOIN slides s2 ON s2.id = q.slide_id
                         WHERE s2.lecture_id = s.lecture_id) AS quiz_count
                FROM slides s WHERE s.lecture_id = ANY($1::uuid[])
                GROUP BY s.lecture_id
                """,
                lecture_ids,
            )
            counts = {r["lecture_id"]: dict(r) for r in agg_rows}

    out = []
    for r in run_rows:
        lec = lectures.get(r["lecture_id"])
        c = counts.get(r["lecture_id"], {})
        out.append({
            "run_id": str(r["run_id"]),
            "lecture_id": str(r["lecture_id"]) if r["lecture_id"] else None,
            "status": r["status"],
            "error": r["error"],
            "filename": r["filename"],
            "title": (lec["title"] if lec else None) or r["filename"],
            "total_slides": (lec["total_slides"] if lec else 0) or 0,
            "quiz_count": c.get("quiz_count", 0),
            "created_at": (lec["created_at"] if lec else r["started_at"]).isoformat(),
        })
    return out


async def delete_material(user_id: str, lecture_id: str) -> bool:
    """Delete a student's own private lecture. Cascades slides / quiz_questions
    / review_cards / review_schedule / review_log via ON DELETE CASCADE FKs.
    Returns False if no matching row (not found, or not owned by this user).
    """
    async with await get_db_connection() as conn:
        result = await conn.execute(
            "DELETE FROM lectures WHERE id = $1 AND student_owner_id = $2 AND visibility = 'private_student'",
            UUID(lecture_id), UUID(user_id),
        )
    return result.split()[-1] != "0"
