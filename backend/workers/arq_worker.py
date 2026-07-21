"""Arq worker settings for the unified (v5) PDF pipeline.

Start with:
    python -m arq backend.workers.arq_worker.WorkerSettings

Or via docker-compose:
    worker:
      command: python -m arq backend.workers.arq_worker.WorkerSettings
"""
import logging

from arq.connections import RedisSettings
from arq.cron import cron

from backend.core.config import settings
from backend.services.parser.unified_orchestrator import parse_pdf_unified
from backend.services.review.card_factory import generate_review_cards
from backend.workers.dlq import capture_dlq_on_job_end

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


# ── P5-2: scheduled materialized-view refresh ────────────────────────────────
#
# `mv_course_daily_activity` (supabase/migrations/
# 20260720000000_professor_overview_daily_activity_mv.sql) backs the
# professor-overview dashboard aggregate (analytics_service.py::
# _compute_professor_overview) instead of a live per-request scan over
# learning_events. It needs a periodic refresh or the dashboard would show
# the numbers from whenever the view was last built (i.e. never, if nothing
# refreshes it).
#
# Interval: every 10 minutes. This is the "bounded staleness" window the
# roadmap (docs/ROADMAP_10X_FOUNDATION.md §13, P5-2) asks to be documented:
# professor-dashboard active_students / median_time_minutes /
# activity_sparkline can lag up to ~10 minutes behind the latest student
# activity. 10 minutes was picked as a middle ground — short enough that a
# professor watching a live session still sees it move within the hour,
# long enough that a REFRESH CONCURRENTLY (a full re-aggregation over the
# window, see the migration) doesn't compete for I/O with OLTP traffic on
# every request. There is no "give me live data now" fallback for this
# specific view today; average_completion/average_quiz_accuracy (sourced
# from `student_progress`, not this view) and weakest_concepts/weakest_slides
# (a narrower live quiz_attempt-only query) are already always-live in the
# same endpoint, so a professor never sees a fully stale dashboard — only
# these three fields can lag.
async def refresh_professor_overview_mv(ctx: dict) -> None:
    """Arq cron job: REFRESH MATERIALIZED VIEW CONCURRENTLY the P5-2 rollup.

    CONCURRENTLY requires the unique index the migration creates
    (`uq_mv_course_daily_activity_course_day`) and means readers are never
    blocked while the refresh runs (verified manually against a local
    Postgres: a long-running SELECT against the view completed unaffected
    while a concurrent REFRESH ran in another connection).
    """
    from backend.core.database import get_db_connection

    import asyncpg
    try:
        async with await get_db_connection() as conn:
            await conn.execute(
                "REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_course_daily_activity"
            )
        logger.info("mv_course_daily_activity refreshed")
    except asyncpg.UndefinedTableError:
        # Migration 20260720000000_professor_overview_daily_activity_mv.sql has
        # not been applied yet — skip silently so the worker starts cleanly in
        # local dev before the schema is in sync.
        logger.warning(
            "mv_course_daily_activity does not exist yet — "
            "run migration 20260720000000_professor_overview_daily_activity_mv.sql to create it"
        )
    except Exception as e:
        logger.error("mv_course_daily_activity refresh failed: %s", e, exc_info=True)


class WorkerSettings:
    functions = [parse_pdf_unified, generate_review_cards]
    cron_jobs = [
        cron(refresh_professor_overview_mv, minute={0, 10, 20, 30, 40, 50}, run_at_startup=True),
    ]
    on_startup = startup
    on_shutdown = shutdown

    # Roadmap P2-3: best-effort dead-letter capture for permanently-failed
    # jobs. See backend/workers/dlq.py for the lifecycle rationale (why
    # after_job_end, and the one case — crash-loop past max_tries — it can't
    # cover without patching arq internals).
    after_job_end = capture_dlq_on_job_end

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
