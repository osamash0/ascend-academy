"""Integration tests for /api/mind-map/* endpoints."""
import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import verify_token


class TestMindMapGet:
    def test_returns_null_when_not_generated(self, app, patch_supabase, professor_user):
        patch_supabase.seed("lecture_mind_maps", [])
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.get(
            "/api/mind-map/L1",
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200
        assert r.json()["data"] is None

    def test_returns_cached(self, app, patch_supabase, professor_user):
        patch_supabase.seed(
            "lecture_mind_maps",
            [
                {
                    "lecture_id": "L1",
                    "tree_data": {"name": "Root", "children": []},
                    "generated_at": "2026-01-01",
                }
            ],
        )
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.get(
            "/api/mind-map/L1",
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["data"]["name"] == "Root"


class TestMindMapGenerate:
    def test_404_when_lecture_missing(self, app, patch_supabase, professor_user, monkeypatch):
        async def _gen(*a, **k):
            return {"name": "Root"}

        from backend.api import mind_map as mod

        monkeypatch.setattr(mod, "generate_mind_map", _gen)
        patch_supabase.seed("lectures", [])
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/mind-map/missing/generate",
            json={"ai_model": "groq"},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 404

    def test_400_when_no_slides(self, app, patch_supabase, professor_user, monkeypatch):
        async def _gen(*a, **k):
            return {"name": "Root"}

        from backend.api import mind_map as mod

        monkeypatch.setattr(mod, "generate_mind_map", _gen)
        patch_supabase.seed(
            "lectures",
            [{"id": "L1", "title": "T", "professor_id": professor_user.id}],
        )
        patch_supabase.seed("slides", [])
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/mind-map/L1/generate",
            json={"ai_model": "groq"},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 400

    def test_generates_and_caches(self, app, patch_supabase, professor_user, monkeypatch):
        async def _gen(*a, **k):
            return {"name": "Root", "children": [{"name": "Topic A"}]}

        from backend.api import mind_map as mod

        monkeypatch.setattr(mod, "generate_mind_map", _gen)
        patch_supabase.seed(
            "lectures",
            [{"id": "L1", "title": "T", "professor_id": professor_user.id}],
        )
        patch_supabase.seed(
            "slides",
            [
                {"id": "s1", "lecture_id": "L1", "title": "Slide 1",
                 "slide_number": 1, "summary": "Sum"}
            ],
        )
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/mind-map/L1/generate",
            json={"ai_model": "groq"},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["data"]["name"] == "Root"
        # Verify cached
        assert any(
            r["lecture_id"] == "L1"
            for r in patch_supabase.tables.get("lecture_mind_maps", [])
        )
