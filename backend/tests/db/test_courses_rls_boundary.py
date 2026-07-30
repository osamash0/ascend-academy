"""DB / RLS regression tests for P2-1 (Foundation 10x roadmap, §7):
"Make RLS the API authorization boundary."

`backend/api/v1/courses.py::list_courses` and `::browse_courses` used to
fetch every row with the service-role `supabase_admin` client and
re-implement student visibility in Python (`_student_visible_course_ids`,
now only still used by `get_course` / `exams.py` / `search_service.py`).
Both endpoints are now converted to query through the RLS-enforcing
per-user client (`analytics_service.get_auth_client`), so the `courses`
table's own SELECT policies are the actual authorization boundary. These
tests assert that boundary directly at the Postgres layer -- independent of
the FastAPI/service-role bypass, and independent of the in-memory
`fake_supabase` test double used by the unit/integration suite (which has no
RLS engine and so cannot exercise this at all; see the docstring on
`test_list_courses_smoke_for_student` in
backend/tests/integration/test_courses_endpoints.py for that limitation).

Covers:
  - A student with NO enrollment of any kind sees zero rows of another
    professor's unpublished/private course (the acceptance criterion named
    explicitly in the roadmap: "a non-enrolled student sees zero rows").
  - A student explicitly enrolled via `course_enrollments` sees that course.
  - A student enrolled only via the legacy assignment->lecture path sees the
    course that lecture belongs to.
  - The owning professor always sees their own course, published or not.
  - Migration 20260719020000's public-catalog policy: any authenticated user
    sees a published, non-archived course regardless of enrollment, but NOT
    a draft or archived one (this is what `browse_courses` now relies on
    instead of its old `user_roles`-derived Python filter).

Gated behind the `db` marker (boots a real Postgres via testcontainers).
Real-Postgres verification (this sandbox has no Docker): applied bootstrap +
all migrations to a scratch Homebrew Postgres 18 database by hand and ran the
equivalent SELECT-as-role checks directly -- see the commit message for the
transcript summary.
"""
from __future__ import annotations

import uuid

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


def _visible_course_ids(cur) -> set[str]:
    cur.execute("SELECT id FROM public.courses")
    return {str(row[0]) for row in cur.fetchall()}


def _make_assignment_enrollment(cur, professor_id, user_id, lecture_id) -> None:
    """Enroll a student in a lecture via the legacy assignment path (mirrors
    test_course_context_rls.py / test_rls_policies.py)."""
    aid = uuid.uuid4()
    cur.execute(
        "INSERT INTO public.assignments (id, professor_id, title, due_at) "
        "VALUES (%s, %s, 'A', now() + interval '7 days')",
        (str(aid), str(professor_id)),
    )
    cur.execute(
        "INSERT INTO public.assignment_lectures (assignment_id, lecture_id) VALUES (%s, %s)",
        (str(aid), str(lecture_id)),
    )
    cur.execute(
        "INSERT INTO public.assignment_enrollments (assignment_id, user_id) VALUES (%s, %s)",
        (str(aid), str(user_id)),
    )


# ── Core acceptance criterion: non-enrolled student sees zero rows ─────────


def test_non_enrolled_student_sees_zero_rows_of_private_course(
    db_conn, make_user, make_course
):
    """
    The central P2-1 acceptance criterion: a student with no enrollment of
    any kind (no course_enrollments row, no assignment covering any of the
    course's lectures) must see NOTHING when querying `courses` as
    `authenticated`, for a course that is neither published nor theirs.
    """
    professor = make_user(role="professor")
    student = make_user(role="student")
    course = make_course(professor, title="Private Draft Course")
    # Explicitly a draft, unpublished course (courses.status defaults to
    # 'draft' per 20260713000000_creator_uploads.sql).
    with db_conn.cursor() as cur:
        cur.execute("SELECT status FROM public.courses WHERE id = %s", (str(course),))
        assert cur.fetchone()[0] == "draft"

    with db_conn.cursor() as cur:
        _as_user(cur, student)
        try:
            visible = _visible_course_ids(cur)
        finally:
            _reset_user(cur)

    assert str(course) not in visible, (
        f"RLS leak: non-enrolled student {student} can see private course "
        f"{course} owned by professor {professor}"
    )


