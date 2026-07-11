"""DB tests for backend.services.study_guide_service (Roadmap Phase 4.4).
Verifies the aggregation + caching/idempotency logic for real against
Postgres — a mocked-connection unit test wouldn't catch a subtly-wrong SQL
join or upsert.

Gated behind the `db` marker (boots a real Postgres via testcontainers).
"""
from __future__ import annotations

import uuid

import pytest

from backend.services import study_guide_service as sgs

pytestmark = pytest.mark.db


@pytest.fixture
async def wired_pool(pg_dsn, applied_migrations):
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


async def _async_empty(*_a, **_k) -> dict:
    return {}


def _attach_lecture(db_conn, make_lecture, prof, course, title: str) -> uuid.UUID:
    """make_lecture() alone does not assign course_id — attach it explicitly
    so the study guide's course-scoped lecture query actually picks it up."""
    lecture = make_lecture(prof, title=title)
    with db_conn.cursor() as cur:
        cur.execute("UPDATE lectures SET course_id = %s WHERE id = %s", (str(course), str(lecture)))
    return lecture


def _make_concept_lecture(db_conn, name: str, lecture_id: uuid.UUID) -> str:
    # The testcontainer DB persists across tests within the session, and
    # concepts.name_key is globally UNIQUE — suffix with a fresh uuid so
    # concept names never collide across test functions. Returns the actual
    # (suffixed) name so callers can assert against it.
    unique_name = f"{name} {uuid.uuid4()}"
    cid = uuid.uuid4()
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.concepts (id, canonical_name, name_key) VALUES (%s, %s, %s)",
            (str(cid), unique_name, unique_name.lower()),
        )
        cur.execute(
            "INSERT INTO public.concept_lectures (concept_id, lecture_id) VALUES (%s, %s)",
            (str(cid), str(lecture_id)),
        )
    return unique_name


async def test_generates_guide_with_synopses_and_concepts(
    db_conn, wired_pool, make_user, make_course, make_lecture, monkeypatch,
):
    prof = make_user(role="professor")
    course = make_course(prof)
    lecture = make_lecture(prof, title="Intro to ML")
    with db_conn.cursor() as cur:
        cur.execute(
            "UPDATE lectures SET course_id = %s, description = %s WHERE id = %s",
            (str(course), "Covers supervised learning basics.", str(lecture)),
        )
    concept_name = _make_concept_lecture(db_conn, "Gradient Descent", lecture)

    async def fake_define(concepts, ai_model):
        return {c: f"Definition of {c}." for c in concepts}

    monkeypatch.setattr(sgs, "_define_concepts", fake_define)

    guide = await sgs.get_or_generate_study_guide(course)

    assert guide["lectures"] == [
        {"lecture_id": str(lecture), "title": "Intro to ML", "synopsis": "Covers supervised learning basics."}
    ]
    assert guide["concepts"] == [{"name": concept_name, "definition": f"Definition of {concept_name}."}]
    assert guide["course_facts"] == {"instructor": None, "exam_dates": [], "grading_scheme": None}


async def test_includes_course_context_facts(
    db_conn, wired_pool, make_user, make_course, make_lecture, monkeypatch,
):
    from backend.services import course_context_service as ccs

    prof = make_user(role="professor")
    course = make_course(prof)
    _attach_lecture(db_conn, make_lecture, prof, course, "L1")
    await ccs.upsert_course_context_facts(course, {"instructor": "Prof. Ada", "grading_scheme": "50/50"})
    monkeypatch.setattr(sgs, "_define_concepts", _async_empty)

    guide = await sgs.get_or_generate_study_guide(course)
    assert guide["course_facts"]["instructor"] == "Prof. Ada"
    assert guide["course_facts"]["grading_scheme"] == "50/50"


async def test_second_call_with_unchanged_lectures_is_cached_not_regenerated(
    db_conn, wired_pool, make_user, make_course, make_lecture, monkeypatch,
):
    prof = make_user(role="professor")
    course = make_course(prof)
    _attach_lecture(db_conn, make_lecture, prof, course, "L1")

    calls = {"n": 0}

    async def counting_define(concepts, ai_model):
        calls["n"] += 1
        return {}

    monkeypatch.setattr(sgs, "_define_concepts", counting_define)

    first = await sgs.get_or_generate_study_guide(course)
    second = await sgs.get_or_generate_study_guide(course)

    assert calls["n"] == 1  # LLM call only ran once, second call served from cache
    assert first == second


