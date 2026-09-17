"""Stuck-parse-run recovery (Milestone-4 R51/R52).

The unified pipeline (``unified_orchestrator.parse_pdf_unified``) only ever
writes two non-terminal ``parse_runs.status`` values: ``queued`` (enqueued,
not yet picked up) and ``extracting`` (a worker picked it up and is running
the *entire* pipeline under that one status — text extraction, per-slide
synthesis, deck quiz generation, finalization, poster rendering,
localization, concept-graph ingestion — there is no finer-grained status for
any of that; see that module's ``set_status`` call sites). If the coroutine
running that status is torn down without ever reaching its own
``except``/``finally`` blocks (the worker process is OOM-killed, the
container is restarted, etc.), the row is left in ``extracting`` forever with
``error`` still ``NULL`` — invisible to the user and to monitoring
(Milestone-4 R51/R52's live-verified finding: two lectures had already
extracted 127 and 32 slides respectively, but the owning run never
transitioned past ``extracting``).

An *ordinary* exception, or Arq cancelling a job for exceeding
``WorkerSettings.job_timeout``, no longer needs this module at all —
``parse_pdf_unified``'s own exception handler now also catches
``asyncio.CancelledError`` and marks the run FAILED with a real message
within one job_timeout cycle. This module is strictly the second line of
defense, for a process that never got the chance to run any handler.

Every function here is safe to call any number of times, including
concurrently with itself: reconciling an already-terminal run is a no-op, and
recovering a run with real slides only ever *reads* the true slide count and
finishes the transition — it never deletes, re-parses, or duplicates
anything. When nothing was ever persisted, the run is marked FAILED with a
real, user-facing error so it surfaces in the uploads panel and can be
retried from scratch (there is nothing to lose in that case).
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from backend.domain.parse_models import RunStatus
from backend.services.parser import persist, repos

logger = logging.getLogger(__name__)

NO_CONTENT_ERROR = "Processing stalled and no content was recovered. Please retry the upload."

# Waiting states — enqueued but never demonstrably picked up. 'pending' is a
# legacy value from pre-v3 rows (see RunStatus.PENDING); nothing writes it now.
WAITING_STATUSES = (RunStatus.QUEUED.value, RunStatus.PENDING.value)


async def reconcile_stalled_run(run_id: UUID, allow_recovery: bool = True) -> dict:
    """Reconcile one run. Returns a small dict describing what happened:

        {"action": "not_found"}                              — no such run
        {"action": "noop", "status": "completed"}             — already terminal
        {"action": "recovered", "slide_count": 127}           — finished the transition
        {"action": "failed_no_content"}                       — marked FAILED, nothing to recover

    ``allow_recovery=False`` disables the "complete it from the slides already
    persisted" path, leaving only the honest-failure path. Callers pass it for
    runs in a *waiting* status (``queued``/``pending``), where ``lecture_id``
    may still point at a PREVIOUS attempt's slides — completing from those
    would report another attempt's work as this one's. Only ``extracting``
    proves a worker actually ran this attempt, so only it can recover.
    """
    run = await repos.get_run_by_id(run_id)
    if run is None:
        return {"run_id": str(run_id), "action": "not_found"}

    if run.status in (RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED):
        return {"run_id": str(run_id), "action": "noop", "status": run.status.value}

    if allow_recovery and run.lecture_id is not None:
        slide_count = await persist.get_slide_count(run.lecture_id)
        if slide_count > 0:
            # The real work is done — just finish the transition. sync_total_slides
            # only ever touches lectures.total_slides (never description, unlike
            # finalize_lecture), so it can't clobber a deck_summary the crashed
            # run never got a chance to write.
            await persist.sync_total_slides(run.lecture_id)
            await repos.set_status(run_id, RunStatus.COMPLETED)
            logger.info(
                "reconcile_stalled_run: recovered run %s (lecture %s, %d slides already "
                "extracted) — only the terminal transition was missing",
                run_id, run.lecture_id, slide_count,
            )
            return {"run_id": str(run_id), "action": "recovered", "slide_count": slide_count}

    await repos.set_error(run_id, NO_CONTENT_ERROR)
    logger.warning("reconcile_stalled_run: no recoverable content for run %s — marked failed", run_id)
    return {"run_id": str(run_id), "action": "failed_no_content"}


async def reconcile_all_stalled(
    cutoff: datetime, queued_cutoff: Optional[datetime] = None,
) -> list[dict]:
    """Reconcile every stalled run. Each run is independent and best-effort —
    one failure never blocks the rest of the sweep. Used by the Arq cron job
    (backend/workers/arq_worker.py::reconcile_stalled_parse_runs).

    Two passes, because the two kinds of stall need different rules:

    * ``extracting`` older than ``cutoff`` — a worker demonstrably started this
      attempt, so recovery is allowed: if its lecture already holds slides, the
      run is completed with the true count.
    * ``queued``/``pending`` older than ``queued_cutoff`` — nothing proves a
      worker ever touched this attempt, and the row may just be waiting behind
      a real backlog. Swept only when ``queued_cutoff`` is given (callers pass
      a much longer threshold), and always fail-only.

    Omitting ``queued_cutoff`` reproduces the original extracting-only sweep.
    """
    results = []

    for run in await repos.list_stalled_extracting_runs(cutoff):
        try:
            results.append(await reconcile_stalled_run(run.run_id, allow_recovery=True))
        except Exception:
            logger.exception("reconcile_all_stalled: failed for run %s", run.run_id)
            results.append({"run_id": str(run.run_id), "action": "error"})

    if queued_cutoff is not None:
        for run in await repos.list_stalled_runs(WAITING_STATUSES, queued_cutoff):
            try:
                results.append(await reconcile_stalled_run(run.run_id, allow_recovery=False))
            except Exception:
                logger.exception("reconcile_all_stalled: failed for waiting run %s", run.run_id)
                results.append({"run_id": str(run.run_id), "action": "error"})

    return results