def test_owning_professor_always_sees_own_course(db_conn, make_user, make_course):
    professor = make_user(role="professor")
    course = make_course(professor, title="My Draft")

    with db_conn.cursor() as cur:
        _as_user(cur, professor)
        try:
            visible = _visible_course_ids(cur)
        finally:
            _reset_user(cur)

    assert str(course) in visible


def test_student_enrolled_via_course_enrollments_sees_course(
    db_conn, make_user, make_course, make_course_enrollment
):
    professor = make_user(role="professor")
    student = make_user(role="student")
    course = make_course(professor, title="Enrolled via course_enrollments")
    make_course_enrollment(student, course)

    with db_conn.cursor() as cur:
        _as_user(cur, student)
        try:
            visible = _visible_course_ids(cur)
        finally:
            _reset_user(cur)

    assert str(course) in visible


def test_student_enrolled_via_assignment_lecture_sees_course(
    db_conn, make_user, make_course, make_lecture
):
    professor = make_user(role="professor")
    student = make_user(role="student")
    course = make_course(professor, title="Enrolled via assignment")
    lecture = make_lecture(professor, title="L1")
    with db_conn.cursor() as cur:
        cur.execute(
            "UPDATE public.lectures SET course_id = %s WHERE id = %s",
            (str(course), str(lecture)),
        )
    with db_conn.cursor() as cur:
        _make_assignment_enrollment(cur, professor, student, lecture)

    with db_conn.cursor() as cur:
        _as_user(cur, student)
        try:
            visible = _visible_course_ids(cur)
        finally:
            _reset_user(cur)

    assert str(course) in visible


# ── Migration 20260719020000: public catalog policy (browse_courses) ────────


def test_any_authenticated_user_sees_published_non_archived_course(
    db_conn, make_user, make_course
):
    """
    browse_courses's new RLS-backed catalog: ANY authenticated user (not just
    an enrolled one) sees a published, non-archived course -- this is what
    replaced the old `user_roles`-derived Python filter.
    """
    professor = make_user(role="professor")
    bystander = make_user(role="student")
    course = make_course(professor, title="Published Catalog Course")
    with db_conn.cursor() as cur:
        cur.execute(
            "UPDATE public.courses SET status = 'published' WHERE id = %s",
            (str(course),),
        )

    with db_conn.cursor() as cur:
        _as_user(cur, bystander)
        try:
            visible = _visible_course_ids(cur)
        finally:
            _reset_user(cur)

    assert str(course) in visible, (
        "published, non-archived course should be visible to any "
        "authenticated user via the 20260719020000 catalog policy"
    )


def test_draft_course_not_in_public_catalog_for_bystander(db_conn, make_user, make_course):
    professor = make_user(role="professor")
    bystander = make_user(role="student")
    course = make_course(professor, title="Still a draft")
    # make_course leaves status at its column default ('draft').

    with db_conn.cursor() as cur:
        _as_user(cur, bystander)
        try:
            visible = _visible_course_ids(cur)
        finally:
            _reset_user(cur)

    assert str(course) not in visible


def test_archived_published_course_not_in_public_catalog_for_bystander(
    db_conn, make_user, make_course
):
    professor = make_user(role="professor")
    bystander = make_user(role="student")
    course = make_course(professor, title="Published but archived")
    with db_conn.cursor() as cur:
        cur.execute(
            "UPDATE public.courses SET status = 'published', is_archived = true "
            "WHERE id = %s",
            (str(course),),
        )

    with db_conn.cursor() as cur:
        _as_user(cur, bystander)
        try:
            visible = _visible_course_ids(cur)
        finally:
            _reset_user(cur)

    assert str(course) not in visible
