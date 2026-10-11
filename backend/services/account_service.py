"""Account data export (GDPR Art. 20). Erasure lives in backend/services/erasure.py."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Iterable

from fastapi.concurrency import run_in_threadpool

from backend.core.database import supabase_admin

logger = logging.getLogger(__name__)

# Every user-linked column, by the table it lives in. Rows from several
# columns of one table (friend_requests) are merged and de-duplicated by id.
# Production-only tables (tutor_sessions, api_tokens, course_access) are
# listed too: a missing table is skipped, never fatal.
EXPORT_TABLES: list[tuple[str, str]] = [
    ("profiles", "user_id"),
    ("user_roles", "user_id"),
    ("onboarding_progress", "user_id"),
    ("notification_preferences", "user_id"),
    ("notifications", "user_id"),
    ("user_feedback", "user_id"),
    ("achievements", "user_id"),
    ("xp_events", "user_id"),
    ("learning_events", "user_id"),
    ("student_progress", "user_id"),
    ("concept_mastery", "user_id"),
    ("course_enrollments", "user_id"),
    ("course_visits", "user_id"),
    ("lecture_visits", "user_id"),
    ("student_catalog_courses", "user_id"),
    ("nudge_dismissals", "user_id"),
    ("schedule_item_completions", "user_id"),
    ("review_schedule", "user_id"),
    ("review_log", "user_id"),
    ("exam_attempts", "user_id"),
    ("practice_attempts", "student_id"),
    ("practice_sheets", "created_by"),
    ("v4_rehearsal_attempts", "user_id"),
    ("assignment_enrollments", "user_id"),
    ("assignments", "professor_id"),
    ("courses", "professor_id"),
    ("course_blueprints", "owner_id"),
    ("material_sources", "owner_id"),
    ("parse_runs", "user_id"),
    ("upload_quotas", "user_id"),
    ("llm_calls", "user_id"),
    ("friend_requests", "requester_id"),
    ("friend_requests", "addressee_id"),
    ("tutor_sessions", "user_id"),
    ("api_tokens", "user_id"),
    ("course_access", "user_id"),
]

# Columns never exported even though the row is: secrets, not personal data.
EXPORT_REDACT: dict[str, set[str]] = {"api_tokens": {"token_hash"}}

# User-linked columns deliberately NOT exported, each with its reason.
EXPORT_EXCLUSIONS: dict[tuple[str, str], str] = {
    ("learning_events_daily_rollup", "user_id"): (
        "derived aggregate of learning_events, which is exported row by row"
    ),
    ("learning_events_legacy_20260721", "user_id"): (
        "pre-partitioning rollback copy; every row also lives in learning_events"
    ),
    ("account_erasure_jobs", "subject_id"): (
        "erasure bookkeeping; exists only while an account is being deleted"
    ),
}

# Exported by dedicated code below rather than through EXPORT_TABLES.
ALWAYS_COVERED: set[tuple[str, str]] = {
    ("lectures", "professor_id"),
    ("lectures", "student_owner_id"),
    ("worksheets", "uploaded_by"),
    ("tutor_messages", "user_id"),  # exported through the caller's tutor_sessions
}

LECTURE_OWNER_COLUMNS = ["professor_id", "student_owner_id"]


def covered_columns() -> set[tuple[str, str]]:
    return set(EXPORT_TABLES) | ALWAYS_COVERED | set(EXPORT_EXCLUSIONS)


def uncovered(fk_columns: Iterable[tuple[str, str]]) -> list[tuple[str, str]]:
    """User-linked (table, column) pairs the export neither covers nor excludes."""
    known = covered_columns()
    return sorted(c for c in fk_columns if c not in known)


async def _select_all(table: str, column: str, uid: str) -> list[dict[str, Any]]:
    def _run() -> list[dict[str, Any]]:
        try:
            resp = supabase_admin.table(table).select("*").eq(column, uid).execute()
            return resp.data or []
        except Exception as e:  # production-only tables may be missing elsewhere
            logger.warning("gdpr: skipping %s.%s (%s)", table, column, e)
            return []

    return await run_in_threadpool(_run)


async def _select_in(table: str, column: str, values: list[str]) -> list[dict[str, Any]]:
    if not values:
        return []

    def _run() -> list[dict[str, Any]]:
        try:
            resp = supabase_admin.table(table).select("*").in_(column, values).execute()
            return resp.data or []
        except Exception as e:
            logger.warning("gdpr: skipping %s (%s)", table, e)
            return []

    return await run_in_threadpool(_run)


def _merge(existing: list[dict[str, Any]], new: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen = {r.get("id") for r in existing if r.get("id") is not None}
    return existing + [r for r in new if r.get("id") is None or r.get("id") not in seen]


async def export_user_data(uid: str) -> dict[str, Any]:
    """Every row holding the caller's data (GDPR Art. 20), one key per table."""
    result: dict[str, Any] = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "user_id": uid,
    }
    for table, column in EXPORT_TABLES:
        rows = await _select_all(table, column, uid)
        redact = EXPORT_REDACT.get(table, set())
        if redact:
            rows = [{k: v for k, v in r.items() if k not in redact} for r in rows]
        result[table] = _merge(result.get(table, []), rows)

    # AI chat transcripts hang off tutor_sessions, not the user.
    session_ids = [s["id"] for s in result.get("tutor_sessions", []) if s.get("id")]
    result["tutor_messages"] = await _select_in("tutor_messages", "session_id", session_ids)

    owned_lectures: list[dict[str, Any]] = []
    for column in LECTURE_OWNER_COLUMNS:
        owned_lectures = _merge(owned_lectures, await _select_all("lectures", column, uid))
    result["lectures"] = owned_lectures
    result["worksheets_uploaded"] = await _select_all("worksheets", "uploaded_by", uid)
    return result


