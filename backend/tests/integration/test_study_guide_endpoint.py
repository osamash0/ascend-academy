"""Integration tests for GET /api/courses/{id}/study-guide (Roadmap Phase 4.4).

Ownership/visibility checks go through the fake Supabase client (mirroring
_fetch_course / _student_visible_course_ids); the data layer
(backend.services.study_guide_service, asyncpg-backed) is mocked here since
its own aggregation/caching semantics are verified for real against Postgres
in backend/tests/db/test_study_guide_service.py.
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


def _seed_course(fake, course_id: str, professor_id: str, status: str = "published") -> None:
    # Non-owner (student) visibility requires status == "published".
    fake.table("courses").insert({
        "id": course_id, "professor_id": professor_id, "title": "C", "is_archived": False,
        "status": status,
    }).execute()


def _new_course_id() -> str:
    return str(uuid.uuid4())


SAMPLE_GUIDE = {
    "lectures": [{"lecture_id": "l1", "title": "Intro", "synopsis": "Basics."}],
    "concepts": [{"name": "Gradient Descent", "definition": "..."}],
    "course_facts": {"instructor": "Prof. Ada", "exam_dates": [], "grading_scheme": None},
}


def test_returns_404_when_feature_flag_off(client, app, fake_supabase, professor_user, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "feature_study_guide", False, raising=False)

    course_id = _new_course_id()
    _auth_as(app, professor_user)
    _seed_course(fake_supabase, course_id, professor_user.id)

    r = client.get(f"/api/courses/{course_id}/study-guide")
    assert r.status_code == 404


def test_owner_gets_generated_guide(client, app, fake_supabase, professor_user, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "feature_study_guide", True, raising=False)

    course_id = _new_course_id()
    _auth_as(app, professor_user)
    _seed_course(fake_supabase, course_id, professor_user.id)

    import backend.services.study_guide_service as sgs

    async def fake_get_or_generate(cid, *, force_regenerate=False, ai_model="cerebras"):
        return SAMPLE_GUIDE

    monkeypatch.setattr(sgs, "get_or_generate_study_guide", fake_get_or_generate)

    r = client.get(f"/api/courses/{course_id}/study-guide")
    assert r.status_code == 200, r.text
    assert r.json()["data"] == SAMPLE_GUIDE


def test_regenerate_query_param_is_forwarded(client, app, fake_supabase, professor_user, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "feature_study_guide", True, raising=False)

    course_id = _new_course_id()
    _auth_as(app, professor_user)
    _seed_course(fake_supabase, course_id, professor_user.id)

    import backend.services.study_guide_service as sgs
    captured = {}

    async def fake_get_or_generate(cid, *, force_regenerate=False, ai_model="cerebras"):
        captured["force_regenerate"] = force_regenerate
        return SAMPLE_GUIDE

    monkeypatch.setattr(sgs, "get_or_generate_study_guide", fake_get_or_generate)

    r = client.get(f"/api/courses/{course_id}/study-guide?regenerate=true")
    assert r.status_code == 200
    assert captured["force_regenerate"] is True


def test_non_visible_student_gets_403(client, app, fake_supabase, student_user, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "feature_study_guide", True, raising=False)

    course_id = _new_course_id()
    _auth_as(app, student_user)
    _seed_course(fake_supabase, course_id, "00000000-0000-0000-0000-000000000099")

    r = client.get(f"/api/courses/{course_id}/study-guide")
    assert r.status_code == 403


def test_enrolled_student_can_see_guide(client, app, fake_supabase, student_user, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "feature_study_guide", True, raising=False)

    course_id = _new_course_id()
    _auth_as(app, student_user)
    _seed_course(fake_supabase, course_id, "00000000-0000-0000-0000-000000000099")
    fake_supabase.table("course_enrollments").insert({
        "user_id": student_user.id, "course_id": course_id,
    }).execute()

    import backend.services.study_guide_service as sgs

    async def fake_get_or_generate(cid, *, force_regenerate=False, ai_model="cerebras"):
        return SAMPLE_GUIDE

    monkeypatch.setattr(sgs, "get_or_generate_study_guide", fake_get_or_generate)

    r = client.get(f"/api/courses/{course_id}/study-guide")
    assert r.status_code == 200
    assert r.json()["data"] == SAMPLE_GUIDE


def test_missing_course_returns_404(client, app, fake_supabase, professor_user, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "feature_study_guide", True, raising=False)

    _auth_as(app, professor_user)
    r = client.get(f"/api/courses/{_new_course_id()}/study-guide")
    assert r.status_code == 404


def test_generation_failure_returns_500(client, app, fake_supabase, professor_user, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "feature_study_guide", True, raising=False)

    course_id = _new_course_id()
    _auth_as(app, professor_user)
    _seed_course(fake_supabase, course_id, professor_user.id)

    import backend.services.study_guide_service as sgs

    async def failing(cid, *, force_regenerate=False, ai_model="cerebras"):
        raise RuntimeError("db down")

    monkeypatch.setattr(sgs, "get_or_generate_study_guide", failing)

    r = client.get(f"/api/courses/{course_id}/study-guide")
    assert r.status_code == 500
