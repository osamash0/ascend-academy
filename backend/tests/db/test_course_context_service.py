"""DB tests for backend.services.course_context_service (Roadmap Phase 3,
"course brain"). Verifies the JSONB merge semantics for real against
Postgres — a plain unit test with a mocked connection wouldn't catch a
subtly-wrong SQL merge/upsert.

Gated behind the `db` marker (boots a real Postgres via testcontainers).
"""
from __future__ import annotations

import uuid

import pytest

from backend.services import course_context_service as ccs

pytestmark = pytest.mark.db


@pytest.fixture
async def wired_pool(pg_dsn, applied_migrations):
    """Point the app's global asyncpg pool at the throwaway container, the
    same pattern test_unified_pipeline_e2e.py uses for persist.py — needed
    because course_context_service goes through the same
    backend.core.database.get_db_connection() global pool."""
    import asyncpg
    import backend.core.database as core

    pool = await asyncpg.create_pool(pg_dsn, min_size=1, max_size=4, statement_cache_size=0)
    old = core.db_pool
    core.db_pool = pool
    try:
        yield pool
    finally:
        core.db_pool = old
        await pool.close()


async def test_get_returns_none_when_no_row(db_conn, wired_pool, make_user, make_course):
    prof = make_user(role="professor")
    course = make_course(prof)
    result = await ccs.get_course_context(course)
    assert result is None


async def test_upsert_creates_row_when_none_exists(db_conn, wired_pool, make_user, make_course):
    prof = make_user(role="professor")
    course = make_course(prof)
    await ccs.upsert_course_context_facts(course, {
        "instructor": "Prof. Ada",
        "exam_dates": [{"label": "Midterm", "date": "2026-06-01"}],
        "grading_scheme": "50% exam, 50% homework",
        "other_facts": {"textbook": "Intro to ML"},
    })
    result = await ccs.get_course_context(course)
    assert result["instructor"] == "Prof. Ada"
    assert result["exam_dates"] == [{"label": "Midterm", "date": "2026-06-01"}]
    assert result["grading_scheme"] == "50% exam, 50% homework"
    assert result["syllabus_facts"] == {"textbook": "Intro to ML"}


async def test_upsert_does_not_clobber_instructor_with_empty_value(db_conn, wired_pool, make_user, make_course):
    """A later lecture's admin slide with no instructor mentioned must not
    erase an instructor name a previous lecture already extracted."""
    prof = make_user(role="professor")
    course = make_course(prof)
    await ccs.upsert_course_context_facts(course, {"instructor": "Prof. Ada"})
    await ccs.upsert_course_context_facts(course, {"instructor": ""})
    result = await ccs.get_course_context(course)
    assert result["instructor"] == "Prof. Ada"


async def test_upsert_overwrites_instructor_with_new_non_empty_value(db_conn, wired_pool, make_user, make_course):
    prof = make_user(role="professor")
    course = make_course(prof)
    await ccs.upsert_course_context_facts(course, {"instructor": "Prof. Ada"})
    await ccs.upsert_course_context_facts(course, {"instructor": "Dr. Grace"})
    result = await ccs.get_course_context(course)
    assert result["instructor"] == "Dr. Grace"


async def test_upsert_accumulates_exam_dates_across_calls(db_conn, wired_pool, make_user, make_course):
    prof = make_user(role="professor")
    course = make_course(prof)
    await ccs.upsert_course_context_facts(course, {
        "exam_dates": [{"label": "Midterm", "date": "2026-06-01"}],
    })
    await ccs.upsert_course_context_facts(course, {
        "exam_dates": [{"label": "Final", "date": "2026-08-15"}],
    })
    result = await ccs.get_course_context(course)
    assert result["exam_dates"] == [
        {"label": "Midterm", "date": "2026-06-01"},
        {"label": "Final", "date": "2026-08-15"},
    ]


async def test_upsert_dedupes_identical_exam_dates(db_conn, wired_pool, make_user, make_course):
    prof = make_user(role="professor")
    course = make_course(prof)
    await ccs.upsert_course_context_facts(course, {
        "exam_dates": [{"label": "Midterm", "date": "2026-06-01"}],
    })
    await ccs.upsert_course_context_facts(course, {
        "exam_dates": [{"label": "Midterm", "date": "2026-06-01"}],
    })
    result = await ccs.get_course_context(course)
    assert result["exam_dates"] == [{"label": "Midterm", "date": "2026-06-01"}]


async def test_upsert_shallow_merges_syllabus_facts(db_conn, wired_pool, make_user, make_course):
    prof = make_user(role="professor")
    course = make_course(prof)
    await ccs.upsert_course_context_facts(course, {"other_facts": {"textbook": "Intro to ML"}})
    await ccs.upsert_course_context_facts(course, {"other_facts": {"office_hours": "Tue 2-4pm"}})
    result = await ccs.get_course_context(course)
    assert result["syllabus_facts"] == {"textbook": "Intro to ML", "office_hours": "Tue 2-4pm"}


async def test_replace_fields_is_authoritative_and_can_clear(db_conn, wired_pool, make_user, make_course):
    """Unlike upsert_course_context_facts, an explicit professor edit must be
    able to clear a field to empty — no merge-preserving semantics."""
    prof = make_user(role="professor")
    course = make_course(prof)
    await ccs.upsert_course_context_facts(course, {"instructor": "Prof. Ada"})
    result = await ccs.replace_course_context_fields(course, {"instructor": ""})
    assert result["instructor"] == ""


async def test_replace_fields_only_touches_provided_keys(db_conn, wired_pool, make_user, make_course):
    prof = make_user(role="professor")
    course = make_course(prof)
    await ccs.upsert_course_context_facts(course, {
        "instructor": "Prof. Ada", "grading_scheme": "50/50",
    })
    result = await ccs.replace_course_context_fields(course, {"instructor": "Dr. Grace"})
    assert result["instructor"] == "Dr. Grace"
    assert result["grading_scheme"] == "50/50"  # untouched


async def test_replace_fields_creates_row_when_none_exists(db_conn, wired_pool, make_user, make_course):
    prof = make_user(role="professor")
    course = make_course(prof)
    result = await ccs.replace_course_context_fields(course, {"instructor": "Prof. Ada"})
    assert result["instructor"] == "Prof. Ada"
