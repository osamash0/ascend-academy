"""Integration tests for /api/concepts/* endpoints.

Drives the FastAPI app through the FakeSupabase backend and a stubbed
embedding function so the full ingest → mastery → related-lectures
flow can be exercised end-to-end.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import require_professor, verify_token


@pytest.fixture
def patch_concepts_modules(monkeypatch, fake_supabase, patch_supabase):
    """The concept api + service modules import `supabase_admin` by name
    at module load, so re-bind those names to the fake too."""
    from backend.api import concepts as concepts_api
    from backend.services import concept_graph as cg

    monkeypatch.setattr(concepts_api, "supabase_admin", fake_supabase, raising=True)
    monkeypatch.setattr(cg, "supabase_admin", fake_supabase, raising=True)

    async def fake_embed(text: str):
        # Stable, distinct embeddings per normalized text → trivial dedupe.
        h = abs(hash(text.strip().lower())) % 1000
        return [1.0 if i == h % 8 else 0.0 for i in range(8)]

    async def fake_generate_embeddings(text: str):
        return await fake_embed(text)

    monkeypatch.setattr(cg, "generate_embeddings", fake_generate_embeddings, raising=True)
    return fake_supabase


def _auth_as(app, user) -> None:
    app.dependency_overrides[verify_token] = lambda: user
    role = getattr(user, "app_metadata", {}).get("role")
    if role == "professor":
        app.dependency_overrides[require_professor] = lambda: user
    else:
        app.dependency_overrides.pop(require_professor, None)


def _seed_lecture(fake, lecture_id, professor_id, title="Lecture") -> None:
    fake.tables.setdefault("lectures", []).append({
        "id": lecture_id,
        "professor_id": professor_id,
        "title": title,
        "description": "",
        "total_slides": 5,
        "created_at": "2026-01-01",
        "pdf_url": None,
    })


# ── POST /api/concepts/ingest/{lecture_id} ───────────────────────────────────

class TestIngestEndpoint:
    def test_404_for_unknown_lecture(self, app, patch_concepts_modules, professor_user):
        _auth_as(app, professor_user)
        client = TestClient(app)
        r = client.post("/api/concepts/ingest/missing",
                        headers={"Authorization": "Bearer t"})
        assert r.status_code == 404

    def test_403_when_not_owner(self, app, patch_concepts_modules,
                                 professor_user, fake_supabase):
        _seed_lecture(fake_supabase, "L1", "someone-else")
        _auth_as(app, professor_user)
        client = TestClient(app)
        r = client.post("/api/concepts/ingest/L1",
                        headers={"Authorization": "Bearer t"})
        assert r.status_code == 403


# ── GET /api/concepts/student/{user_id} ──────────────────────────────────────

class TestStudentMasteryEndpoint:
    def _seed_mastery_data(self, fake, user_id):
        fake.seed("concepts", [
            {"id": "C_LR", "canonical_name": "Linear Regression",
             "name_key": "linear regression",
             "aliases": ["Linear Regression", "linear regression"]},
            {"id": "C_BP", "canonical_name": "Backpropagation",
             "name_key": "backpropagation", "aliases": ["Backpropagation"]},
        ])
        fake.seed("quiz_questions", [
            {"id": "Q1", "slide_id": "s1",
             "metadata": {"concept": "Linear Regression"}},
            {"id": "Q2", "slide_id": "s2",
             "metadata": {"concept": "Backpropagation"}},
        ])
        fake.seed("learning_events", [
            {"user_id": user_id, "event_type": "quiz_attempt",
             "event_data": {"questionId": "Q1", "correct": True}},
            {"user_id": user_id, "event_type": "quiz_attempt",
             "event_data": {"questionId": "Q1", "correct": True}},
            {"user_id": user_id, "event_type": "quiz_attempt",
             "event_data": {"questionId": "Q2", "correct": False}},
        ])

    def test_student_can_fetch_self(self, app, patch_concepts_modules,
                                     student_user, fake_supabase):
        self._seed_mastery_data(fake_supabase, student_user.id)
        _auth_as(app, student_user)
        client = TestClient(app)
        r = client.get(f"/api/concepts/student/{student_user.id}",
                       headers={"Authorization": "Bearer t"})
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        ids = {v["concept_id"] for v in body["data"]["vector"]}
        assert ids == {"C_LR", "C_BP"}
        # Weak list should rank backprop first (lowest score).
        assert body["data"]["weak"][0]["concept_id"] == "C_BP"

    def test_student_blocked_from_other_student(self, app, patch_concepts_modules,
                                                  student_user, fake_supabase):
        # student_user is not a professor, so user_roles lookup returns []
        fake_supabase.seed("user_roles", [])
        _auth_as(app, student_user)
        client = TestClient(app)
        r = client.get("/api/concepts/student/other-user",
                       headers={"Authorization": "Bearer t"})
        assert r.status_code == 403

    def test_professor_can_fetch_any_student(self, app, patch_concepts_modules,
                                              professor_user, fake_supabase):
        fake_supabase.seed("user_roles",
                           [{"user_id": professor_user.id, "role": "professor"}])
        self._seed_mastery_data(fake_supabase, "stu-42")
        _auth_as(app, professor_user)
        # require_professor was overridden by _auth_as; remove it for this
        # endpoint which uses verify_token only.
        client = TestClient(app)
        r = client.get("/api/concepts/student/stu-42",
                       headers={"Authorization": "Bearer t"})
        assert r.status_code == 200
        assert {v["concept_id"] for v in r.json()["data"]["vector"]} == {"C_LR", "C_BP"}


# ── GET /api/concepts/{concept_id}/related-lectures ──────────────────────────

class TestRelatedLecturesEndpoint:
    def test_returns_ranked_lectures_excluding_current(
        self, app, patch_concepts_modules, student_user, fake_supabase,
    ):
        fake_supabase.seed("concept_lectures", [
            {"concept_id": "C1", "lecture_id": "L_LIGHT",
             "slide_indices": [0], "weight": 1.0},
            {"concept_id": "C1", "lecture_id": "L_HEAVY",
             "slide_indices": [1, 2, 3], "weight": 5.0},
            {"concept_id": "C1", "lecture_id": "L_SELF",
             "slide_indices": [0], "weight": 2.0},
        ])
        fake_supabase.seed("lectures", [
            {"id": "L_LIGHT", "title": "Light", "description": None, "total_slides": 4},
            {"id": "L_HEAVY", "title": "Heavy", "description": None, "total_slides": 8},
            {"id": "L_SELF", "title": "Self", "description": None, "total_slides": 2},
        ])
        _auth_as(app, student_user)
        client = TestClient(app)

        r = client.get(
            "/api/concepts/C1/related-lectures",
            params={"exclude_lecture_id": "L_SELF", "limit": 5},
            headers={"Authorization": "Bearer t"},
        )
        assert r.status_code == 200
        ids = [row["lecture_id"] for row in r.json()["data"]]
        assert ids == ["L_HEAVY", "L_LIGHT"]
