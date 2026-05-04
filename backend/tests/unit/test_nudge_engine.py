"""Unit tests for the nudge engine rules + evaluator.

These tests construct UserContext directly so they don't touch Supabase —
the rule logic must be a pure function of the context.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.services.nudge_engine import (
    AssignmentDueSoonRule,
    Nudge,
    StreakAtRiskRule,
    UserContext,
    WeakConceptStaleRule,
    evaluate_user,
)


NOW = datetime(2026, 5, 2, 14, 0, 0, tzinfo=timezone.utc)


def _ctx(**kw) -> UserContext:
    base = dict(user_id="u1", now=NOW)
    base.update(kw)
    return UserContext(**base)


# ── StreakAtRiskRule ────────────────────────────────────────────────────────

class TestStreakAtRisk:
    def test_fires_when_last_activity_was_yesterday(self):
        ctx = _ctx(current_streak=5, last_activity_at=NOW - timedelta(hours=20))
        # 20h ago is the previous UTC day relative to NOW (14:00 UTC today)
        nudges = StreakAtRiskRule().should_fire(ctx)
        assert len(nudges) == 1
        assert nudges[0].rule_key == "streak_at_risk"
        assert "5-day streak" in nudges[0].message

    def test_silent_when_active_today(self):
        ctx = _ctx(current_streak=3, last_activity_at=NOW - timedelta(hours=1))
        assert StreakAtRiskRule().should_fire(ctx) == []

    def test_silent_when_no_streak(self):
        ctx = _ctx(current_streak=0, last_activity_at=NOW - timedelta(hours=20))
        assert StreakAtRiskRule().should_fire(ctx) == []

    def test_silent_when_streak_already_broken(self):
        # Last active >1 day ago — streak service has already reset it; not our job.
        ctx = _ctx(current_streak=5, last_activity_at=NOW - timedelta(days=3))
        assert StreakAtRiskRule().should_fire(ctx) == []

    def test_quiet_period_suppresses(self):
        ctx = _ctx(
            current_streak=5,
            last_activity_at=NOW - timedelta(hours=20),
            dismissals={("streak_at_risk", ""): NOW + timedelta(hours=2)},
        )
        assert evaluate_user(ctx, [StreakAtRiskRule()]) == []


# ── AssignmentDueSoonRule ───────────────────────────────────────────────────

class TestAssignmentDueSoon:
    def test_fires_for_open_assignment_due_in_window(self):
        a = {
            "id": "a1",
            "title": "Week 5",
            "due_at": (NOW + timedelta(hours=20)).isoformat(),
            "status": "in_progress",
        }
        nudges = AssignmentDueSoonRule().should_fire(_ctx(assignments=[a]))
        assert len(nudges) == 1
        assert nudges[0].subject_key == "a1"
        assert "Week 5" in nudges[0].message

    def test_silent_for_completed(self):
        a = {
            "id": "a1",
            "title": "Done",
            "due_at": (NOW + timedelta(hours=20)).isoformat(),
            "status": "completed",
        }
        assert AssignmentDueSoonRule().should_fire(_ctx(assignments=[a])) == []

    def test_silent_for_overdue(self):
        a = {
            "id": "a1",
            "title": "Late",
            "due_at": (NOW - timedelta(days=1)).isoformat(),
            "status": "overdue",
        }
        assert AssignmentDueSoonRule().should_fire(_ctx(assignments=[a])) == []

    def test_silent_for_due_far_out(self):
        a = {
            "id": "a1",
            "title": "Future",
            "due_at": (NOW + timedelta(days=10)).isoformat(),
            "status": "in_progress",
        }
        assert AssignmentDueSoonRule().should_fire(_ctx(assignments=[a])) == []

    def test_quiet_period_per_assignment(self):
        a = {
            "id": "a1",
            "title": "Hush",
            "due_at": (NOW + timedelta(hours=20)).isoformat(),
            "status": "in_progress",
        }
        ctx = _ctx(
            assignments=[a],
            dismissals={("assignment_due_soon", "a1"): NOW + timedelta(hours=4)},
        )
        assert evaluate_user(ctx, [AssignmentDueSoonRule()]) == []

    def test_today_priority_higher(self):
        soon = {
            "id": "a_today",
            "title": "Today",
            "due_at": (NOW + timedelta(hours=2)).isoformat(),
            "status": "in_progress",
        }
        later = {
            "id": "a_later",
            "title": "Later",
            "due_at": (NOW + timedelta(days=1, hours=2)).isoformat(),
            "status": "in_progress",
        }
        nudges = evaluate_user(_ctx(assignments=[later, soon]), [AssignmentDueSoonRule()])
        assert nudges[0].subject_key == "a_today"


# ── WeakConceptStaleRule ────────────────────────────────────────────────────

class TestWeakConceptStale:
    def test_fires_for_low_mastery_old(self):
        c = {
            "concept_id": "c1",
            "canonical_name": "Backprop",
            "mastery_score": 0.3,
            "updated_at_dt": NOW - timedelta(days=20),
        }
        nudges = WeakConceptStaleRule().should_fire(_ctx(weak_concepts=[c]))
        assert len(nudges) == 1
        assert nudges[0].subject_key == "c1"
        assert "Backprop" in nudges[0].message

    def test_silent_for_recent_review(self):
        c = {
            "concept_id": "c1",
            "canonical_name": "Backprop",
            "mastery_score": 0.3,
            "updated_at_dt": NOW - timedelta(days=2),
        }
        assert WeakConceptStaleRule().should_fire(_ctx(weak_concepts=[c])) == []

    def test_silent_for_mastered_concept(self):
        c = {
            "concept_id": "c1",
            "canonical_name": "OK",
            "mastery_score": 0.9,
            "updated_at_dt": NOW - timedelta(days=30),
        }
        assert WeakConceptStaleRule().should_fire(_ctx(weak_concepts=[c])) == []

    def test_quiet_period_suppresses(self):
        c = {
            "concept_id": "c1",
            "canonical_name": "X",
            "mastery_score": 0.2,
            "updated_at_dt": NOW - timedelta(days=20),
        }
        ctx = _ctx(
            weak_concepts=[c],
            dismissals={("weak_concept_stale", "c1"): NOW + timedelta(days=3)},
        )
        assert evaluate_user(ctx, [WeakConceptStaleRule()]) == []


# ── Evaluator ordering / safety ─────────────────────────────────────────────

class TestEvaluator:
    def test_results_sorted_by_priority_desc(self):
        a = {
            "id": "a1",
            "title": "Today",
            "due_at": (NOW + timedelta(hours=1)).isoformat(),
            "status": "in_progress",
        }
        c = {
            "concept_id": "c1",
            "canonical_name": "Stale",
            "mastery_score": 0.1,
            "updated_at_dt": NOW - timedelta(days=30),
        }
        ctx = _ctx(
            current_streak=4,
            last_activity_at=NOW - timedelta(hours=20),
            assignments=[a],
            weak_concepts=[c],
        )
        nudges = evaluate_user(ctx)
        # Highest-priority is the assignment-due-today (priority=90)
        assert nudges[0].rule_key == "assignment_due_soon"
        assert [n.priority for n in nudges] == sorted(
            (n.priority for n in nudges), reverse=True
        )

    def test_failing_rule_does_not_sink_run(self):
        class _Boom:
            key = "boom"

            def should_fire(self, ctx):
                raise RuntimeError("kaboom")

        ctx = _ctx(current_streak=3, last_activity_at=NOW - timedelta(hours=20))
        nudges = evaluate_user(ctx, [_Boom(), StreakAtRiskRule()])
        assert len(nudges) == 1
        assert nudges[0].rule_key == "streak_at_risk"
