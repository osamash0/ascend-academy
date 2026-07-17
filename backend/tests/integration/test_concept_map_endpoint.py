"""Integration tests for GET /api/courses/{id}/concept-map (Roadmap Phase 3.2).

Cross-lecture concept DEDUP already exists (backend/services/concept_graph.py,
covered by test_concept_graph.py / test_concept_graph_endpoints.py) — this
endpoint only merges concept_lectures into a per-course view with "builds on"
ordering derived from lectures.created_at. No new schema.
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


def _new_id() -> str:
    return str(uuid.uuid4())


def _seed_course(fake, course_id: str, professor_id: str, status: str = "published") -> None:
    # Non-owner (student) visibility requires status == "published".
    fake.table("courses").insert({
        "id": course_id, "professor_id": professor_id, "title": "C", "is_archived": False,
        "status": status,
    }).execute()


def _seed_lecture(fake, lecture_id: str, course_id: str, professor_id: str, title: str, created_at: str) -> None:
    fake.table("lectures").insert({
        "id": lecture_id, "professor_id": professor_id, "course_id": course_id,
        "title": title, "total_slides": 3, "is_archived": False, "created_at": created_at,
    }).execute()


def _seed_concept(fake, concept_id: str, name: str) -> None:
    fake.table("concepts").insert({"id": concept_id, "canonical_name": name}).execute()


def _seed_concept_lecture(fake, concept_id: str, lecture_id: str, slide_indices=None, weight=1.0) -> None:
    fake.table("concept_lectures").insert({
        "concept_id": concept_id, "lecture_id": lecture_id,
        "slide_indices": slide_indices or [], "weight": weight,
    }).execute()


def test_concept_shared_across_two_lectures_merges_with_chronological_appearances(
    client, app, fake_supabase, professor_user
):
    course = _new_id()
    lec_early, lec_late = _new_id(), _new_id()
    concept = _new_id()
    _auth_as(app, professor_user)
    _seed_course(fake_supabase, course, professor_user.id)
    _seed_lecture(fake_supabase, lec_early, course, professor_user.id, "Week 1", "2026-01-01T00:00:00Z")
    _seed_lecture(fake_supabase, lec_late, course, professor_user.id, "Week 5", "2026-02-01T00:00:00Z")
    _seed_concept(fake_supabase, concept, "Gradient Descent")
    # Insert out of chronological order to prove the endpoint sorts, not just echoes insert order.
    _seed_concept_lecture(fake_supabase, concept, lec_late, slide_indices=[2])
    _seed_concept_lecture(fake_supabase, concept, lec_early, slide_indices=[0, 1])

    r = client.get(f"/api/courses/{course}/concept-map")
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert len(data) == 1
    entry = data[0]
    assert entry["canonical_name"] == "Gradient Descent"
    assert entry["first_lecture"]["id"] == lec_early
    assert [a["lecture_id"] for a in entry["appearances"]] == [lec_early, lec_late]


def test_concept_unique_to_one_lecture_has_single_appearance(client, app, fake_supabase, professor_user):
    course = _new_id()
    lecture = _new_id()
    concept = _new_id()
    _auth_as(app, professor_user)
    _seed_course(fake_supabase, course, professor_user.id)
    _seed_lecture(fake_supabase, lecture, course, professor_user.id, "Week 1", "2026-01-01T00:00:00Z")
    _seed_concept(fake_supabase, concept, "Backpropagation")
    _seed_concept_lecture(fake_supabase, concept, lecture, slide_indices=[3])

    r = client.get(f"/api/courses/{course}/concept-map")
    assert r.status_code == 200
    data = r.json()["data"]
    assert len(data) == 1
    assert len(data[0]["appearances"]) == 1


def test_course_with_no_concepts_returns_empty_list(client, app, fake_supabase, professor_user):
    course = _new_id()
    _auth_as(app, professor_user)
    _seed_course(fake_supabase, course, professor_user.id)

    r = client.get(f"/api/courses/{course}/concept-map")
    assert r.status_code == 200
    assert r.json()["data"] == []


def test_non_owner_non_enrolled_gets_403(client, app, fake_supabase, professor_user):
    course = _new_id()
    _auth_as(app, professor_user)
    _seed_course(fake_supabase, course, "00000000-0000-0000-0000-000000000099")

    r = client.get(f"/api/courses/{course}/concept-map")
    assert r.status_code == 403


def test_missing_course_returns_404(client, app, fake_supabase, professor_user):
    _auth_as(app, professor_user)
    r = client.get(f"/api/courses/{_new_id()}/concept-map")
    assert r.status_code == 404


def test_enrolled_student_can_see_concept_map(client, app, fake_supabase, student_user):
    course = _new_id()
    lecture = _new_id()
    concept = _new_id()
    _auth_as(app, student_user)
    _seed_course(fake_supabase, course, "00000000-0000-0000-0000-000000000099")
    _seed_lecture(fake_supabase, lecture, course, "00000000-0000-0000-0000-000000000099", "Week 1", "2026-01-01T00:00:00Z")
    _seed_concept(fake_supabase, concept, "Overfitting")
    _seed_concept_lecture(fake_supabase, concept, lecture, slide_indices=[1])
    fake_supabase.table("course_enrollments").insert({
        "user_id": student_user.id, "course_id": course,
    }).execute()

    r = client.get(f"/api/courses/{course}/concept-map")
    assert r.status_code == 200
    assert len(r.json()["data"]) == 1
