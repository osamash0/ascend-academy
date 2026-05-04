"""APScheduler wrapper that runs the nudge engine once per day.

Kept in its own module so the import (and the apscheduler dep) is only paid
when the scheduler is explicitly enabled via ENABLE_NUDGE_SCHEDULER=1. The
backend test suite never imports this module.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from backend.services import nudge_engine

logger = logging.getLogger(__name__)

_scheduler = None


def start_scheduler():
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger
    except ImportError:
        logger.error("apscheduler not installed; cannot start nudge scheduler")
        return None

    hour = int(os.environ.get("NUDGE_RUN_HOUR_UTC", "13"))  # default ~9am ET
    sched = AsyncIOScheduler(timezone="UTC")
    sched.add_job(
        _run_safely,
        trigger=CronTrigger(hour=hour, minute=0),
        id="nudge_engine_daily",
        replace_existing=True,
        coalesce=True,
        misfire_grace_time=60 * 60,
    )
    sched.start()
    _scheduler = sched
    logger.info("Nudge scheduler started (daily at %02d:00 UTC)", hour)
    return sched


def _run_safely() -> None:
    try:
        report = nudge_engine.run_daily(now=datetime.now(timezone.utc))
        logger.info("Nudge run complete: %s", report)
    except Exception as e:
        logger.error("Nudge run failed: %s", e, exc_info=True)
