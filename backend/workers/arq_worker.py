"""Arq worker settings for the unified (v5) PDF pipeline.

Start with:
    python -m arq backend.workers.arq_worker.WorkerSettings

Or via docker-compose:
    worker:
      command: python -m arq backend.workers.arq_worker.WorkerSettings

Roadmap P2-2: also hosts the daily nudge-engine cron job (moved off
in-process APScheduler in backend/services/nudge_scheduler.py — see that
module's docstring for why). ``cron(..., unique=True)`` is arq's default,
so even if this worker is ever scaled to N processes, only one of them
actually executes the job at each scheduled time (arq dedupes via a
Redis-backed key), never N double-fires the way APScheduler would have.
"""
import logging

from arq.connections import RedisSettings
from arq.cron import cron

from backend.core.config import settings
from backend.services.nudge_scheduler import (
    NUDGE_CRON_ENABLED,
    NUDGE_RUN_HOUR_UTC,
    run_nudge_engine_cron,
)
from backend.services.parser.unified_orchestrator import parse_pdf_unified
from backend.services.review.card_factory import generate_review_cards

logger = logging.getLogger(__name__)

# Empty when ENABLE_NUDGE_SCHEDULER isn't set to "1" — same off-by-default
# posture as the old APScheduler wiring (never fires in dev/tests).
_cron_jobs = (
    [cron(run_nudge_engine_cron, hour=NUDGE_RUN_HOUR_UTC, minute=0, unique=True)]
    if NUDGE_CRON_ENABLED
    else []
)


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


class WorkerSettings:
    functions = [parse_pdf_unified, generate_review_cards]
    cron_jobs = _cron_jobs
    on_startup = startup
    on_shutdown = shutdown

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
