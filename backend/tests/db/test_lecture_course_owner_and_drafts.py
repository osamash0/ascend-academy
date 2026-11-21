"""DB / RLS tests for three access gaps closed on 21 Nov 2026.

- 20261121000000: a lecture may only be attached (INSERT or UPDATE) to a
  course the caller owns; before, any signed-in account could add a lecture
  to another person's course through PostgREST.
- 20261121000100: slides of a lecture in a draft course are visible only to
  the course owner, the lecture owner, enrolled members and admins; before,
  any signed-in account could read (and list) a draft's slides.
- 20261121000200: a sign-up always yields the student role; before, a
  'professor' role requested in the client-controlled sign-up metadata was
  honoured.

Each test also checks the legitimate path that must keep working.
"""
from __future__ import annotations

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


def _insert_lecture_as(cur, uid, course_id, **cols) -> None:
    cols = {"id": str(uuid.uuid4()), "title": "L", "professor_id": str(uid), "course_id": course_id, **cols}
    names = ", ".join(cols)
    marks = ", ".join(["%s"] * len(cols))
    cur.execute(f"INSERT INTO public.lectures ({names}) VALUES ({marks})", tuple(cols.values()))


def _publish(cur, course_id) -> None:
    cur.execute("UPDATE public.courses SET status = 'published' WHERE id = %s", (str(course_id),))


def _visible_slide_ids(cur) -> set[str]:
    cur.execute("SELECT id FROM public.slides")
    return {str(r[0]) for r in cur.fetchall()}


# ── 20261121000000: course ownership on lecture writes ───────────────────────


def test_a_stranger_cannot_add_a_lecture_to_someone_elses_course(db_conn, make_user, make_course):
    owner, stranger = make_user(), make_user()
    course = make_course(owner)
    with db_conn.cursor() as cur:
        _publish(cur, course)
        _as_user(cur, stranger)
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                _insert_lecture_as(cur, stranger, str(course))
        finally:
            _reset_user(cur)


def test_the_owner_adds_lectures_to_their_own_course_and_outside_any_course(
    db_conn, make_user, make_course
):
    owner = make_user()
    course = make_course(owner)
    with db_conn.cursor() as cur:
        _as_user(cur, owner)
        try:
            _insert_lecture_as(cur, owner, str(course))
            _insert_lecture_as(cur, owner, None)
        finally:
            _reset_user(cur)
        cur.execute("SELECT count(*) FROM public.lectures WHERE professor_id = %s", (str(owner),))
        assert cur.fetchone()[0] == 2


def test_an_owner_cannot_move_a_lecture_into_someone_elses_course(
    db_conn, make_user, make_course, make_lecture
):
    owner, other = make_user(), make_user()
    foreign_course = make_course(other)
    lecture = make_lecture(owner)
    with db_conn.cursor() as cur:
        _as_user(cur, owner)
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute(
                    "UPDATE public.lectures SET course_id = %s WHERE id = %s",
                    (str(foreign_course), str(lecture)),
                )
        finally:
            _reset_user(cur)


def test_a_private_upload_cannot_be_attached_to_someone_elses_course(
    db_conn, make_user, make_course
):
    student, other = make_user(), make_user()
    foreign_course = make_course(other)
    with db_conn.cursor() as cur:
        _as_user(cur, student)
        try:
            # The personal path still works: no course.
            _insert_lecture_as(
                cur, None, None, professor_id=None, student_owner_id=str(student),
                visibility="private_student",
            )
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                _insert_lecture_as(
                    cur, None, str(foreign_course), professor_id=None,
                    student_owner_id=str(student), visibility="private_student",
                )
        finally:
            _reset_user(cur)


# ── 20261121000100: draft courses keep their slides to themselves ───────────


def test_a_drafts_slides_are_hidden_from_strangers_but_not_from_owner_member_or_admin(
    db_conn, make_user, make_course, make_lecture, make_slide, make_course_enrollment
):
    owner, stranger, member, admin = make_user(), make_user(), make_user(), make_user(role="admin")
    draft = make_course(owner)  # courses.status defaults to 'draft'
    lecture = make_lecture(owner)
    with db_conn.cursor() as cur:
        cur.execute("UPDATE public.lectures SET course_id = %s WHERE id = %s", (str(draft), str(lecture)))
    slide = str(make_slide(lecture))
    make_course_enrollment(member, draft)

    seen = {}
    with db_conn.cursor() as cur:
        for name, uid in (("owner", owner), ("stranger", stranger), ("member", member), ("admin", admin)):
            _as_user(cur, uid)
            try:
                seen[name] = slide in _visible_slide_ids(cur)
            finally:
                _reset_user(cur)
    assert seen == {"owner": True, "stranger": False, "member": True, "admin": True}


def test_a_published_courses_slides_stay_open_to_every_signed_in_user(
    db_conn, make_user, make_course, make_lecture, make_slide
):
    owner, stranger = make_user(), make_user()
    course = make_course(owner)
    lecture = make_lecture(owner)
    with db_conn.cursor() as cur:
        _publish(cur, course)
        cur.execute("UPDATE public.lectures SET course_id = %s WHERE id = %s", (str(course), str(lecture)))
    slide = str(make_slide(lecture))
    with db_conn.cursor() as cur:
        _as_user(cur, stranger)
        try:
            assert slide in _visible_slide_ids(cur)
        finally:
            _reset_user(cur)


def test_a_lecture_outside_any_course_behaves_as_before(db_conn, make_user, make_lecture, make_slide):
    owner, stranger = make_user(), make_user()
    slide = str(make_slide(make_lecture(owner)))
    with db_conn.cursor() as cur:
        _as_user(cur, stranger)
        try:
            assert slide in _visible_slide_ids(cur)
        finally:
            _reset_user(cur)


# ── 20261121000200: sign-up never grants professor ──────────────────────────


@pytest.mark.parametrize("requested", ["professor", "admin", "student", None])
def test_sign_up_always_yields_the_student_role(db_conn, requested):
    uid = uuid.uuid4()
    meta = "{}" if requested is None else f'{{"role": "{requested}"}}'
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (%s, %s, %s::jsonb)",
            (str(uid), f"s-{uid}@test.local", meta),
        )
        cur.execute("SELECT role::text FROM public.user_roles WHERE user_id = %s", (str(uid),))
        assert [r[0] for r in cur.fetchall()] == ["student"]
        cur.execute("SELECT count(*) FROM public.profiles WHERE user_id = %s", (str(uid),))
        assert cur.fetchone()[0] == 1
