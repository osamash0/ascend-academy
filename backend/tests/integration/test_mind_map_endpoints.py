"""Integration tests for /api/mind-map/* endpoints."""
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
                    "tree_data": {
                        "id": "root",
                        "label": "Root",
                        "type": "root",
                        "children": [],
                    },
                    "generated_at": "2026-01-01",
                    "schema_version": 2,
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
        assert body["data"]["label"] == "Root"
        assert body["data"]["type"] == "root"
        assert body["schema_version"] == 2

    def test_returns_null_for_stale_schema_version(
        self, app, patch_supabase, professor_user
    ):
        patch_supabase.seed(
            "lecture_mind_maps",
            [
                {
                    "lecture_id": "L1",
                    "tree_data": {"name": "Old format"},
                    "generated_at": "2025-01-01",
                    "schema_version": 1,
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
        assert body["data"] is None
        assert body.get("stale") is True


class TestMindMapGenerate:
    def test_404_when_lecture_missing(self, app, patch_supabase, professor_user, monkeypatch):
        async def _gen(*a, **k):
            return {"name": "Root"}

        from backend.api.v1 import mind_map as mod

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

        from backend.api.v1 import mind_map as mod

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

        from backend.api.v1 import mind_map as mod

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

    def test_repairs_synthetic_and_duplicate_slide_ids_for_large_lecture(
        self, app, patch_supabase, professor_user, monkeypatch
    ):
        """For a 200-slide lecture: hallucinated 's-0' style ids must be
        dropped, duplicate real ids deduped, and any genuinely missing slide
        ids must appear under the 'Other slides' cluster."""
        N = 200
        slides = [
            {
                "id": f"slide-{i}",
                "lecture_id": "L1",
                "title": f"Slide {i + 1}",
                "slide_number": i + 1,
                "summary": "",
            }
            for i in range(N)
        ]

        async def _gen(*a, **k):
            return {
                "id": "root",
                "label": "T",
                "type": "root",
                "children": [
                    # Cluster contains a real id, a duplicate of it, and a
                    # hallucinated synthetic id that is NOT in the slides
                    # table.
                    {
                        "id": "c-1",
                        "label": "Theme A",
                        "type": "cluster",
                        "children": [
                            {"id": "slide-0", "label": "Slide 1", "type": "slide"},
                            {"id": "slide-0", "label": "Dup", "type": "slide"},
                            {"id": "s-fake", "label": "Hallucinated", "type": "slide"},
                        ],
                    },
                ],
            }

        from backend.api.v1 import mind_map as mod

        monkeypatch.setattr(mod, "generate_mind_map", _gen)
        patch_supabase.seed(
            "lectures",
            [{"id": "L1", "title": "T", "professor_id": professor_user.id}],
        )
        patch_supabase.seed("slides", slides)
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/mind-map/L1/generate",
            json={"ai_model": "groq"},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200
        tree = r.json()["data"]

        def collect_slide_ids(node):
            ids = []
            if node.get("type") == "slide":
                ids.append(node["id"])
            for c in node.get("children") or []:
                ids.extend(collect_slide_ids(c))
            return ids

        slide_ids = collect_slide_ids(tree)
        valid = {s["id"] for s in slides}

        # Every slide-typed node points at a real slide id.
        assert all(sid in valid for sid in slide_ids), (
            f"Tree contains synthetic slide ids: {set(slide_ids) - valid}"
        )
        # No duplicates.
        assert len(slide_ids) == len(set(slide_ids)), "Duplicate slide nodes leaked through"
        # Every real slide is represented exactly once.
        assert set(slide_ids) == valid
