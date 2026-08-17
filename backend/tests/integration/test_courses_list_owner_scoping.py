"""Regression guard for the `list_courses` ownership leak (commit 7c3af43).

Why this file exists, given `backend/tests/db/test_courses_rls_boundary.py`
already covers the same bug: that suite asserts the boundary at the Postgres
layer and is genuinely valuable for proving the RLS *ceiling* is too wide --
migration 20260719020000 ("Authenticated users browse published courses") is
permissive and ORs together with the ownership policies, so every published
course is RLS-visible to every authenticated caller.

But its `_list_courses_filtered_ids` helper *re-states* list_courses's filter
as raw SQL and the module imports only `uuid` and `pytest` -- it never calls
the endpoint. So it stays green even if `list_courses` drops its `.or_()`
call entirely, which is precisely the regression it appears to guard.

These tests drive the endpoint itself through the FastAPI app, against a fake
Supabase that applies no RLS. That inversion is the point: with no RLS ceiling
to hide behind, the *only* thing keeping professor B's course out of professor
A's list is list_courses's own `.or_(...)` filter. Remove it and these fail.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient

from backend.core.auth_middleware import require_professor, security, verify_token


@pytest.fixture
def client(app):
    return TestClient(app)


def _auth_as(app, user: SimpleNamespace) -> None:
    app.dependency_overrides[verify_token] = lambda: user
    # list_courses also depends on `security` (HTTPBearer) to build the
    # RLS-enforcing per-user client -- override it too, or these tests 500
    # for want of an Authorization header.
    app.dependency_overrides[security] = lambda: HTTPAuthorizationCredentials(
        scheme="Bearer", credentials="fake-token"
    )
    role = (user.app_metadata or {}).get("role")
    if role == "professor":
        app.dependency_overrides[require_professor] = lambda: user
    else:
        app.dependency_overrides.pop(require_professor, None)


def _seed_user_role(fake, uid: str, role: str) -> None:
    fake.table("user_roles").insert({"user_id": uid, "role": role}).execute()


def _seed_course(fake, *, course_id: str, professor_id: str, title: str, status: str = "draft") -> str:
    fake.table("courses").insert(
        {
            "id": course_id,
            "professor_id": professor_id,
            "title": title,
            "description": None,
            "color": None,
            "icon": None,
            "is_archived": False,
            "status": status,
            "demo_slug": None,
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
        }
    ).execute()
    return course_id


def _listed_ids(client: TestClient) -> set[str]:
    r = client.get("/api/courses")
    assert r.status_code == 200, r.text
    return {c["id"] for c in r.json()["data"]}


def test_list_courses_excludes_other_professors_published_course(
    client, app, fake_supabase, professor_user, other_professor_user
):
    """The leak itself: A's "my courses" must not contain B's published course.

    A has no ownership of and no enrollment in B's course. The only reason it
    ever appeared was list_courses trusting RLS to scope the query for it.
    """
    _auth_as(app, professor_user)
    _seed_user_role(fake_supabase, professor_user.id, "professor")
    _seed_user_role(fake_supabase, other_professor_user.id, "professor")

    own = _seed_course(
        fake_supabase, course_id="course-a", professor_id=professor_user.id, title="A's own course"
    )
    other = _seed_course(
        fake_supabase,
        course_id="course-b",
        professor_id=other_professor_user.id,
        title="B's published course",
        status="published",
    )

    ids = _listed_ids(client)

    assert own in ids, "professor A's own course went missing from their list"
    assert other not in ids, (
        "list_courses leak: professor A's course list includes professor B's "
        f"unrelated published course {other}"
    )


def test_list_courses_excludes_other_professors_draft_course(
    client, app, fake_supabase, professor_user, other_professor_user
):
    """Same scoping must hold for non-published rows.

    Guards against a narrower "fix" that filters on `status` rather than on
    ownership -- that would close the reported symptom while leaving the
    endpoint unscoped.
    """
    _auth_as(app, professor_user)
    _seed_user_role(fake_supabase, professor_user.id, "professor")

    own = _seed_course(
        fake_supabase, course_id="course-a", professor_id=professor_user.id, title="A's own course"
    )
    other = _seed_course(
        fake_supabase,
        course_id="course-b-draft",
        professor_id=other_professor_user.id,
        title="B's draft course",
    )

    ids = _listed_ids(client)

    assert own in ids
    assert other not in ids


def test_list_courses_still_includes_course_the_caller_is_enrolled_in(
    client, app, fake_supabase, student_user, professor_user
):
    """The other half of the contract: don't over-narrow to own rows only.

    A fix of "filter to professor_id == uid" alone would pass the two tests
    above and silently break every student's course list. Exactly one
    enrolled course is seeded here on purpose -- see the note in
    test_list_courses_enrolled_and_owned_together below.
    """
    _auth_as(app, student_user)
    _seed_user_role(fake_supabase, student_user.id, "student")

    enrolled = _seed_course(
        fake_supabase,
        course_id="course-enrolled",
        professor_id=professor_user.id,
        title="Course the student is enrolled in",
        status="published",
    )
    unrelated = _seed_course(
        fake_supabase,
        course_id="course-unrelated",
        professor_id=professor_user.id,
        title="Published course the student is NOT enrolled in",
        status="published",
    )
    fake_supabase.table("course_enrollments").insert(
        {"user_id": student_user.id, "course_id": enrolled}
    ).execute()

    ids = _listed_ids(client)

    assert enrolled in ids, "enrolled course missing -- list_courses over-narrowed"
    assert unrelated not in ids, (
        "list_courses leak: student sees a published course they are not enrolled in"
    )


def test_list_courses_returns_own_and_enrolled_together(
    client, app, fake_supabase, professor_user, other_professor_user
):
    """A creator who is also enrolled elsewhere sees both, per the docstring.

    Two enrolled courses are seeded deliberately: `list_courses` renders them
    as a single `id.in.(a,b)` clause, and that multi-id case is the one
    `fake_supabase`'s or-filter parser used to get wrong -- it split the
    filter string on every comma, so only the first id survived. See
    backend/tests/unit/test_fake_supabase_or_filter.py.
    """
    _auth_as(app, professor_user)
    _seed_user_role(fake_supabase, professor_user.id, "professor")

    own = _seed_course(
        fake_supabase, course_id="course-own", professor_id=professor_user.id, title="Own course"
    )
    enrolled_first = _seed_course(
        fake_supabase,
        course_id="course-enrolled-1",
        professor_id=other_professor_user.id,
        title="First course enrolled in elsewhere",
        status="published",
    )
    enrolled_second = _seed_course(
        fake_supabase,
        course_id="course-enrolled-2",
        professor_id=other_professor_user.id,
        title="Second course enrolled in elsewhere",
        status="published",
    )
    unrelated = _seed_course(
        fake_supabase,
        course_id="course-unrelated",
        professor_id=other_professor_user.id,
        title="Published course with no relationship to the caller",
        status="published",
    )
    for cid in (enrolled_first, enrolled_second):
        fake_supabase.table("course_enrollments").insert(
            {"user_id": professor_user.id, "course_id": cid}
        ).execute()

    ids = _listed_ids(client)

    assert own in ids
    assert enrolled_first in ids
    assert enrolled_second in ids, (
        "second enrolled course missing -- the id.in.(...) clause is only "
        "honouring its first id"
    )
    assert unrelated not in ids
