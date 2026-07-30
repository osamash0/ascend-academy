"""Redis SET-NX in-flight locks for Arq job idempotency (Roadmap P2-3).

`parse_runs`/`review_cards` already dedupe *completed* work (see
`unified_orchestrator.py`'s COMPLETED-replay check and `card_factory.py`'s
`content_hash` UNIQUE constraint). What was missing: nothing stopped two
*concurrent* attempts for the same natural key (pdf_hash / lecture_id) from
both doing the expensive work at once — e.g. a batch upload re-enqueuing the
same PDF, or an SSE-reconnect re-triggering a job while the first attempt is
still mid-flight.

This module adds a short-lived "someone is already working on this" lock via
`SET key val NX EX ttl` — the same primitive `backend/core/idempotency.py`
uses for HTTP Idempotency-Key requests, scoped here to job-level dedupe keys.
Locks live on whatever Redis connection the caller passes in — inside a real
Arq job that's `ctx['redis']` (the queue Redis Arq itself already uses, set
up in `arq.worker.Worker.main`); outside a worker (dev/test callers passing
`ctx={}`) callers fall back to a throwaway connection to `redis_queue_url`.

Best-effort by design: a Redis outage degrades to "no lock, proceed anyway"
rather than blocking the pipeline — Redis is an optimization here, not a
correctness boundary (mirrors how the rest of this codebase treats Redis).
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

LOCK_PREFIX = "joblock:"


def parse_lock_key(pdf_hash: str) -> str:
    return f"{LOCK_PREFIX}parse:{pdf_hash}"


def review_cards_lock_key(lecture_id: str) -> str:
    return f"{LOCK_PREFIX}review_cards:{lecture_id}"


async def acquire_job_lock(redis_conn: Any, key: str, ttl_seconds: int) -> bool:
    """Best-effort SET NX lock. Returns True iff this call now holds it.

    Never raises: a connection error is treated as "lock service degraded,
    proceed without one" so a Redis blip never blocks the whole pipeline.
    """
    if redis_conn is None:
        return True
    try:
        acquired = await redis_conn.set(key, "1", nx=True, ex=ttl_seconds)
        return bool(acquired)
    except Exception as exc:
        logger.warning("job lock acquire failed for %s (proceeding without lock): %s", key, exc)
        return True


async def release_job_lock(redis_conn: Any, key: str) -> None:
    """Best-effort release. Safe to call even if the lock was never held —
    the TTL is the real backstop against a leaked/never-released lock."""
    if redis_conn is None:
        return
    try:
        await redis_conn.delete(key)
    except Exception as exc:
        logger.debug("job lock release failed for %s: %s", key, exc)
