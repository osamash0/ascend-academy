"""DB / RLS regression tests for 20261127120000_close_three_rls_holes.sql.

Each hole was found on prod by a read-only pg_catalog probe on 2026-11-11;
prod's policies on these tables matched the repository's, so a fresh
database reproduces them. Every test checks both sides: the path the
migration closes, and the legitimate path that must keep working.

  1. lectures: an owner cannot put a lesson into someone else's Space, by
     INSERT or by UPDATE; their own Space and no Space still work.
  2. lecture-posters: a poster is readable exactly when its lesson is.
  3. course_enrollments: self-enrolment only into published, unarchived
     courses.

Gated behind the `db` marker (real Postgres; runs on PRs touching
migrations and nightly).
"""
from __future__ import annotations

import uuid

import psycopg
import pytest

pytestmark = pytest.mark.db


def _as(cur, uid: uuid.UUID) -> None:
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', 'authenticated', false)")


def _reset(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


def _set_course(cur, course_id: uuid.UUID, *, status: str, archived: bool = False) -> None:
    cur.execute(
        "UPDATE public.courses SET status = %s, is_archived = %s WHERE id = %s",
        (status, archived, str(course_id)),
    )


def _course_lecture(cur, owner: uuid.UUID, course_id: uuid.UUID) -> uuid.UUID:
    lid = uuid.uuid4()
    cur.execute(
        "INSERT INTO public.lectures (id, title, professor_id, course_id, total_slides) "
        "VALUES (%s, 'L', %s, %s, 1)",
        (str(lid), str(owner), str(course_id)),
    )
    return lid


def _private_lecture(cur, student: uuid.UUID) -> uuid.UUID:
    lid = uuid.uuid4()
    cur.execute(
        "INSERT INTO public.lectures (id, title, student_owner_id, visibility, total_slides) "
        "VALUES (%s, 'P', %s, 'private_student', 1)",
        (str(lid), str(student)),
    )
    return lid


def _poster(cur, lid: uuid.UUID) -> str:
    key = f"lectures/{lid}/poster.webp"
    cur.execute(
        "INSERT INTO storage.objects (bucket_id, name) VALUES ('lecture-posters', %s)", (key,)
    )
    return key


def _sees_poster(cur, key: str) -> bool:
    cur.execute(
        "SELECT 1 FROM storage.objects WHERE bucket_id = 'lecture-posters' AND name = %s",
        (key,),
    )
    return cur.fetchone() is not None


# ── 1. lectures: writes stay inside the writer's own Spaces ─────────────────

def test_owner_cannot_insert_lesson_into_someone_elses_space(db_conn, make_user, make_course):
    victim = make_user(role="professor")
    attacker = make_user(role="professor")
    victims_space = make_course(victim)

    with db_conn.cursor() as cur:
        _as(cur, attacker)
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute(
                    "INSERT INTO public.lectures (id, title, professor_id, course_id, total_slides) "
                    "VALUES (%s, 'planted', %s, %s, 1)",
                    (str(uuid.uuid4()), str(attacker), str(victims_space)),
                )
        finally:
            _reset(cur)


def test_owner_can_insert_lesson_into_own_space_or_none(db_conn, make_user, make_course):
    owner = make_user(role="professor")
    space = make_course(owner)

    with db_conn.cursor() as cur:
        _as(cur, owner)
        try:
            for course_id in (str(space), None):
                cur.execute(
                    "INSERT INTO public.lectures (id, title, professor_id, course_id, total_slides) "
                    "VALUES (%s, 'mine', %s, %s, 1)",
                    (str(uuid.uuid4()), str(owner), course_id),
                )
                assert cur.rowcount == 1
        finally:
            _reset(cur)


def test_owner_cannot_move_own_lesson_into_someone_elses_space(db_conn, make_user, make_course):
    victim = make_user(role="professor")
    attacker = make_user(role="professor")
    victims_space = make_course(victim)
    attackers_space = make_course(attacker)

    with db_conn.cursor() as cur:
        lid = _course_lecture(cur, attacker, attackers_space)
        _as(cur, attacker)
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute(
                    "UPDATE public.lectures SET course_id = %s WHERE id = %s",
                    (str(victims_space), str(lid)),
                )
        finally:
            _reset(cur)

        cur.execute("SELECT course_id FROM public.lectures WHERE id = %s", (str(lid),))
        assert cur.fetchone()[0] == attackers_space


def test_owner_can_still_edit_own_lesson(db_conn, make_user, make_course):
    owner = make_user(role="professor")
    space = make_course(owner)

    with db_conn.cursor() as cur:
        lid = _course_lecture(cur, owner, space)
        _as(cur, owner)
        try:
            cur.execute(
                "UPDATE public.lectures SET title = 'renamed' WHERE id = %s", (str(lid),)
            )
            assert cur.rowcount == 1
        finally:
            _reset(cur)


# ── 2. lecture-posters: a poster follows its lesson ─────────────────────────

def test_poster_is_hidden_from_a_stranger(db_conn, make_user, make_course):
    owner = make_user(role="professor")
    stranger = make_user(role="student")
    space = make_course(owner)

    with db_conn.cursor() as cur:
        key = _poster(cur, _course_lecture(cur, owner, space))
        _as(cur, stranger)
        try:
            assert not _sees_poster(cur, key)
        finally:
            _reset(cur)


def test_poster_is_visible_to_owner_and_member(db_conn, make_user, make_course,
                                                make_course_enrollment):
    owner = make_user(role="professor")
    member = make_user(role="student")
    space = make_course(owner)
    make_course_enrollment(member, space)

    with db_conn.cursor() as cur:
        key = _poster(cur, _course_lecture(cur, owner, space))
        for uid in (owner, member):
            _as(cur, uid)
            try:
                assert _sees_poster(cur, key)
            finally:
                _reset(cur)


def test_private_upload_poster_is_its_owners_alone(db_conn, make_user):
    uploader = make_user(role="student")
    other = make_user(role="student")

    with db_conn.cursor() as cur:
        key = _poster(cur, _private_lecture(cur, uploader))
        _as(cur, uploader)
        try:
            assert _sees_poster(cur, key)
        finally:
            _reset(cur)
        _as(cur, other)
        try:
            assert not _sees_poster(cur, key)
        finally:
            _reset(cur)


def test_poster_outside_the_lecture_key_layout_is_unreadable(db_conn, make_user):
    user = make_user(role="student")

    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO storage.objects (bucket_id, name) VALUES ('lecture-posters', 'stray.webp')"
        )
        _as(cur, user)
        try:
            assert not _sees_poster(cur, "stray.webp")
        finally:
            _reset(cur)


