"""Pure-function unit tests for backend.services.scheduler.build_plan.

Covers the three rules called out in Task #35:
  1. Daily budget is respected.
  2. Assignment due dates take priority and are spread across the window.
  3. Weak concepts surface when concept-graph data is available.

Plus the graceful-degradation case (no assignments, no concepts → just
sequence in-progress lectures by least-recently-touched).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from backend.services import scheduler
from backend.services.scheduler import (
    AssignmentState,
    LectureState,
    UserState,
    WeakConcept,
    build_plan,
    parse_item_id,
)


TODAY = date(2026, 5, 4)  # a Monday


def _lec(lid: str, *, total=10, completed=0, last_days_ago: int | None = None) -> LectureState:
    last_touched = None
    if last_days_ago is not None:
        last_touched = datetime(2026, 5, 4, tzinfo=timezone.utc) - timedelta(days=last_days_ago)
    return LectureState(
        lecture_id=lid,
        title=f"Lecture {lid}",
        total_slides=total,
        completed_slides=completed,
        last_touched_at=last_touched,
    )


def _assign(aid: str, lecture_ids: list[str], *, due_in_days: int, completed=None) -> AssignmentState:
    due = datetime(2026, 5, 4, 9, 0, tzinfo=timezone.utc) + timedelta(days=due_in_days)
    return AssignmentState(
        assignment_id=aid,
        title=f"Assignment {aid}",
        due_at=due,
        lecture_ids=lecture_ids,
        completed_lecture_ids=completed or [],
    )


# ── Daily budget ─────────────────────────────────────────────────────────────

class TestDailyBudget:
    def test_respects_budget_per_day(self):
        # Budget = 30, item = 15 → at most 2 items per day.
        state = UserState(
            user_id="u1", today=TODAY,
            lectures=[
                _lec(f"L{i}", completed=1, last_days_ago=i) for i in range(1, 11)
            ],
        )
        plan = build_plan(state, days=7, budget=30)
        for d in plan.days:
            assert d.total_minutes <= 30, f"{d.date} over budget: {d.total_minutes}"
            assert len(d.items) <= 2

    def test_custom_budget_allows_more_items(self):
        state = UserState(
            user_id="u1", today=TODAY,
            lectures=[
                _lec(f"L{i}", completed=1, last_days_ago=i) for i in range(1, 11)
            ],
        )
        plan = build_plan(state, days=7, budget=60)
        # 60 / 15 = 4 items max per day.
        assert all(d.total_minutes <= 60 for d in plan.days)
        assert any(len(d.items) > 2 for d in plan.days)
        assert plan.budget_minutes == 60

    def test_returns_seven_days(self):
        plan = build_plan(UserState("u1", TODAY), days=7)
        assert len(plan.days) == 7
        assert plan.days[0].date == TODAY.isoformat()
        assert plan.days[-1].date == (TODAY + timedelta(days=6)).isoformat()


# ── Assignment priority ──────────────────────────────────────────────────────

class TestAssignmentPriority:
    def test_assignment_due_today_lands_today(self):
        state = UserState(
            user_id="u1", today=TODAY,
            lectures=[_lec("L1"), _lec("L2", completed=2, last_days_ago=10)],
            assignments=[_assign("A1", ["L1"], due_in_days=0)],
        )
        plan = build_plan(state, days=7)
        # Today must contain L1 from the assignment, marked priority=assignment.
        today_items = plan.days[0].items
        a_items = [i for i in today_items if i.priority == "assignment"]
        assert len(a_items) == 1
        assert a_items[0].lecture_id == "L1"
        assert "Due" in a_items[0].reason or "Overdue" in a_items[0].reason
        assert plan.has_assignments is True

    def test_assignment_spread_across_days_until_due(self):
        # Three lectures, due in 3 days → ideally one per day across the window.
        state = UserState(
            user_id="u1", today=TODAY,
            lectures=[_lec("L1"), _lec("L2"), _lec("L3")],
            assignments=[_assign("A1", ["L1", "L2", "L3"], due_in_days=2)],
        )
        plan = build_plan(state, days=7)
        # Within first 3 days each L should appear at most once and across
        # those 3 days we should see all 3 lectures.
        seen = set()
        for d in plan.days[:3]:
            for it in d.items:
                if it.priority == "assignment":
                    seen.add(it.lecture_id)
        assert seen == {"L1", "L2", "L3"}

    def test_completed_assignment_lectures_skipped(self):
        state = UserState(
            user_id="u1", today=TODAY,
            lectures=[_lec("L1", completed=10), _lec("L2")],  # L1 done
            assignments=[_assign("A1", ["L1", "L2"], due_in_days=2, completed=["L1"])],
        )
        plan = build_plan(state, days=7)
        a_lectures = {i.lecture_id for d in plan.days for i in d.items if i.priority == "assignment"}
        assert a_lectures == {"L2"}

    def test_overdue_assignment_lands_today(self):
        state = UserState(
            user_id="u1", today=TODAY,
            lectures=[_lec("L1")],
            assignments=[_assign("A1", ["L1"], due_in_days=-3)],
        )
        plan = build_plan(state, days=7)
        today_items = [i for i in plan.days[0].items if i.priority == "assignment"]
        assert len(today_items) == 1
        assert "Overdue" in today_items[0].reason


# ── Weak concept surfacing ───────────────────────────────────────────────────

class TestWeakConcepts:
    def test_weak_concept_schedules_review(self):
        state = UserState(
            user_id="u1", today=TODAY,
            lectures=[_lec("L1"), _lec("L2", completed=3, last_days_ago=2)],
            weak_concepts=[
                WeakConcept(
                    concept_id="C1",
                    name="Backpropagation",
                    mastery_score=0.2,
                    lecture_ids=["L1"],
                ),
            ],
        )
        plan = build_plan(state, days=7)
        weak_items = [i for d in plan.days for i in d.items if i.priority == "weak_concept"]
        assert len(weak_items) == 1
        assert weak_items[0].lecture_id == "L1"
        assert "Backpropagation" in weak_items[0].reason
        assert plan.has_weak_concepts is True

    def test_strong_concepts_not_scheduled(self):
        state = UserState(
            user_id="u1", today=TODAY,
            lectures=[_lec("L1")],
            weak_concepts=[
                WeakConcept("C1", "Easy", mastery_score=0.9, lecture_ids=["L1"]),
            ],
        )
        plan = build_plan(state, days=7)
        weak_items = [i for d in plan.days for i in d.items if i.priority == "weak_concept"]
        assert weak_items == []
        assert plan.has_weak_concepts is False

    def test_lowest_mastery_picked_first(self):
        # Two weak concepts; we cap at MAX_WEAK_CONCEPTS_PER_PLAN. Confirm
        # the lowest-mastery one wins when ranking matters.
        state = UserState(
            user_id="u1", today=TODAY,
            lectures=[_lec("L1"), _lec("L2")],
            weak_concepts=[
                WeakConcept("C1", "Mid",  mastery_score=0.45, lecture_ids=["L1"]),
                WeakConcept("C2", "Worst", mastery_score=0.05, lecture_ids=["L2"]),
            ],
        )
        plan = build_plan(state, days=1, budget=15)  # only 1 slot total
        weak = [i for d in plan.days for i in d.items if i.priority == "weak_concept"]
        assert len(weak) == 1
        assert weak[0].lecture_id == "L2"  # lowest mastery wins


# ── Graceful degradation ─────────────────────────────────────────────────────

class TestGracefulDegradation:
    def test_no_assignments_or_concepts_uses_lru(self):
        state = UserState(
            user_id="u1", today=TODAY,
            lectures=[
                _lec("Old",   completed=1, last_days_ago=30),
                _lec("Mid",   completed=1, last_days_ago=5),
                _lec("Fresh", completed=1, last_days_ago=1),
            ],
        )
        plan = build_plan(state, days=1, budget=15)
        # Single slot → least recently touched (Old) wins.
        items = plan.days[0].items
        assert len(items) == 1
        assert items[0].lecture_id == "Old"
        assert items[0].priority == "continue"

    def test_completed_today_filtered_from_today(self):
        state = UserState(
            user_id="u1", today=TODAY,
            lectures=[_lec("L1", completed=1, last_days_ago=2)],
            completed_today=["L1"],
        )
        plan = build_plan(state, days=2, budget=15)
        # Today is empty AND the lecture is suppressed from tomorrow as
        # well — completion has cross-day effect (the scheduler is honest
        # about what you've already done).
        assert plan.days[0].items == []
        assert all(i.lecture_id != "L1" for i in plan.days[1].items)

    def test_recent_completion_suppresses_future_days(self):
        # Even an in-progress lecture that we'd otherwise pick as filler
        # gets dropped if it was completed in the cooldown window.
        state = UserState(
            user_id="u1", today=TODAY,
            lectures=[
                _lec("L1", completed=2, last_days_ago=2),
                _lec("L2", completed=1, last_days_ago=5),
            ],
            recent_completions=["L1"],
        )
        plan = build_plan(state, days=3, budget=30)
        ids = {i.lecture_id for d in plan.days for i in d.items}
        assert "L1" not in ids
        assert "L2" in ids

    def test_completion_suppresses_assignment_lecture_too(self):
        state = UserState(
            user_id="u1", today=TODAY,
            lectures=[_lec("L1"), _lec("L2")],
            assignments=[_assign("A1", ["L1", "L2"], due_in_days=2)],
            completed_today=["L1"],
        )
        plan = build_plan(state, days=3, budget=30)
        ids = {i.lecture_id for d in plan.days for i in d.items}
        assert "L1" not in ids
        assert "L2" in ids

    def test_fully_complete_lectures_excluded(self):
        state = UserState(
            user_id="u1", today=TODAY,
            lectures=[_lec("Done", completed=10), _lec("Going", completed=2)],
        )
        plan = build_plan(state, days=3, budget=30)
        ids = {i.lecture_id for d in plan.days for i in d.items}
        assert "Done" not in ids

    def test_empty_state_returns_empty_days(self):
        plan = build_plan(UserState("u1", TODAY), days=3)
        assert len(plan.days) == 3
        assert all(d.items == [] for d in plan.days)
        assert plan.has_assignments is False
        assert plan.has_weak_concepts is False


# ── parse_item_id round-trip ─────────────────────────────────────────────────

class TestItemId:
    def test_round_trip(self):
        plan = build_plan(
            UserState(
                "u1", TODAY,
                lectures=[_lec("L1", completed=1, last_days_ago=1)],
            ),
            days=1,
        )
        item = plan.days[0].items[0]
        d, lid = parse_item_id(item.item_id)
        assert d == TODAY
        assert lid == "L1"

    def test_malformed_raises(self):
        with pytest.raises(ValueError):
            parse_item_id("bad-id")
        with pytest.raises(ValueError):
            parse_item_id("")
