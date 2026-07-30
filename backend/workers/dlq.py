"""Dead-letter queue + basic health visibility for the Arq worker (Roadmap P2-3).

Lifecycle note (verified against the installed `arq` package —
`python3.11 -c "import arq.worker, inspect; print(inspect.getsource(arq.worker.Worker.run_job))"`):

  - A job function that raises a plain exception (not `arq.jobs.Retry`) is
    treated by Arq as an *immediate permanent failure* — `finish=True` on the
    very first attempt. Neither of our job functions raises `Retry`, so in
    practice every failure of `parse_pdf_unified` / `generate_review_cards`
    is already final by the time `on_job_end` / `after_job_end` fire. This is
    the lifecycle point this module hooks.
  - The *other* path, `job_try > max_tries` (Arq re-picking up a job whose
    worker crashed or timed out, past its retry budget), calls
    `finish_failed_job()` directly and returns **before** `on_job_end` /
    `after_job_end` are invoked at all — a real gap in Arq's hook surface for
    that specific crash-loop case. Covering it would require subclassing/
    monkey-patching `Worker.run_job` itself; out of scope here and called out
    explicitly as a follow-up (see WorkerSettings wiring in arq_worker.py).

`after_job_end` (not `on_job_end`) is used deliberately: by the time
`after_job_end` runs, `finish_job`/`finish_failed_job` has already written the
result to Redis, so `Job(job_id, redis).result_info()` returns a populated
`JobResult` we can inspect for `success`.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from arq.jobs import Job

from backend.core.config import settings

logger = logging.getLogger(__name__)


def _jsonable(value: Any) -> Any:
    """Best-effort JSON-safe coercion for arbitrary job args/kwargs (UUIDs,
    etc.) — this is diagnostic payload for the DLQ, not app data, so falling
    back to `str()` is fine and must never raise."""
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)


async def _insert_dlq_row(
    function_name: str,
    job_id: Optional[str],
    args: tuple,
    kwargs: dict,
    job_try: Optional[int],
    error: str,
) -> None:
    """Best-effort insert — a DLQ write failure must never crash job
    processing (it's an observability aid, not a correctness dependency)."""
    try:
        from backend.core.database import db_pool, init_db_pool

        pool = db_pool
        if pool is None:
            await init_db_pool()
            from backend.core.database import db_pool as _pool
            pool = _pool
        if pool is None:
            logger.warning("dead_letter_jobs insert skipped: no DB pool available")
            return

        args_json = json.dumps([_jsonable(a) for a in args])
        kwargs_json = json.dumps({k: _jsonable(v) for k, v in kwargs.items()})

        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO dead_letter_jobs (function_name, job_id, args, kwargs, job_try, error)
                VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
                """,
                function_name, job_id, args_json, kwargs_json, job_try, error,
            )
        logger.warning(
            "job %s (%s) permanently failed after try %s — written to dead_letter_jobs",
            job_id, function_name, job_try,
        )
    except Exception:
        # Never let DLQ bookkeeping take down the worker.
        logger.exception("failed to write dead_letter_jobs row for job %s (%s)", job_id, function_name)


async def capture_dlq_on_job_end(ctx: dict) -> None:
    """Arq `after_job_end` hook: if the job that just finished failed, best-
    effort persist it to `dead_letter_jobs`. Wired via WorkerSettings —
    additive, never raises (a failure here must not affect job processing)."""
    job_id = ctx.get("job_id")
    redis = ctx.get("redis")
    if not job_id or redis is None:
        return
    try:
        info = await Job(job_id, redis).result_info()
        if info is None or info.success:
            return
        await _insert_dlq_row(
            function_name=info.function,
            job_id=job_id,
            args=info.args or (),
            kwargs=info.kwargs or {},
            job_try=ctx.get("job_try"),
            error=repr(info.result),
        )
    except Exception:
        logger.exception("capture_dlq_on_job_end failed for job %s (non-fatal)", job_id)


async def get_worker_health_summary() -> Dict[str, Any]:
    """Queued/DLQ visibility (Roadmap P2-3, step 5).

    Returns queue depth (Arq's own sorted-set backlog) and the dead-letter
    count. Deliberately not wired to Prometheus yet — `backend/core/
    metrics.py` doesn't exist on this branch (it lands with the unmerged
    P1-2 initiative); wiring a gauge is a one-line follow-up once that
    branch merges. This function is the thing to wire it to.
    """
    import redis.asyncio as aioredis

    summary: Dict[str, Any] = {"queued": None, "dead_letter": None, "error": None}

    try:
        r = aioredis.from_url(settings.redis_queue_url, decode_responses=True)
        try:
            # Arq's default queue key; matches ArqRedis.default_queue_name.
            summary["queued"] = await r.zcard("arq:queue")
        finally:
            await r.aclose()
    except Exception as exc:
        summary["error"] = f"redis: {exc}"

    try:
        from backend.core.database import db_pool, init_db_pool

        pool = db_pool
        if pool is None:
            await init_db_pool()
            from backend.core.database import db_pool as _pool
            pool = _pool
        if pool is not None:
            async with pool.acquire() as conn:
                summary["dead_letter"] = await conn.fetchval("SELECT count(*) FROM dead_letter_jobs")
                summary["dead_letter_unresolved"] = await conn.fetchval(
                    "SELECT count(*) FROM dead_letter_jobs WHERE resolved_at IS NULL"
                )
    except Exception as exc:
        prev = summary.get("error")
        summary["error"] = f"{prev}; db: {exc}" if prev else f"db: {exc}"

    return summary