async def _lecture_ids_and_hashes(uid: str) -> tuple[list[str], set[str]]:
    """Lecture ids and pdf_hash values owned by ``uid`` (professor or
    private-student ownership)."""
    ids: list[str] = []
    hashes: set[str] = set()
    for column in LECTURE_OWNER_COLUMNS:
        rows = await _select_all("lectures", column, uid)
        for row in rows:
            if row.get("id"):
                ids.append(row["id"])
            if row.get("pdf_hash"):
                hashes.add(row["pdf_hash"])
    return ids, hashes


async def _pdf_hash_used_by_other_users(pdf_hash: str, uid: str) -> bool:
    """True if any lecture NOT owned by ``uid`` still references this
    content-addressed pdf_hash (dedup safety — see module docstring)."""

    def _run() -> bool:
        try:
            resp = (
                supabase_admin.table("lectures")
                .select("id, professor_id, student_owner_id")
                .eq("pdf_hash", pdf_hash)
                .execute()
            )
        except Exception as e:
            logger.warning(
                "erasure: pdf_hash reference check failed for %s (%s) — "
                "leaving blob in place to be safe", pdf_hash, e,
            )
            return True
        for row in resp.data or []:
            if row.get("professor_id") != uid and row.get("student_owner_id") != uid:
                return True
        return False

    return await run_in_threadpool(_run)


async def erase_user_storage_and_derived_data(uid: str) -> dict[str, Any]:
    """Delete storage objects and any non-cascading derived rows for ``uid``.

    MUST be called BEFORE deleting the ``auth.users`` row — it reads
    ``lectures``/``worksheets`` rows that a subsequent ``ON DELETE CASCADE``
    would otherwise remove first.

    This function does NOT touch ``auth.users`` and is safe to call and
    re-call (idempotent: re-running against an already-cleaned account finds
    nothing to delete and returns zeros). Callers are responsible for the
    actual account/auth-identity deletion.

    Returns a small summary dict for logging/testing, e.g.
    ``{"pdf_blobs_deleted": 2, "pdf_blobs_retained_shared": 1,
       "worksheet_files_deleted": 1, "slide_embeddings_deleted": 14}``.
    """
    summary = {
        "pdf_blobs_deleted": 0,
        "pdf_blobs_retained_shared": 0,
        "worksheet_files_deleted": 0,
        "slide_embeddings_deleted": 0,
    }

    lecture_ids, pdf_hashes = await _lecture_ids_and_hashes(uid)

    # 1. slide_embeddings — explicit delete; see module docstring re: the
    #    P0-3/S-2 migration-parity gap this belt-and-suspenders covers.
    if lecture_ids:
        def _delete_embeddings() -> int:
            try:
                targets = (
                    supabase_admin.table("slide_embeddings")
                    .select("id")
                    .in_("lecture_id", lecture_ids)
                    .execute()
                )
                if not targets.data:
                    return 0
                supabase_admin.table("slide_embeddings").delete().in_(
                    "lecture_id", lecture_ids
                ).execute()
                return len(targets.data)
            except Exception as e:
                logger.warning("erasure: slide_embeddings cleanup failed for %s (%s)", uid, e)
                return 0

        summary["slide_embeddings_deleted"] = await run_in_threadpool(_delete_embeddings)

    # 2. pdf-uploads storage blobs — content-addressed, dedup-aware.
    for pdf_hash in pdf_hashes:
        if await _pdf_hash_used_by_other_users(pdf_hash, uid):
            summary["pdf_blobs_retained_shared"] += 1
            continue

        def _remove_blob(h: str = pdf_hash) -> None:
            try:
                supabase_admin.storage.from_("pdf-uploads").remove([f"{h}.pdf"])
            except Exception as e:
                logger.warning("erasure: pdf-uploads delete failed for %s (%s)", h, e)

        await run_in_threadpool(_remove_blob)
        summary["pdf_blobs_deleted"] += 1

    # 3. worksheets storage files — only for worksheets on lectures this user
    #    owns (their own course materials). One file per row, not
    #    content-addressed, so no dedup check is needed.
    if lecture_ids:
        def _worksheet_files() -> list[str]:
            try:
                resp = (
                    supabase_admin.table("worksheets")
                    .select("file_url")
                    .in_("lecture_id", lecture_ids)
                    .execute()
                )
                return [r["file_url"] for r in (resp.data or []) if r.get("file_url")]
            except Exception as e:
                logger.warning("erasure: worksheet listing failed for %s (%s)", uid, e)
                return []

        paths = await run_in_threadpool(_worksheet_files)
        if paths:
            def _remove_worksheets() -> None:
                try:
                    supabase_admin.storage.from_("worksheets").remove(paths)
                except Exception as e:
                    logger.warning("erasure: worksheets storage delete failed (%s)", e)

            await run_in_threadpool(_remove_worksheets)
            summary["worksheet_files_deleted"] = len(paths)

    return summary
