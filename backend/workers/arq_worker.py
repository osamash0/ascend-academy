"""Arq worker settings for the unified (v5) PDF pipeline.

Start with:
    python -m arq backend.workers.arq_worker.WorkerSettings

Or via docker-compose:
    worker:
      command: python -m arq backend.workers.arq_worker.WorkerSettings
"""
import logging

from arq.connections import RedisSettings

from backend.core.config import settings
from backend.services.parser.unified_orchestrator import parse_pdf_unified

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


class WorkerSettings:
    functions = [parse_pdf_unified]
    on_startup = startup
    on_shutdown = shutdown

    redis_settings = RedisSettings.from_dsn(settings.redis_url)

    # At most 4 concurrent jobs per worker — respects the VPS RAM budget.
    max_jobs = 4

    # Stage 2 (vision) can take up to 15 minutes for a 200-page deck.
    job_timeout = 900

    # Keep completed job results for 7 days so the SSE endpoint can replay.
    keep_result = 604_800

    # 5 retries with exponential backoff for transient failures.
    max_tries = 5
