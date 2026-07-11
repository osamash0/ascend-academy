"""DB regression tests for the global-search RPCs
(20260710030000_global_search.sql).

`match_slides_scoped` / `search_slides_keyword` / `search_lectures_keyword`
have no RLS of their own — they're called by the backend's service-role
connection, exactly like the pre-existing `match_slides`. The authorization
boundary is the `scoped_course_ids` array the Python layer computes from the
caller's enrollments (see `search_service._resolve_scope_course_ids`).

These tests assert the *SQL* half of that contract: given a `scoped_course_ids`
array, the RPCs never return a row from a course outside it, and never
return a row from an archived lecture inside it — regardless of how
similar/matching that row would otherwise be. This is what roadmap 2.2's
acceptance criterion ("results never include unenrolled or unpublished
content") reduces to once Python correctly resolves enrollment.

Gated behind the `db` marker (boots a real Postgres via testcontainers).
"""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.db

EMBED_DIM = 768


def _vec(seed: float) -> str:
    """A deterministic 768-dim pgvector literal, e.g. '[0.1,0.1,...]'."""
    return "[" + ",".join([str(seed)] * EMBED_DIM) + "]"


@pytest.fixture
def make_slide_embedding(db_conn):
    def _make(lecture_id: uuid.UUID, slide_index: int, seed: float = 0.1) -> uuid.UUID:
        eid = uuid.uuid4()
        with db_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO slide_embeddings (id, lecture_id, slide_index, embedding, content_hash)
                VALUES (%s, %s, %s, %s::vector, %s)
                """,
                (str(eid), str(lecture_id), slide_index, _vec(seed), str(uuid.uuid4())),
            )
        return eid

    return _make


def _set_course(db_conn, lecture_id: uuid.UUID, course_id: uuid.UUID) -> None:
    with db_conn.cursor() as cur:
        cur.execute(
            "UPDATE public.lectures SET course_id = %s WHERE id = %s",
            (str(course_id), str(lecture_id)),
        )


def _archive_lecture(db_conn, lecture_id: uuid.UUID) -> None:
    with db_conn.cursor() as cur:
        cur.execute(
            "UPDATE public.lectures SET is_archived = true WHERE id = %s",
            (str(lecture_id),),
        )


# ── match_slides_scoped ──────────────────────────────────────────────────────


def test_match_slides_scoped_excludes_other_courses(
    db_conn, make_user, make_lecture, make_course, make_slide_embedding
):
    prof = make_user(role="professor")
    course_a = make_course(prof, "Course A")
    course_b = make_course(prof, "Course B")
    lec_a = make_lecture(prof, "Lecture A")
    lec_b = make_lecture(prof, "Lecture B")
    _set_course(db_conn, lec_a, course_a)
    _set_course(db_conn, lec_b, course_b)

    # Identical embeddings — if scoping leaked, B would tie A on similarity.
    make_slide_embedding(lec_a, 0, seed=0.1)
    make_slide_embedding(lec_b, 0, seed=0.1)

    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT lecture_id FROM match_slides_scoped(%s::vector, %s, 0.0, 10)",
            (_vec(0.1), [str(course_a)]),
        )
        rows = {r[0] for r in cur.fetchall()}

    assert rows == {lec_a}
    assert lec_b not in rows


def test_match_slides_scoped_excludes_archived_lecture(
    db_conn, make_user, make_lecture, make_course, make_slide_embedding
):
    prof = make_user(role="professor")
    course = make_course(prof)
    lec_active = make_lecture(prof, "Active")
    lec_archived = make_lecture(prof, "Archived")
    _set_course(db_conn, lec_active, course)
    _set_course(db_conn, lec_archived, course)
    _archive_lecture(db_conn, lec_archived)

    make_slide_embedding(lec_active, 0, seed=0.2)
    make_slide_embedding(lec_archived, 0, seed=0.2)

    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT lecture_id FROM match_slides_scoped(%s::vector, %s, 0.0, 10)",
            (_vec(0.2), [str(course)]),
        )
        rows = {r[0] for r in cur.fetchall()}

    assert rows == {lec_active}


def test_match_slides_scoped_empty_scope_returns_nothing(
    db_conn, make_user, make_lecture, make_course, make_slide_embedding
):
    prof = make_user(role="professor")
    course = make_course(prof)
    lec = make_lecture(prof)
    _set_course(db_conn, lec, course)
    make_slide_embedding(lec, 0, seed=0.3)

    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT lecture_id FROM match_slides_scoped(%s::vector, %s, 0.0, 10)",
            (_vec(0.3), []),
        )
        rows = cur.fetchall()

    assert rows == []


# ── search_slides_keyword ────────────────────────────────────────────────────


def test_search_slides_keyword_scoped_excludes_other_courses(
    db_conn, make_user, make_lecture, make_course, make_slide
):
    prof = make_user(role="professor")
    course_a = make_course(prof, "Course A")
    course_b = make_course(prof, "Course B")
    lec_a = make_lecture(prof, "Lecture A")
    lec_b = make_lecture(prof, "Lecture B")
    _set_course(db_conn, lec_a, course_a)
    _set_course(db_conn, lec_b, course_b)

    with db_conn.cursor() as cur:
        cur.execute(
            "UPDATE public.slides SET title = 'Mitochondria', content_text = 'Mitochondria is the powerhouse.' "
            "WHERE id = %s",
            (str(make_slide(lec_a, 1)),),
        )
        cur.execute(
            "UPDATE public.slides SET title = 'Mitochondria', content_text = 'Mitochondria is the powerhouse.' "
            "WHERE id = %s",
            (str(make_slide(lec_b, 1)),),
        )

        cur.execute(
            "SELECT lecture_id FROM search_slides_keyword('mitochondria', %s, 10)",
            ([str(course_a)],),
        )
        rows = {r[0] for r in cur.fetchall()}

    assert rows == {lec_a}
    assert lec_b not in rows


def test_search_lectures_keyword_scoped(db_conn, make_user, make_lecture, make_course):
    prof = make_user(role="professor")
    course_a = make_course(prof, "Course A")
    course_b = make_course(prof, "Course B")
    lec_a = make_lecture(prof, "Thermodynamics Basics")
    lec_b = make_lecture(prof, "Thermodynamics Advanced")
    _set_course(db_conn, lec_a, course_a)
    _set_course(db_conn, lec_b, course_b)

    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM search_lectures_keyword('thermodynamics', %s, 10)",
            ([str(course_a)],),
        )
        rows = {r[0] for r in cur.fetchall()}

    assert rows == {lec_a}
    assert lec_b not in rows
