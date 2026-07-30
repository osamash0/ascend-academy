"""
Account-level GDPR operations: data export (Art. 20 portability) and
account-erasure support (Art. 17 right to be forgotten).

Design notes (read before touching this file):

- Deleting the ``auth.users`` row (service-role only, done in
  ``backend/api/v1/auth.py::delete_account_endpoint``) is what actually
  removes almost all of a user's data: every PII-bearing table in
  ``supabase/migrations/`` has ``user_id UUID REFERENCES auth.users(id)
  ON DELETE CASCADE`` (or cascades transitively through ``lectures``, which
  itself cascades from ``professor_id``/``student_owner_id``). That part of
  erasure is a Postgres guarantee, not something this module re-implements.

- Two things a DB-level FK cascade cannot do, which this module *does*
  handle explicitly, and which MUST run before the ``auth.users`` row is
  deleted (they read rows a subsequent cascade would otherwise remove
  first):

    1. **Supabase Storage objects.** ``pdf-uploads`` and ``worksheets`` are
       storage buckets, not tables — a DB cascade never touches them. They
       are deleted via the Storage API.

    2. **`slide_embeddings` / `lecture_blueprints`.** These tables lived only
       in the un-versioned ``backend/scripts/slide_embeddings.sql`` until
       migration ``20260721000000_slide_embeddings_migration_parity.sql``
       gave them a real, cascading migration (P0-3 / S-2 finding — see that
       migration's header comment). A database that predates that migration
       (or a Supabase project where the legacy script was applied instead of
       the migration) has no guaranteed cascade path for ``slide_embeddings``
       at all, so we delete the user's rows explicitly here too. Once every
       environment is on the new migration this becomes redundant-but-
       harmless belt-and-suspenders, not a hidden gap.

- ``pdf-uploads`` is a **content-addressed** bucket: the parse pipeline keys
  files as ``{pdf_hash}.pdf`` and reuses the blob across any user who
  uploads byte-identical content (dedup — see
  ``backend/services/upload_service.py``). A naive "delete every pdf_hash
  this user's lectures reference" would delete another student's still-live
  file out from under them. Before deleting a blob we check whether any
  *other* lecture (owned by a different user) still references the same
  ``pdf_hash`` and skip the delete if so.

- What is intentionally NOT deleted by this module:
    * ``worksheets`` rows where the caller is merely ``uploaded_by`` (not the
      owning professor) use ``ON DELETE SET NULL`` (see
      ``20260503000013_worksheets.sql``) — the worksheet is teaching
      material attached to a *lecture*; a TA/co-uploader deleting their own
      account should not silently delete a professor's course material out
      from under enrolled students. We only remove the storage object when
      the worksheet row itself is being removed, i.e. the caller owns the
      parent lecture.
    * Any future financial/audit-retention table (none currently exist in
      this schema — verified via grep across ``supabase/migrations/`` for
      "invoice"/"payment"/"receipt"/"audit_log" prior to writing this
      module). If one is added later it must be excluded from erasure and
      flagged here, not silently swept up.

Both entry points below are read-only with respect to ``auth.users`` — this
module never deletes the auth identity itself; that stays in
``backend/api/v1/auth.py`` where the rate limit and cache invalidation live.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi.concurrency import run_in_threadpool

from backend.core.database import supabase_admin

logger = logging.getLogger(__name__)

# Tables containing PII or data derived from PII, keyed by the column that
# scopes rows to a single user. Used for export; erasure itself relies on FK
# CASCADE for all of these (see module docstring for the two exceptions).
EXPORT_TABLES: list[tuple[str, str]] = [
    ("profiles", "user_id"),
    ("achievements", "user_id"),
    ("student_progress", "user_id"),
    ("learning_events", "user_id"),
    ("xp_events", "user_id"),
    ("notifications", "user_id"),
    ("user_feedback", "user_id"),
    ("course_enrollments", "user_id"),
    ("course_visits", "user_id"),
    ("lecture_visits", "user_id"),
    ("nudge_dismissals", "user_id"),
    ("schedule_item_completions", "user_id"),
    ("upload_quotas", "user_id"),
    ("review_schedule", "user_id"),
    ("review_log", "user_id"),
    ("exam_attempts", "user_id"),
    ("practice_attempts", "student_id"),
    ("student_catalog_courses", "user_id"),
    ("friend_requests", "requester_id"),
    ("user_roles", "user_id"),
]

# Lectures the user owns (professor-authored courses, or private student
# uploads). Exported/scanned by ownership column, not a flat user_id.
LECTURE_OWNER_COLUMNS = ["professor_id", "student_owner_id"]


async def _select_all(table: str, column: str, uid: str) -> list[dict[str, Any]]:
    def _run() -> list[dict[str, Any]]:
        try:
            resp = supabase_admin.table(table).select("*").eq(column, uid).execute()
            return resp.data or []
        except Exception as e:  # table may not exist in every environment
            logger.warning("gdpr: skipping %s (%s)", table, e)
            return []

    return await run_in_threadpool(_run)


async def export_user_data(uid: str) -> dict[str, Any]:
    """Gather every PII / derived-from-PII row belonging to ``uid``.

    Returns a plain JSON-able dict — one key per source table plus a
    top-level ``exported_at`` timestamp (GDPR Art. 20 data portability).
    """
    result: dict[str, Any] = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "user_id": uid,
    }

    for table, column in EXPORT_TABLES:
        result[table] = await _select_all(table, column, uid)

    owned_lectures: list[dict[str, Any]] = []
    for column in LECTURE_OWNER_COLUMNS:
        owned_lectures.extend(await _select_all("lectures", column, uid))
    result["lectures"] = owned_lectures

    # Worksheets uploaded by this user (attribution only — see docstring).
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
