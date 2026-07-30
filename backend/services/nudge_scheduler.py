"""Daily nudge engine runner.

Roadmap P2-2: this used to be an in-process APScheduler job started from
``backend/main.py``'s FastAPI startup event. That's why prod pinned
``uvicorn --workers 1`` (docker-compose.prod.yml) — APScheduler has no
leader election, so a second web replica would double-fire every nudge.

The job now runs as an Arq **cron job** in the worker process instead
(``backend/workers/arq_worker.py``'s ``WorkerSettings.cron_jobs``). Two
reasons this is the right home:
  - The worker is already the place background/scheduled work lives — the
    web tier stays request-response only.
  - Arq's ``cron(..., unique=True)`` (the default) dedupes cron execution
    across every worker process sharing the same queue Redis, so it does
    not reintroduce the "N replicas double-fire" problem even if the
    worker itself is ever scaled beyond one instance.

``run_daily`` itself is additionally idempotent per (user, rule, subject,
UTC day) via the ``nudge_dismissals.quiet_until`` gate — see
backend/tests/integration/test_nudge_engine_runner.py and
backend/tests/unit/test_nudge_scheduler.py for tests proving a second/misfired
run in the same window emits zero duplicate notifications.

``start_scheduler`` (APScheduler) is kept below, unused, for anyone running
the API standalone without the Arq worker (e.g. a bare-metal dev box) — it
is no longer wired into ``backend/main.py``'s startup event.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone

from backend.services import nudge_engine

logger = logging.getLogger(__name__)

# Same env vars the old APScheduler wiring used — no ops/deploy config churn
# required beyond moving which process (api vs worker) reads them.
NUDGE_CRON_ENABLED = os.environ.get("ENABLE_NUDGE_SCHEDULER") == "1"
NUDGE_RUN_HOUR_UTC = int(os.environ.get("NUDGE_RUN_HOUR_UTC", "13"))  # default ~9am ET


async def run_nudge_engine_cron(ctx: dict) -> dict:
    """Arq cron entrypoint (registered in arq_worker.WorkerSettings.cron_jobs).

    ``nudge_engine.run_daily`` is a synchronous function that makes many
    blocking Supabase REST calls (one run per active user, several queries
    each) — it is offloaded to a thread rather than awaited directly so it
    doesn't block the worker's event loop, which also needs to keep polling
    for PDF-parse / review-card jobs while this runs.
    """
    now = datetime.now(timezone.utc)
    try:
        report = await asyncio.to_thread(nudge_engine.run_daily, now=now)
        logger.info("Nudge cron run complete: %s", report)
        return report
    except Exception as e:
        logger.error("Nudge cron run failed: %s", e, exc_info=True)
        raise


# ── Legacy APScheduler path (unused; kept for standalone/no-worker setups) ───

_scheduler = None


def start_scheduler():
    """Deprecated: superseded by the Arq cron job above. No longer called
    from backend/main.py. Left in place only for a hypothetical deployment
    that runs the API without the Arq worker process at all."""
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger
    except ImportError:
        logger.error("apscheduler not installed; cannot start nudge scheduler")
        return None

    sched = AsyncIOScheduler(timezone="UTC")
    sched.add_job(
        _run_safely,
        trigger=CronTrigger(hour=NUDGE_RUN_HOUR_UTC, minute=0),
        id="nudge_engine_daily",
        replace_existing=True,
        coalesce=True,
        misfire_grace_time=60 * 60,
    )
    sched.start()
    _scheduler = sched
    logger.info("Nudge scheduler started (daily at %02d:00 UTC)", NUDGE_RUN_HOUR_UTC)
    return sched


def _run_safely() -> None:
    try:
        report = nudge_engine.run_daily(now=datetime.now(timezone.utc))
        logger.info("Nudge run complete: %s", report)
    except Exception as e:
        logger.error("Nudge run failed: %s", e, exc_info=True)