def test_malformed_lecture_key_is_unreadable_not_an_error(db_conn, make_user):
    # 36 dashes would pass a loose [0-9a-f-]{36} check and then fail the
    # ::uuid cast, breaking every poster read that scans the row.
    user = make_user(role="student")
    key = f"lectures/{'-' * 36}/poster.webp"

    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO storage.objects (bucket_id, name) VALUES ('lecture-posters', %s)", (key,)
        )
        _as(cur, user)
        try:
            assert not _sees_poster(cur, key)
        finally:
            _reset(cur)


# ── 3. course_enrollments: self-enrolment only where join_space would ──────

def _self_enrol(cur, student: uuid.UUID, course_id: uuid.UUID) -> None:
    _as(cur, student)
    try:
        cur.execute(
            "INSERT INTO public.course_enrollments (user_id, course_id) VALUES (%s, %s)",
            (str(student), str(course_id)),
        )
    finally:
        _reset(cur)


@pytest.mark.parametrize("status,archived", [("draft", False), ("published", True)])
def test_student_cannot_self_enrol_in_a_closed_space(
    db_conn, make_user, make_course, status, archived
):
    owner = make_user(role="professor")
    student = make_user(role="student")
    space = make_course(owner)

    with db_conn.cursor() as cur:
        _set_course(cur, space, status=status, archived=archived)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            _self_enrol(cur, student, space)


def test_student_can_self_enrol_in_a_published_space(db_conn, make_user, make_course):
    owner = make_user(role="professor")
    student = make_user(role="student")
    space = make_course(owner)

    with db_conn.cursor() as cur:
        _set_course(cur, space, status="published")
        _self_enrol(cur, student, space)
        cur.execute(
            "SELECT 1 FROM public.course_enrollments WHERE user_id = %s AND course_id = %s",
            (str(student), str(space)),
        )
        assert cur.fetchone() is not None
