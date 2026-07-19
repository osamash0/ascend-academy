"""Arq worker settings for the unified (v5) PDF pipeline.

Start with:
    python -m arq backend.workers.arq_worker.WorkerSettings

Or via docker-compose:
    worker:
      command: python -m arq backend.workers.arq_worker.WorkerSettings
"""
import logging
import time

from arq.connections import RedisSettings

from backend.core.config import settings
from backend.services.parser.unified_orchestrator import parse_pdf_unified
from backend.services.review.card_factory import generate_review_cards

logger = logging.getLogger(__name__)


async def startup(ctx: dict) -> None:
    """Initialise the asyncpg pool and anything the job functions need."""
    from backend.core.database import init_db_pool
    await init_db_pool()
    logger.info("Arq worker startup complete")


async def shutdown(ctx: dict) -> None:
    from backend.core.database import db_pool
    if db_pool:
        await db_pool.close()
    logger.info("Arq worker shutdown complete")


async def on_job_start(ctx: dict) -> None:
    """Roadmap P1-2: stamp a start time on this job's ctx (Arq passes the
    SAME ctx dict through on_job_start -> the job function -> after_job_end,
    so this survives to the duration calculation below) and opportunistically
    refresh the queue-depth gauge — free since a job just left the queue."""
    ctx["_metrics_start_ts"] = time.monotonic()
    try:
        from backend.services.upload_service import queue_depth
        await queue_depth()
    except Exception:
        logger.debug("arq metrics: queue_depth sample failed", exc_info=True)


async def after_job_end(ctx: dict) -> None:
    """Roadmap P1-2: records arq_job_duration_seconds / arq_job_outcome_total.

    Runs after Arq has already persisted the job result, so
    ``Job(job_id, redis).result_info()`` (the only place function name +
    success/failure are available outside run_job's local closure) is safe
    to read here. Best-effort — a metrics hiccup must never affect job
    processing, which Arq awaits this hook for.
    """
    from backend.core.metrics import ARQ_JOB_DURATION_SECONDS, ARQ_JOB_OUTCOME_TOTAL

    function_name = "unknown"
    outcome = "unknown"
    try:
        from arq.jobs import Job
        job_id = ctx.get("job_id")
        redis = ctx.get("redis")
        if job_id is not None and redis is not None:
            info = await Job(job_id, redis).result_info()
            if info is not None:
                function_name = info.function or "unknown"
                outcome = "success" if info.success else "failure"
    except Exception:
        logger.debug("arq metrics: result_info lookup failed", exc_info=True)

    ARQ_JOB_OUTCOME_TOTAL.labels(function=function_name, outcome=outcome).inc()
    start_ts = ctx.get("_metrics_start_ts")
    if start_ts is not None:
        ARQ_JOB_DURATION_SECONDS.labels(function=function_name).observe(time.monotonic() - start_ts)


class WorkerSettings:
    functions = [parse_pdf_unified, generate_review_cards]
    on_startup = startup
    on_shutdown = shutdown
    on_job_start = on_job_start
    after_job_end = after_job_end

    # Broker + results live on the dedicated queue Redis (noeviction + AOF),
    # never the LRU app-cache Redis — otherwise queued jobs can be evicted.
    redis_settings = RedisSettings.from_dsn(settings.redis_queue_url)

    # Concurrent jobs per worker — respects the VPS RAM budget; tunable via
    # ARQ_MAX_JOBS since a multi-file batch (Phase 1) can enqueue many jobs
    # at once and the worker throttles to this number regardless of origin.
    max_jobs = settings.arq_max_jobs

    # Stage 2 (vision) can take up to 15 minutes for a 200-page deck.
    job_timeout = 900

    # Keep completed job results for 7 days so the SSE endpoint can replay.
    keep_result = 604_800

    # 5 retries with exponential backoff for transient failures.
    max_tries = 5
