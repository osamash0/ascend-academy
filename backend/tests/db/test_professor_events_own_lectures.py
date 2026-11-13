"""A professor reads raw learning events only about their own lectures.

20261113000000_professor_events_own_lectures_only.sql: before it, a professor
read every event of every person enrolled in any of their courses (other
people's lectures, logins, searches). The older /professor/analytics screens
read with the professor's JWT and only ever ask for their own lecture's events,
so they keep working. The rollup and the pre-partitioning backup lose their
professor path. v4 reader questions stay out (test_learning_events_schema_db).
"""
from __future__ import annotations

import json
import uuid

import psycopg
import pytest

pytestmark = pytest.mark.db


def _as_user(cur, uid: uuid.UUID) -> None:
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', %s, false)", ("authenticated",))


def _reset_user(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


def _event(cur, user_id: uuid.UUID, event_type: str, data: dict) -> None:
    cur.execute(
        "INSERT INTO public.learning_events (user_id, event_type, event_data) VALUES (%s, %s, %s::jsonb)",
        (str(user_id), event_type, json.dumps(data)),
    )


@pytest.fixture
def two_professors(db_conn, make_user, make_lecture, make_course, make_course_enrollment):
    """prof owns course + lecture `mine`; `other_prof` owns lecture `theirs`.
    `student` is enrolled in prof's course and reads both lectures; `walk_in`
    reads prof's lecture without being enrolled."""
    prof = make_user(role="professor")
    other_prof = make_user(role="professor")
    student = make_user(role="student")
    walk_in = make_user(role="student")
    course = make_course(prof)
    make_course_enrollment(student, course)
    mine = make_lecture(prof)
    theirs = make_lecture(other_prof)
    with db_conn.cursor() as cur:
        _event(cur, student, "slide_view", {"lectureId": str(mine), "slideId": str(uuid.uuid4())})
        _event(cur, student, "slide_view", {"lectureId": str(theirs), "slideId": str(uuid.uuid4())})
        _event(cur, student, "login", {})
        _event(cur, walk_in, "slide_view", {"lectureId": str(mine), "slideId": str(uuid.uuid4())})
    return {"prof": prof, "other_prof": other_prof, "student": student, "walk_in": walk_in,
            "mine": mine, "theirs": theirs}


def _visible_events(db_conn, viewer: uuid.UUID, about: list[uuid.UUID]) -> list[tuple]:
    with db_conn.cursor() as cur:
        _as_user(cur, viewer)
        try:
            cur.execute(
                "SELECT user_id, event_type, event_data->>'lectureId' FROM public.learning_events"
                " WHERE user_id = ANY(%s::uuid[])",
                ([str(u) for u in about],),
            )
            return [(str(r[0]), r[1], r[2]) for r in cur.fetchall()]
        finally:
            _reset_user(cur)


def test_professor_sees_only_events_about_their_own_lecture(db_conn, two_professors):
    w = two_professors
    rows = _visible_events(db_conn, w["prof"], [w["student"], w["walk_in"]])
    assert rows == [(str(w["student"]), "slide_view", str(w["mine"]))]


def test_other_professor_sees_nothing_of_a_student_not_enrolled_with_them(db_conn, two_professors):
    w = two_professors
    assert _visible_events(db_conn, w["other_prof"], [w["student"], w["walk_in"]]) == []


def test_student_still_sees_all_their_own_events(db_conn, two_professors):
    w = two_professors
    rows = _visible_events(db_conn, w["student"], [w["student"]])
    assert sorted(r[1] for r in rows) == ["login", "slide_view", "slide_view"]


def test_only_the_narrowed_professor_policy_is_left(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'"
            " AND tablename IN ('learning_events', 'learning_events_daily_rollup', 'learning_events_legacy_20260721')"
            " AND policyname ILIKE 'professor%%'"
        )
        assert cur.fetchall() == [("learning_events", "Professors view events about their own lectures")]


def test_professor_reads_no_rollup_rows(db_conn, two_professors):
    w = two_professors
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.learning_events_daily_rollup (day, user_id, event_type, lecture_id, event_count)"
            " VALUES (current_date, %s, 'slide_view', %s, 3)",
            (str(w["student"]), str(w["mine"])),
        )
        _as_user(cur, w["prof"])
        try:
            cur.execute("SELECT count(*) FROM public.learning_events_daily_rollup WHERE user_id = %s",
                        (str(w["student"]),))
            assert cur.fetchone()[0] == 0
        finally:
            _reset_user(cur)


def test_signed_in_accounts_cannot_read_the_pre_partitioning_backup(db_conn, make_user):
    prof = make_user(role="professor")
    with db_conn.cursor() as cur:
        _as_user(cur, prof)
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT 1 FROM public.learning_events_legacy_20260721 LIMIT 1")
        finally:
            _reset_user(cur)
