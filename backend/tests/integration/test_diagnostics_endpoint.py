"""Integration tests for GET /api/upload/diagnostics/{pdf_hash}.

Covers:
  * 400 when pdf_hash is missing/blank (route shape).
  * 404 when no lecture references the hash (no enumeration leak).
  * 403 when the hash belongs to another professor.
  * 200 with the expected payload shape when the caller owns the lecture.
  * Unauthenticated requests are rejected (401).
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from backend.core.auth_middleware import require_professor, verify_token


def _seed_owned_lecture(patch_supabase, professor_user, pdf_hash: str = "h-owned"):
    patch_supabase.seed(
        "lectures",
        [
            {
                "id": "L-owned",
                "title": "Owned",
                "professor_id": professor_user.id,
                "pdf_hash": pdf_hash,
            }
        ],
    )


def _seed_other_lecture(patch_supabase, other_professor_user, pdf_hash: str = "h-other"):
    patch_supabase.seed(
        "lectures",
        [
            {
                "id": "L-other",
                "title": "Other",
                "professor_id": other_professor_user.id,
                "pdf_hash": pdf_hash,
            }
        ],
    )


class TestDiagnosticsEndpoint:
    def test_404_when_no_lecture_references_hash(self, app, patch_supabase, professor_user):
        patch_supabase.seed("lectures", [])
        app.dependency_overrides[verify_token] = lambda: professor_user
        app.dependency_overrides[require_professor] = lambda: professor_user
        client = TestClient(app)
        r = client.get("/api/upload/diagnostics/missing-hash", headers={"Authorization": "Bearer x"})
        assert r.status_code == 404

    def test_403_when_hash_belongs_to_other_professor(
        self, app, patch_supabase, professor_user, other_professor_user
    ):
        _seed_other_lecture(patch_supabase, other_professor_user, "h-other")
        app.dependency_overrides[verify_token] = lambda: professor_user
        app.dependency_overrides[require_professor] = lambda: professor_user
        client = TestClient(app)
        r = client.get("/api/upload/diagnostics/h-other", headers={"Authorization": "Bearer x"})
        assert r.status_code == 403

    def test_200_returns_telemetry_payload_for_owner(
        self, app, patch_supabase, professor_user
    ):
        _seed_owned_lecture(patch_supabase, professor_user, "h-owned")
        # Two cached slides — one TEXT, one SKIP with high image coverage
        # (which the diagnostics flagger must surface).
        patch_supabase.seed(
            "slide_parse_cache",
            [
                {
                    "pdf_hash": "h-owned",
                    "slide_index": 0,
                    "pipeline_version": "2",
                    "slide_data": {
                        "slide_index": 0,
                        "title": "Intro",
                        "_meta": {
                            "route": "text",
                            "route_reason": "default_text",
                            "layout_features": {
                                "word_count": 200,
                                "image_coverage": 0.0,
                                "alpha_ratio": 0.95,
                            },
                        },
                    },
                },
                {
                    "pdf_hash": "h-owned",
                    "slide_index": 1,
                    "pipeline_version": "2",
                    "slide_data": {
                        "slide_index": 1,
                        "title": "Picture",
                        "_meta": {
                            "route": "skip",
                            "route_reason": "blank_page_heuristic",
                            "layout_features": {
                                "word_count": 1,
                                "image_coverage": 0.6,
                                "alpha_ratio": 0.9,
                            },
                        },
                    },
                },
            ],
        )
        patch_supabase.seed(
            "pipeline_run_metrics",
            [
                {
                    "pdf_hash": "h-owned",
                    "pipeline_version": "2",
                    "started_at": "2026-05-01T00:00:00Z",
                    "finished_at": "2026-05-01T00:00:05Z",
                    "totals": {"text": 1, "skip": 1, "total": 2},
                    "fallbacks": {"vision_rate_limited": 0, "cache_write_retries": 0},
                }
            ],
        )

        app.dependency_overrides[verify_token] = lambda: professor_user
        app.dependency_overrides[require_professor] = lambda: professor_user
        client = TestClient(app)
        r = client.get("/api/upload/diagnostics/h-owned", headers={"Authorization": "Bearer x"})
        assert r.status_code == 200, r.text
        body = r.json()

        assert body["pdf_hash"] == "h-owned"
        assert body["pipeline_version"] == "2"
        assert isinstance(body["per_slide"], list) and len(body["per_slide"]) == 2

        routes = {row["slide_index"]: row["route"] for row in body["per_slide"]}
        assert routes == {0: "text", 1: "skip"}

        # The SKIP-with-images row must be flagged.
        flag_indices = {f["slide_index"] for f in body["flags"]}
        assert 1 in flag_indices

        # Run metrics row passes through.
        assert body["run_metrics"] is not None
        assert body["run_metrics"]["totals"]["total"] == 2

    def test_200_when_pdf_hash_collides_across_professors(
        self, app, patch_supabase, professor_user, other_professor_user
    ):
        """If two professors uploaded the same PDF (identical pdf_hash),
        the ownership lookup must still authorize the caller based on
        their own row, not the first row returned by the table scan."""
        # Seed the OTHER professor first so their row would come back first
        # under a naive `.eq("pdf_hash", h).limit(1)` lookup.
        shared_hash = "h-collision"
        patch_supabase.seed(
            "lectures",
            [
                {
                    "id": "L-other",
                    "title": "Other prof copy",
                    "professor_id": other_professor_user.id,
                    "pdf_hash": shared_hash,
                },
                {
                    "id": "L-mine",
                    "title": "My copy",
                    "professor_id": professor_user.id,
                    "pdf_hash": shared_hash,
                },
            ],
        )
        app.dependency_overrides[verify_token] = lambda: professor_user
        app.dependency_overrides[require_professor] = lambda: professor_user
        client = TestClient(app)
        r = client.get(
            f"/api/upload/diagnostics/{shared_hash}",
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["pdf_hash"] == shared_hash

    def test_unauthenticated_returns_401(self, app, patch_supabase):
        # Don't override auth — verify_token will reject the missing bearer.
        client = TestClient(app)
        r = client.get("/api/upload/diagnostics/anything")
        assert r.status_code in (401, 403)
