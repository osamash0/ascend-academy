"""Async analytics rollup (P5-3 — decouple student write-path latency from
analytics bookkeeping).

Two jobs live here, both fired-and-forgotten from the student write path via
Arq (``ctx["redis"]``-backed queue, see ``backend.workers.arq_worker``) rather
than awaited inline before the HTTP response returns:

* ``rollup_analytics_cache`` — replaces the old synchronous
  ``analytics_cache.invalidate(lecture_id)`` call that used to run inline
  inside ``event_repo.insert_event`` on every event write. That call was a
  *second* blocking Supabase round-trip (a DELETE against
  ``analytics_cache``) on top of the event INSERT itself, duplicating work
  the DB trigger (`supabase/migrations/20260503000017_analytics_cache.sql`,
  `invalidate_analytics_cache_on_event`) already does synchronously and
  cheaply at the DB layer. Moving it out-of-band removes that second
  round-trip from the request's critical path entirely.

* ``rollup_concept_mastery`` — replaces the inline
  ``mastery.record_grade(conn, ...)`` call that used to run *inside* the same
  DB transaction as `POST /review/{card_id}/grade` in
  `backend/api/v1/review.py`. That call does a SELECT + Laplace-smoothed
  recompute + UPSERT into `concept_mastery` before the response is returned
  to the client — genuine synchronous Python-side aggregate recomputation on
  the hot write path. It now runs in its own connection, after the request's
  transaction has already committed and the response has been sent.

Self-healing: both jobs are plain Arq job functions, so a raised exception is
retried by Arq itself (`WorkerSettings.max_tries = 5`, exponential backoff) —
we deliberately do NOT swallow exceptions here (unlike the old best-effort
inline callers), because swallowing them would silently drop the retry that
makes this self-healing. We log loudly on every failure so it's observable
even before a retry succeeds.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional
from uuid import UUID

logger = logging.getLogger(__name__)


async def rollup_analytics_cache(ctx: dict, lecture_id: str) -> Dict[str, Any]:
    """Arq job: drop every cached analytics aggregate for ``lecture_id`` so
    the next dashboard read recomputes against fresh data.

    Out-of-band equivalent of the old inline ``analytics_cache.invalidate``
    call in ``event_repo.insert_event``. Idempotent (a delete-by-lecture_id
    is safe to run any number of times) — a retried run after a prior
    failure is harmless.
    """
    from backend.core.database import run_sync
    from backend.services import analytics_cache

    try:
        deleted = await run_sync(analytics_cache.invalidate, lecture_id)
    except Exception:
        logger.exception(
            "rollup_analytics_cache FAILED for lecture_id=%s — will retry on next Arq attempt",
            lecture_id,
        )
        raise
    logger.info(
        "rollup_analytics_cache ok: lecture_id=%s rows_deleted=%s", lecture_id, deleted
    )
    return {"lecture_id": lecture_id, "rows_deleted": deleted}


async def rollup_concept_mastery(
    ctx: dict, user_id: str, card_id: str, rating: int
) -> Dict[str, Any]:
    """Arq job: recompute the Laplace-smoothed ``concept_mastery`` aggregate
    for the concept behind ``card_id`` after a review grade, out-of-band from
    the grading request itself.

    Idempotent-ish by construction: it re-reads the current
    (attempts, correct) row and re-derives the new counts/score from
    scratch, so a retried run after a transient failure recomputes the same
    target state rather than double-counting — the only risk is if two
    grades for the *same* card race across two rollup runs, which is no
    different from the risk already present in the original inline version
    (same read-modify-write shape, just moved out of the request
    transaction).
    """
    from backend.core.database import get_db_connection
    from backend.services.review import mastery

    try:
        async with await get_db_connection() as conn:
            await mastery.record_grade(conn, user_id, UUID(card_id), rating)
    except Exception:
        logger.exception(
            "rollup_concept_mastery FAILED for user_id=%s card_id=%s rating=%s — "
            "will retry on next Arq attempt",
            user_id,
            card_id,
            rating,
        )
        raise
    logger.info(
        "rollup_concept_mastery ok: user_id=%s card_id=%s rating=%s", user_id, card_id, rating
    )
    return {"user_id": user_id, "card_id": card_id, "rating": rating}
