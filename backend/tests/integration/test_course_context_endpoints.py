"""Integration tests for GET/PATCH /api/courses/{id}/context (Roadmap Phase 3,
"course brain"). Ownership/visibility checks go through the fake Supabase
client (mirroring _fetch_course / _student_visible_course_ids); the actual
data layer (backend.services.course_context_service, asyncpg-backed) is
mocked here since its own merge/JSONB semantics are verified for real against
Postgres in backend/tests/db/test_course_context_service.py.
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import verify_token, require_professor


@pytest.fixture
def client(app):
    return TestClient(app)


def _auth_as(app, user: SimpleNamespace) -> None:
    app.dependency_overrides[verify_token] = lambda: user
    role = (user.app_metadata or {}).get("role")
    if role == "professor":
        app.dependency_overrides[require_professor] = lambda: user
    else:
        app.dependency_overrides.pop(require_professor, None)


def _seed_course(fake, course_id: str, professor_id: str) -> None:
    fake.table("courses").insert({
        "id": course_id, "professor_id": professor_id, "title": "C",
        "is_archived": False,
    }).execute()


def _new_course_id() -> str:
    return str(uuid.uuid4())


def test_owner_gets_none_when_no_context_extracted_yet(client, app, fake_supabase, professor_user, monkeypatch):
    course_id = _new_course_id()
    _auth_as(app, professor_user)
    _seed_course(fake_supabase, course_id, professor_user.id)

    import backend.services.course_context_service as ccs

    async def fake_get(cid):
        return None

    monkeypatch.setattr(ccs, "get_course_context", fake_get)

    r = client.get(f"/api/courses/{course_id}/context")
    assert r.status_code == 200
    assert r.json()["data"] is None


def test_owner_gets_extracted_context(client, app, fake_supabase, professor_user, monkeypatch):
    course_id = _new_course_id()
    _auth_as(app, professor_user)
    _seed_course(fake_supabase, course_id, professor_user.id)

    import backend.services.course_context_service as ccs

    async def fake_get(cid):
        return {
            "course_id": str(cid), "instructor": "Prof. Ada", "exam_dates": [],
            "syllabus_facts": {}, "grading_scheme": None, "updated_at": None,
        }

    monkeypatch.setattr(ccs, "get_course_context", fake_get)

    r = client.get(f"/api/courses/{course_id}/context")
    assert r.status_code == 200
    assert r.json()["data"]["instructor"] == "Prof. Ada"


def test_non_visible_student_gets_403(client, app, fake_supabase, student_user):
    course_id = _new_course_id()
    _auth_as(app, student_user)
    _seed_course(fake_supabase, course_id, "00000000-0000-0000-0000-000000000099")
    # No course_enrollments / assignment_enrollments seeded -> not visible.

    r = client.get(f"/api/courses/{course_id}/context")
    assert r.status_code == 403


def test_enrolled_student_can_see_context(client, app, fake_supabase, student_user, monkeypatch):
    course_id = _new_course_id()
    _auth_as(app, student_user)
    _seed_course(fake_supabase, course_id, "00000000-0000-0000-0000-000000000099")
    fake_supabase.table("course_enrollments").insert({
        "user_id": student_user.id, "course_id": course_id,
    }).execute()

    import backend.services.course_context_service as ccs

    async def fake_get(cid):
        return {
            "course_id": str(cid), "instructor": "Prof. Ada", "exam_dates": [],
            "syllabus_facts": {}, "grading_scheme": None, "updated_at": None,
        }

    monkeypatch.setattr(ccs, "get_course_context", fake_get)

    r = client.get(f"/api/courses/{course_id}/context")
    assert r.status_code == 200
    assert r.json()["data"]["instructor"] == "Prof. Ada"


def test_missing_course_returns_404_on_get(client, app, fake_supabase, professor_user):
    _auth_as(app, professor_user)
    r = client.get(f"/api/courses/{_new_course_id()}/context")
    assert r.status_code == 404


def test_owner_can_patch_context(client, app, fake_supabase, professor_user, monkeypatch):
    course_id = _new_course_id()
    _auth_as(app, professor_user)
    _seed_course(fake_supabase, course_id, professor_user.id)

    import backend.services.course_context_service as ccs
    captured: dict = {}

    async def fake_replace(cid, patch):
        captured["course_id"] = cid
        captured["patch"] = patch
        return {
            "course_id": str(cid), "instructor": patch.get("instructor"), "exam_dates": [],
            "syllabus_facts": {}, "grading_scheme": None, "updated_at": None,
        }

    monkeypatch.setattr(ccs, "replace_course_context_fields", fake_replace)

    r = client.patch(f"/api/courses/{course_id}/context", json={"instructor": "Dr. Grace"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["instructor"] == "Dr. Grace"
    assert captured["patch"] == {"instructor": "Dr. Grace"}
    assert str(captured["course_id"]) == course_id


def test_patch_only_sends_explicitly_provided_fields(client, app, fake_supabase, professor_user, monkeypatch):
    """Omitted keys must not appear in the patch dict — the service layer
    treats an omitted key as 'leave alone', a present-but-empty key as
    'clear it'. This is the request-shape half of that contract."""
    course_id = _new_course_id()
    _auth_as(app, professor_user)
    _seed_course(fake_supabase, course_id, professor_user.id)

    import backend.services.course_context_service as ccs
    captured: dict = {}

    async def fake_replace(cid, patch):
        captured["patch"] = patch
        return {
            "course_id": str(cid), "instructor": None, "exam_dates": [],
            "syllabus_facts": {}, "grading_scheme": None, "updated_at": None,
        }

    monkeypatch.setattr(ccs, "replace_course_context_fields", fake_replace)

    r = client.patch(f"/api/courses/{course_id}/context", json={"grading_scheme": "50/50"})
    assert r.status_code == 200, r.text
    assert captured["patch"] == {"grading_scheme": "50/50"}


def test_non_owner_professor_cannot_patch_context(client, app, fake_supabase, professor_user):
    course_id = _new_course_id()
    _auth_as(app, professor_user)
    _seed_course(fake_supabase, course_id, "00000000-0000-0000-0000-000000000099")

    r = client.patch(f"/api/courses/{course_id}/context", json={"instructor": "Forged"})
    assert r.status_code == 403


def test_student_cannot_patch_context(client, app, fake_supabase, student_user):
    course_id = _new_course_id()
    _auth_as(app, student_user)
    _seed_course(fake_supabase, course_id, "00000000-0000-0000-0000-000000000099")

    r = client.patch(f"/api/courses/{course_id}/context", json={"instructor": "Forged"})
    assert r.status_code in (401, 403)
