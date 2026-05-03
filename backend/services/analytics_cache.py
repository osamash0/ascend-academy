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
        supabase_admin.table("analytics_cache").upsert(
            {
                "lecture_id": lecture_id,
                "view_name": view_name,
                "params_hash": params_hash,
                "payload": payload,
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
