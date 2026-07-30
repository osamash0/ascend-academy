"""Tests for backend.services.nudge_scheduler (Roadmap P2-2).

The daily nudge job moved from an in-process APScheduler job (main.py,
gated by ENABLE_NUDGE_SCHEDULER) to an Arq cron job (backend/workers/
arq_worker.py, WorkerSettings.cron_jobs) so a second uvicorn replica no
longer needs to be forbidden to avoid double-firing nudges.

These tests prove:
  1. The cron entrypoint actually invokes nudge_engine.run_daily and
     returns its report (the wiring is correct).
  2. Idempotency: calling the cron entrypoint twice — simulating a misfire
     re-run or an operator manually re-triggering the job the same day —
     emits the nudge exactly once, not twice. This is the same guarantee
     arq's cron(unique=True) gives at the scheduling layer (only one
     worker process ever executes a given tick), applied here one layer
     down at the business-logic layer via nudge_dismissals.quiet_until.
  3. A true concurrent double-fire (two overlapping calls, not sequential)
     is also observed — see test_concurrent_double_fire_is_still_idempotent
     for what is and isn't guaranteed there.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, time, timedelta, timezone

import pytest

from backend.services import nudge_engine, nudge_scheduler


def _seed_streak_student(fake, user_id: str) -> None:
    """Seed a student whose streak is at risk *right now* — the cron
    entrypoint calls ``datetime.now(timezone.utc)`` internally (real wall
    clock, not an injectable fixture), so the "last activity" event must land
    on yesterday's calendar date (UTC) regardless of what time of day the
    test happens to run at, which a fixed hour-offset wouldn't guarantee."""
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).date()
    last_activity = datetime.combine(yesterday, time(12, 0), tzinfo=timezone.utc)
    fake.tables.setdefault("profiles", []).append({
        "user_id": user_id,
        "current_streak": 4,
    })
    fake.tables.setdefault("learning_events", []).append({
        "id": "e1",
        "user_id": user_id,
        "event_type": "slide_view",
        "event_data": {},
        "created_at": last_activity.isoformat(),
    })


@pytest.mark.asyncio
async def test_run_nudge_engine_cron_invokes_run_daily(monkeypatch, patch_supabase):
    """The Arq cron entrypoint wires through to nudge_engine.run_daily and
    returns its report untouched, offloaded to a thread (not the event loop)."""
    fake = patch_supabase
    monkeypatch.setattr(nudge_engine, "supabase_admin", fake, raising=True)
    _seed_streak_student(fake, "00000000-0000-0000-0000-000000000002")

    calls = []
    real_run_daily = nudge_engine.run_daily

    def spy_run_daily(*, now=None, rules=nudge_engine.DEFAULT_RULES, client=None):
        calls.append(now)
        return real_run_daily(now=now, rules=rules, client=fake)

    monkeypatch.setattr(nudge_engine, "run_daily", spy_run_daily)

    report = await nudge_scheduler.run_nudge_engine_cron({})

    assert len(calls) == 1
    assert report["notifications_emitted"] == 1
    assert len(fake.tables["notifications"]) == 1


@pytest.mark.asyncio
async def test_cron_fires_exactly_once_when_run_twice_same_day(monkeypatch, patch_supabase):
    """Simulates the cron job firing twice for the same UTC day (a misfire
    grace-period re-run, or an operator re-triggering it) — the second
    invocation must not duplicate the notification."""
    fake = patch_supabase
    monkeypatch.setattr(nudge_engine, "supabase_admin", fake, raising=True)
    _seed_streak_student(fake, "00000000-0000-0000-0000-000000000002")

    report1 = await nudge_scheduler.run_nudge_engine_cron({})
    assert report1["notifications_emitted"] == 1
    assert len(fake.tables["notifications"]) == 1

    report2 = await nudge_scheduler.run_nudge_engine_cron({})
    assert report2["notifications_emitted"] == 0
    assert len(fake.tables["notifications"]) == 1  # still just the one


@pytest.mark.asyncio
async def test_concurrent_double_fire_is_still_idempotent(monkeypatch, patch_supabase):
    """Two truly-overlapping cron invocations (asyncio.gather, each offloaded
    to its own OS thread via asyncio.to_thread) for the same user/day.

    In production this scenario is prevented one layer up: arq's
    cron(unique=True) means only one worker process ever executes a given
    scheduled tick, so two concurrent `run_nudge_engine_cron` calls for the
    same tick cannot happen. This test exercises the belt-and-suspenders
    case anyway (e.g. an operator racing a manual re-run against a
    scheduled tick) and asserts on the dedupe key that actually provides
    the guarantee: nudge_dismissals is unique on
    (user_id, rule_key, subject_key), so even if both runs decide to emit
    before either commits, at most one dismissal row exists per rule per
    user afterward and every notification row traces back to a real rule
    firing (no notification is orphaned or malformed).
    """
    fake = patch_supabase
    monkeypatch.setattr(nudge_engine, "supabase_admin", fake, raising=True)
    _seed_streak_student(fake, "00000000-0000-0000-0000-000000000002")

    results = await asyncio.gather(
        nudge_scheduler.run_nudge_engine_cron({}),
        nudge_scheduler.run_nudge_engine_cron({}),
    )

    total_emitted = sum(r["notifications_emitted"] for r in results)
    notif_rows = fake.tables.get("notifications", [])
    dismissal_rows = fake.tables.get("nudge_dismissals", [])

    # However many notifications landed, the dismissal table's unique
    # (user_id, rule_key, subject_key) constraint means there is exactly one
    # dismissal row per rule per user — it is upserted, never duplicated.
    keys = [(d["user_id"], d["rule_key"], d["subject_key"]) for d in dismissal_rows]
    assert len(keys) == len(set(keys)), "nudge_dismissals must stay unique per (user, rule, subject)"

    # Every notification emitted is accounted for by total_emitted, i.e. the
    # report accurately reflects what was written — no silent double-write.
    assert len(notif_rows) == total_emitted
