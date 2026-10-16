"""Account data export (GDPR Art. 20). Erasure lives in backend/services/erasure.py."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Iterable

from fastapi.concurrency import run_in_threadpool

from backend.core.database import supabase_admin
from backend.services.db_errors import is_tolerable_absence

logger = logging.getLogger(__name__)

# Every user-linked column, by the table it lives in. Rows from several
# columns of one table (friend_requests) are merged and de-duplicated by id.
# Production-only tables (tutor_sessions, api_tokens, course_access) are
# listed too: a table missing here (PGRST205/42P01) is skipped; any other
# error fails the whole export rather than returning it partial.
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
    # Raw events are deleted past retention; older history lives only here.
    ("learning_events_daily_rollup", "user_id"),
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
    ("user_roles", "user_id"),
    ("internal_account_overrides", "user_id"),
    # v4 reader notes; the table is live in production ahead of its migration.
    ("notes", "user_id"),
]

# Columns never exported even though the row is: secrets, not personal data.
EXPORT_REDACT: dict[str, set[str]] = {"api_tokens": {"token_hash"}}

# User-linked columns deliberately NOT exported, each with its reason.
EXPORT_EXCLUSIONS: dict[tuple[str, str], str] = {
    ("learning_events_legacy_20260721", "user_id"): (
        "pre-partitioning rollback copy; every row also lives in learning_events"
    ),
    ("account_erasure_jobs", "subject_id"): (
        "erasure bookkeeping; exists only while an account is being deleted"
    ),
    ("internal_account_overrides", "set_by"): (
        "admin audit trail: who classified an account, not data about the subject"
    ),
}

# Exported by dedicated code below rather than through EXPORT_TABLES.
ALWAYS_COVERED: set[tuple[str, str]] = {
    ("lectures", "professor_id"),
    ("lectures", "student_owner_id"),
    ("worksheets", "uploaded_by"),
    ("tutor_messages", "user_id"),  # by user_id and through the caller's tutor_sessions
}

LECTURE_OWNER_COLUMNS = ["professor_id", "student_owner_id"]


def covered_columns() -> set[tuple[str, str]]:
    return set(EXPORT_TABLES) | ALWAYS_COVERED | set(EXPORT_EXCLUSIONS)


def uncovered(fk_columns: Iterable[tuple[str, str]]) -> list[tuple[str, str]]:
    """User-linked (table, column) pairs the export neither covers nor excludes."""
    known = covered_columns()
    return sorted(c for c in fk_columns if c not in known)


PAGE_SIZE = 1000  # PostgREST's default max-rows; a short page means the end
IN_CHUNK = 100    # ids per in_() filter, keeps the request URL short


def _paged(build) -> list[dict[str, Any]]:
    """Every row of ``build()``, fetched PAGE_SIZE at a time until a short page."""
    out: list[dict[str, Any]] = []
    start = 0
    while True:
        page = build().range(start, start + PAGE_SIZE - 1).execute().data or []
        out.extend(page)
        if len(page) < PAGE_SIZE:
            return out
        start += PAGE_SIZE


async def _select_all(table: str, column: str, uid: str) -> list[dict[str, Any]]:
    """All rows of ``table`` where ``column`` = uid.

    A table absent in this environment (or tutor_messages without user_id,
    see db_errors.USER_ID_OPTIONAL_TABLES) yields []; every other error
    propagates, so the export fails loudly instead of coming back partial.
    """
    def _run() -> list[dict[str, Any]]:
        try:
            return _paged(lambda: supabase_admin.table(table).select("*").eq(column, uid))
        except Exception as e:
            if is_tolerable_absence(e, table, column):
                logger.info("gdpr: %s.%s not present here; skipped", table, column)
                return []
            raise

    return await run_in_threadpool(_run)


async def _select_in(table: str, column: str, values: list[str]) -> list[dict[str, Any]]:
    if not values:
        return []

    def _run() -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        try:
            for i in range(0, len(values), IN_CHUNK):
                chunk = values[i:i + IN_CHUNK]
                out.extend(_paged(lambda: supabase_admin.table(table).select("*").in_(column, chunk)))
        except Exception as e:
            if is_tolerable_absence(e, table, column):
                logger.info("gdpr: %s not present here; skipped", table)
                return []
            raise
        return out

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

    # AI chat transcripts: in production they hang off tutor_sessions
    # (session_id, no user_id); the migrated schema keys them by user_id
    # instead. Read both shapes and merge, so neither environment loses any.
    session_ids = [s["id"] for s in result.get("tutor_sessions", []) if s.get("id")]
    result["tutor_messages"] = _merge(
        await _select_in("tutor_messages", "session_id", session_ids),
        await _select_all("tutor_messages", "user_id", uid),
    )

    owned_lectures: list[dict[str, Any]] = []
    for column in LECTURE_OWNER_COLUMNS:
        owned_lectures = _merge(owned_lectures, await _select_all("lectures", column, uid))
    result["lectures"] = owned_lectures
    result["worksheets_uploaded"] = await _select_all("worksheets", "uploaded_by", uid)
    return result
