"""Unit tests for the professor exam-aggregate suppression boundary
(backend/services/exam_service.py::get_course_exam_aggregate).

A fake asyncpg connection stands in here (only `.fetch()` is exercised, and
asyncpg Record objects support the same `r["col"]` access as a plain dict) —
no real Postgres needed for this pure aggregation logic, unlike the `-m db`
integration tests that exercise the actual RLS/schema.
"""
from __future__ import annotations

import json

import pytest

from backend.services.exam_service import MIN_ATTEMPTS_FOR_AGGREGATE, get_course_exam_aggregate


class _FakeConn:
    def __init__(self, rows):
        self._rows = rows

    async def fetch(self, query, *args):
        return self._rows


def _attempt(user_id, score, weakest_concepts=None):
    return {
        "user_id": user_id,
        "score": score,
        "concept_report": json.dumps({"weakest_concepts": weakest_concepts or []}),
    }


@pytest.mark.asyncio
async def test_suppressed_below_minimum_distinct_students():
    rows = [_attempt(f"user-{i}", 80.0) for i in range(MIN_ATTEMPTS_FOR_AGGREGATE - 1)]
    conn = _FakeConn(rows)
    result = await get_course_exam_aggregate(conn, "course-1")
    assert result is None


@pytest.mark.asyncio
async def test_returns_aggregate_at_minimum_distinct_students():
    rows = [_attempt(f"user-{i}", 80.0) for i in range(MIN_ATTEMPTS_FOR_AGGREGATE)]
    conn = _FakeConn(rows)
    result = await get_course_exam_aggregate(conn, "course-1")
    assert result is not None
    assert result["n"] == MIN_ATTEMPTS_FOR_AGGREGATE
    assert result["mean_score"] == 80.0


@pytest.mark.asyncio
async def test_never_exposes_a_single_students_row():
    rows = [_attempt(f"user-{i}", 80.0 + i) for i in range(MIN_ATTEMPTS_FOR_AGGREGATE)]
    conn = _FakeConn(rows)
    result = await get_course_exam_aggregate(conn, "course-1")
    assert "user_id" not in json.dumps(result)
    assert set(result.keys()) == {"n", "total_attempts", "mean_score", "weakest_concepts"}


@pytest.mark.asyncio
async def test_weakest_concepts_aggregate_across_students():
    rows = [
        _attempt("user-0", 50.0, [{"concept": "Recursion", "correct": 1, "total": 4}]),
        _attempt("user-1", 60.0, [{"concept": "Recursion", "correct": 2, "total": 4}]),
        _attempt("user-2", 90.0, [{"concept": "Loops", "correct": 4, "total": 5}]),
        _attempt("user-3", 95.0, []),
        _attempt("user-4", 100.0, []),
    ]
    conn = _FakeConn(rows)
    result = await get_course_exam_aggregate(conn, "course-1")
    assert result["weakest_concepts"][0]["concept"] == "Recursion"
    assert result["weakest_concepts"][0]["total_attempts"] == 8
    assert result["weakest_concepts"][0]["miss_rate"] == pytest.approx(1 - 3 / 8, abs=0.01)


@pytest.mark.asyncio
async def test_counts_distinct_students_not_total_attempts():
    """Same student submitting 3 exams still counts as 1 toward the n floor."""
    rows = [_attempt("user-0", 80.0) for _ in range(10)]
    conn = _FakeConn(rows)
    result = await get_course_exam_aggregate(conn, "course-1")
    assert result is None  # only 1 distinct student, far below the floor
