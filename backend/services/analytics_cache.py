"""Per-feature analytics caching layer.

Wraps each professor analytics aggregate in a typed get-or-compute cache
backed by the ``analytics_cache`` table. Keyed by
``(lecture_id, view_name, params_hash)`` with an explicit TTL.

Invalidation is intentionally cheap — a single delete-by-lecture call
that the event-write paths fire whenever new student activity lands.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Optional

from backend.core.database import supabase_admin

logger = logging.getLogger(__name__)

DEFAULT_TTL_SECONDS = 300


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _params_hash(params: Optional[dict]) -> str:
    """Stable short hash of a params dict, or ``'_'`` when no params."""
    if not params:
        return "_"
    blob = json.dumps(params, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def _row_is_fresh(row: dict) -> bool:
    raw = row.get("computed_at")
    if not raw:
        return False
    try:
        ts = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
    except Exception:
        return False
    ttl = int(row.get("ttl_seconds") or DEFAULT_TTL_SECONDS)
    return _now_utc() - ts <= timedelta(seconds=ttl)


def _read(lecture_id: str, view_name: str, params_hash: str) -> Optional[Any]:
    try:
        res = (
            supabase_admin.table("analytics_cache")
            .select("payload, computed_at, ttl_seconds")
            .eq("lecture_id", lecture_id)
            .eq("view_name", view_name)
            .eq("params_hash", params_hash)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        row = rows[0]
        if not _row_is_fresh(row):
            return None
        return row["payload"]
    except Exception as e:
        logger.warning("analytics_cache read failed (%s/%s): %s", lecture_id, view_name, e)
        return None


def _write(lecture_id: str, view_name: str, params_hash: str, payload: Any, ttl: int) -> None:
    try:
        # Ensure payload is JSON serializable (handles datetime objects)
        serializable_payload = json.loads(json.dumps(payload, default=str))

        supabase_admin.table("analytics_cache").upsert(
            {
                "lecture_id": lecture_id,
                "view_name": view_name,
                "params_hash": params_hash,
                "payload": serializable_payload,
                "computed_at": _now_utc().isoformat(),
                "ttl_seconds": ttl,
            },
            on_conflict="lecture_id,view_name,params_hash",
        ).execute()
    except Exception as e:
        logger.warning("analytics_cache write failed (%s/%s): %s", lecture_id, view_name, e)


def get_or_compute(
    lecture_id: str,
    view_name: str,
    compute_fn: Callable[[], Any],
    *,
    params: Optional[dict] = None,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
    force_refresh: bool = False,
) -> Any:
    """Synchronous get-or-compute.

    Returns the cached payload on hit, otherwise runs ``compute_fn``,
    writes the result, and returns it. Cache failures never mask a real
    compute error — they just degrade to a recompute on the next call.
    """
    if not lecture_id:
        return compute_fn()
    ph = _params_hash(params)
    if not force_refresh:
        hit = _read(lecture_id, view_name, ph)
        if hit is not None:
            return hit
    result = compute_fn()
    _write(lecture_id, view_name, ph, result, ttl_seconds)
    return result


async def get_or_compute_async(
    lecture_id: str,
    view_name: str,
    compute_fn: Callable[[], Awaitable[Any]],
    *,
    params: Optional[dict] = None,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
    force_refresh: bool = False,
) -> Any:
    """Async variant of :func:`get_or_compute`."""
    if not lecture_id:
        return await compute_fn()
    ph = _params_hash(params)
    if not force_refresh:
        hit = _read(lecture_id, view_name, ph)
        if hit is not None:
            return hit
    result = await compute_fn()
    _write(lecture_id, view_name, ph, result, ttl_seconds)
    return result


def invalidate_course_overview(course_id: Optional[str]) -> int:
    """Drop the cached ``professor_overview`` rows for ``course_id``.

    The course-wide overview is stored in ``analytics_cache`` under the
    ``lecture_id`` slot keyed by ``course_id`` (see
    :func:`analytics_service.get_professor_overview`). We filter on both
    that id and ``view_name='professor_overview'`` so we only ever clear
    rows that belong to the course-overview view — never any per-lecture
    aggregate that happens to share the slot.

    Best-effort: failures are logged but never raised. Returns the number
    of rows deleted (0 on error).
    """
    if not course_id:
        return 0
    try:
        res = (
            supabase_admin.table("analytics_cache")
            .delete()
            .eq("lecture_id", course_id)
            .eq("view_name", "professor_overview")
            .execute()
        )
        return res.count if getattr(res, "count", None) is not None else len(res.data or [])
    except Exception as e:
        logger.warning(
            "analytics_cache invalidate_course_overview failed for %s: %s",
            course_id,
            e,
        )
        return 0


def invalidate_course_overview_for_lecture(lecture_id: Optional[str]) -> int:
    """Resolve the parent course of ``lecture_id`` and invalidate its overview.

    Convenience wrapper for the mutation paths (slide edits, quiz
    regeneration) that only know the lecture they touched. Looks up
    ``lectures.course_id`` and forwards to :func:`invalidate_course_overview`.
    Returns 0 when the lecture has no course assigned or on lookup error.
    """
    if not lecture_id:
        return 0
    try:
        res = (
            supabase_admin.table("lectures")
            .select("course_id")
            .eq("id", lecture_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        course_id = rows[0].get("course_id") if rows else None
    except Exception as e:
        logger.warning(
            "analytics_cache course lookup failed for lecture %s: %s",
            lecture_id,
            e,
        )
        return 0
    if not course_id:
        return 0
    return invalidate_course_overview(course_id)


def invalidate(lecture_id: Optional[str]) -> int:
    """Drop every cached aggregate row for ``lecture_id``.

    Called from the event-writing paths so the next dashboard load
    recomputes against fresh data. Best-effort: failures are logged but
    never raised — a stale read is preferable to a 500 on event ingest.
    Returns the number of rows deleted (0 on error).
    """
    if not lecture_id:
        return 0
    try:
        res = (
            supabase_admin.table("analytics_cache")
            .delete()
            .eq("lecture_id", lecture_id)
            .execute()
        )
        return res.count if getattr(res, "count", None) is not None else len(res.data or [])
    except Exception as e:
        logger.warning("analytics_cache invalidate failed for %s: %s", lecture_id, e)
        return 0
