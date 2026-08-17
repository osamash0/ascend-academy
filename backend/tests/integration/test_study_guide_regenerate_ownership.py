"""Ownership guard for the study-guide `?regenerate=true` side effect.

`GET /api/courses/{id}/study-guide` is readable by anyone who can see the
course -- the owner, and any student the course is published+visible to. That
is correct and stays that way.

`?regenerate=true` is a different operation wearing a GET's clothes. It sets
`force_regenerate`, which skips the cache (study_guide_service.py), spends an
LLM call, and overwrites the *single shared* `study_guides` row that every
other student on the course reads. Before this guard the endpoint depended on
`verify_token` only, so any enrolled student could trigger it from a browser
address bar -- 20x/minute per the rate limit -- billing the project and
clobbering everyone else's cached guide.

The gate is ownership, not role. `require_creator` would not do: it resolves
to `require_role("professor", "student")`, so it admits the enrolled student
this test exercises *and* a wholly unrelated professor. What actually matters
is `courses.professor_id == caller`, the same predicate `delete_course` uses.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient

from backend.core.auth_middleware import security, verify_token

COURSE_ID = "11111111-1111-4111-8111-111111111111"


@pytest.fixture
def client(app):
    return TestClient(app)


@pytest.fixture(autouse=True)
def _enable_feature(monkeypatch):
    """The endpoint 404s unless FEATURE_STUDY_GUIDE is on."""
    from backend.core import config

    monkeypatch.setattr(config.settings, "feature_study_guide", True, raising=False)


@pytest.fixture(autouse=True)
def generated(monkeypatch):
    """Record every call to the generator instead of running an LLM.

    Returning a list lets each test assert not just the status code but
    whether the expensive, shared-state-mutating path actually ran.
    """
    calls: list[bool] = []

    async def _fake(course_id, *, force_regenerate=False, ai_model="cerebras"):
        calls.append(force_regenerate)
        return {"sections": [], "course_id": str(course_id)}

    import backend.services.study_guide_service as svc

    monkeypatch.setattr(svc, "get_or_generate_study_guide", _fake)
    return calls


def _auth_as(app, user: SimpleNamespace) -> None:
    app.dependency_overrides[verify_token] = lambda: user
    app.dependency_overrides[security] = lambda: HTTPAuthorizationCredentials(
        scheme="Bearer", credentials="fake-token"
    )


def _seed_course(fake, *, professor_id: str, status: str = "published") -> None:
    fake.table("courses").insert(
        {
            "id": COURSE_ID,
            "professor_id": professor_id,
            "title": "Databases",
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


def _enroll(fake, user_id: str) -> None:
    fake.table("course_enrollments").insert(
        {"course_id": COURSE_ID, "user_id": user_id}
    ).execute()


def test_enrolled_student_can_read_the_study_guide(
    client, app, fake_supabase, professor_user, student_user, generated
):
    """Baseline: the guard must not break legitimate student reads."""
    _seed_course(fake_supabase, professor_id=professor_user.id)
    _enroll(fake_supabase, student_user.id)
    _auth_as(app, student_user)

    r = client.get(f"/api/courses/{COURSE_ID}/study-guide")

    assert r.status_code == 200, r.text
    assert generated == [False], "a plain read must not force regeneration"


def test_enrolled_student_cannot_force_regenerate(
    client, app, fake_supabase, professor_user, student_user, generated
):
    """The bug: ?regenerate=true was reachable by any enrolled student."""
    _seed_course(fake_supabase, professor_id=professor_user.id)
    _enroll(fake_supabase, student_user.id)
    _auth_as(app, student_user)

    r = client.get(f"/api/courses/{COURSE_ID}/study-guide?regenerate=true")

    assert r.status_code == 403, (
        "unauthorized regenerate: an enrolled non-owner forced an LLM call and "
        f"overwrote the shared study_guides row (got {r.status_code})"
    )
    assert generated == [], "generator ran despite the 403"


def test_unrelated_professor_cannot_force_regenerate(
    client, app, fake_supabase, professor_user, other_professor_user, generated
):
    """Why ownership and not role: a *different* professor is still not the owner.

    This is the case `require_creator` would have let through -- it checks the
    caller holds the professor/student role, never that they own this course.
    """
    _seed_course(fake_supabase, professor_id=professor_user.id)
    _enroll(fake_supabase, other_professor_user.id)
    _auth_as(app, other_professor_user)

    r = client.get(f"/api/courses/{COURSE_ID}/study-guide?regenerate=true")

    assert r.status_code == 403, r.text
    assert generated == [], "generator ran for a non-owning professor"


def test_owner_can_still_force_regenerate(
    client, app, fake_supabase, professor_user, generated
):
    """The guard must not lock the owner out of their own course."""
    _seed_course(fake_supabase, professor_id=professor_user.id, status="draft")
    _auth_as(app, professor_user)

    r = client.get(f"/api/courses/{COURSE_ID}/study-guide?regenerate=true")

    assert r.status_code == 200, r.text
    assert generated == [True], "owner's regenerate did not reach the generator"