async def test_adding_a_lecture_triggers_regeneration(
    db_conn, wired_pool, make_user, make_course, make_lecture, monkeypatch,
):
    prof = make_user(role="professor")
    course = make_course(prof)
    _attach_lecture(db_conn, make_lecture, prof, course, "L1")
    monkeypatch.setattr(sgs, "_define_concepts", _async_empty)

    first = await sgs.get_or_generate_study_guide(course)
    assert len(first["lectures"]) == 1

    lec2 = make_lecture(prof, title="L2")
    with db_conn.cursor() as cur:
        cur.execute("UPDATE lectures SET course_id = %s WHERE id = %s", (str(course), str(lec2)))

    second = await sgs.get_or_generate_study_guide(course)
    assert len(second["lectures"]) == 2  # regenerated, not stale-cached


async def test_force_regenerate_reruns_even_when_lecture_count_unchanged(
    db_conn, wired_pool, make_user, make_course, make_lecture, monkeypatch,
):
    prof = make_user(role="professor")
    course = make_course(prof)
    _attach_lecture(db_conn, make_lecture, prof, course, "L1")

    calls = {"n": 0}

    async def counting_define(concepts, ai_model):
        calls["n"] += 1
        return {}

    monkeypatch.setattr(sgs, "_define_concepts", counting_define)

    await sgs.get_or_generate_study_guide(course)
    await sgs.get_or_generate_study_guide(course, force_regenerate=True)

    assert calls["n"] == 2


async def test_regeneration_does_not_duplicate_sections(
    db_conn, wired_pool, make_user, make_course, make_lecture, monkeypatch,
):
    """Roadmap AC: regenerating after new uploads is idempotent (no
    duplicated sections) — an upsert, not an append."""
    prof = make_user(role="professor")
    course = make_course(prof)
    _attach_lecture(db_conn, make_lecture, prof, course, "L1")
    monkeypatch.setattr(sgs, "_define_concepts", _async_empty)

    await sgs.get_or_generate_study_guide(course, force_regenerate=True)
    await sgs.get_or_generate_study_guide(course, force_regenerate=True)

    with db_conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM study_guides WHERE course_id = %s", (str(course),))
        assert cur.fetchone()[0] == 1  # one row, not accumulating


async def test_no_concepts_skips_definition_llm_call_entirely(
    db_conn, wired_pool, make_user, make_course, make_lecture, monkeypatch,
):
    prof = make_user(role="professor")
    course = make_course(prof)
    _attach_lecture(db_conn, make_lecture, prof, course, "L1")  # no concept_lectures rows

    # Patch the underlying LLM call, not _define_concepts itself, so the
    # empty-list short-circuit inside _define_concepts is what's under test.
    async def fake_generate_text(prompt, ai_model="cerebras"):
        raise AssertionError("generate_text must not be called when there are no concepts")

    monkeypatch.setattr(sgs, "generate_text", fake_generate_text)

    guide = await sgs.get_or_generate_study_guide(course)
    assert guide["concepts"] == []


async def test_definition_failure_is_non_fatal(
    db_conn, wired_pool, make_user, make_course, make_lecture, monkeypatch,
):
    prof = make_user(role="professor")
    course = make_course(prof)
    lecture = make_lecture(prof, title="L1")
    with db_conn.cursor() as cur:
        cur.execute("UPDATE lectures SET course_id = %s WHERE id = %s", (str(course), str(lecture)))
    concept_name = _make_concept_lecture(db_conn, "Gradient Descent", lecture)

    async def failing_generate_text(prompt, ai_model="cerebras"):
        raise RuntimeError("LLM unavailable")

    monkeypatch.setattr(sgs, "generate_text", failing_generate_text)

    guide = await sgs.get_or_generate_study_guide(course)
    assert guide["concepts"] == [{"name": concept_name, "definition": ""}]
