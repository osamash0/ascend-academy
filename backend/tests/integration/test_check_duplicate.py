"""Integration tests for POST /api/upload/check-duplicate.

Validates the duplicate-PDF lookup the upload UI uses to offer the
"open existing vs upload as new" dialog. The endpoint must:

  * require an authenticated professor (auth_middleware coverage),
  * scope results to the requesting professor (no cross-tenant leaks),
  * reject malformed pdf_hash values without hitting the database,
  * return the minimal {id,title,created_at,total_slides} shape the
    frontend renders.
"""
import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import verify_token


VALID_HASH = "a" * 64
OTHER_HASH = "b" * 64


def _seed_two_owners(fake_supabase):
    fake_supabase.seed(
        "lectures",
        [
            {"id": "L1", "professor_id": "professor-uuid-1", "title": "Mine",
             "pdf_hash": VALID_HASH, "total_slides": 5,
             "created_at": "2026-01-01T00:00:00Z"},
            {"id": "L2", "professor_id": "professor-uuid-1", "title": "Mine v2",
             "pdf_hash": VALID_HASH, "total_slides": 6,
             "created_at": "2026-02-01T00:00:00Z"},
            {"id": "L3", "professor_id": "professor-uuid-2", "title": "Theirs",
             "pdf_hash": VALID_HASH, "total_slides": 9,
             "created_at": "2026-03-01T00:00:00Z"},
        ],
    )


class TestCheckDuplicate:
    def test_returns_only_current_professors_matches(
        self, app, professor_user, patch_supabase
    ):
        _seed_two_owners(patch_supabase)
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)

        r = client.post(
            "/api/upload/check-duplicate",
            json={"pdf_hash": VALID_HASH},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200
        body = r.json()
        ids = [d["id"] for d in body["duplicates"]]
        # Newest-first, and P2's lecture is NOT included.
        assert ids == ["L2", "L1"]
        # Shape contract — these are the four fields the dialog renders.
        # (Fake supabase doesn't enforce .select() column projection; in
        # production PostgREST does, so we just assert presence.)
        for col in ("id", "title", "created_at", "total_slides"):
            assert col in body["duplicates"][0]

    def test_returns_empty_when_no_match(
        self, app, professor_user, patch_supabase
    ):
        _seed_two_owners(patch_supabase)
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)

        r = client.post(
            "/api/upload/check-duplicate",
            json={"pdf_hash": OTHER_HASH},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200
        assert r.json() == {"duplicates": []}

    def test_other_professor_does_not_see_owners_lectures(
        self, app, other_professor_user, patch_supabase
    ):
        # P1 has matching lectures; P2 also has one with the same hash. The
        # other professor must only see their own row.
        _seed_two_owners(patch_supabase)
        app.dependency_overrides[verify_token] = lambda: other_professor_user
        client = TestClient(app)

        r = client.post(
            "/api/upload/check-duplicate",
            json={"pdf_hash": VALID_HASH},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200
        ids = [d["id"] for d in r.json()["duplicates"]]
        assert ids == ["L3"]

    def test_rejects_non_hex_pdf_hash(
        self, app, professor_user, patch_supabase
    ):
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)

        r = client.post(
            "/api/upload/check-duplicate",
            json={"pdf_hash": "not-a-hash"},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 400

    def test_rejects_wrong_length_pdf_hash(
        self, app, professor_user, patch_supabase
    ):
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)

        r = client.post(
            "/api/upload/check-duplicate",
            json={"pdf_hash": "abc"},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 400

    def test_rejects_uppercase_hex(
        self, app, professor_user, patch_supabase
    ):
        # We require lowercase hex to match the format the WebCrypto helper
        # in the frontend produces; an uppercase variant slipping through
        # would produce false negatives against stored hashes.
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)

        r = client.post(
            "/api/upload/check-duplicate",
            json={"pdf_hash": "A" * 64},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 400

    def test_requires_auth(self, app, patch_supabase):
        # No verify_token override -> middleware rejects.
        client = TestClient(app)
        r = client.post(
            "/api/upload/check-duplicate",
            json={"pdf_hash": VALID_HASH},
        )
        assert r.status_code in (401, 403)


class TestParsePdfStreamForceReparse:
    """The force_reparse form field must skip the cache short-circuit."""

    @pytest.fixture
    def stub_streaming(self, monkeypatch):
        """Replace the heavy parser + validation with deterministic stubs."""
        from backend.api import upload as upload_mod

        async def _validate(_file, _content):
            return 1  # page count

        async def _parse(content, *_a, **_k):
            yield {"type": "info", "parser": "stub"}
            yield {"type": "complete", "total": 0}

        monkeypatch.setattr(upload_mod, "validate_upload", _validate)
        monkeypatch.setattr(upload_mod, "parse_pdf_stream", _parse)

        # Track whether the cache lookup happened.
        calls: dict[str, int] = {"get_cached_parse": 0}

        async def _get_cached(pdf_hash):
            calls["get_cached_parse"] += 1
            return {
                "slides": [{"title": "cached", "content": "x", "summary": "s"}],
                "deck_summary": "d",
                "deck_quiz": [],
            }

        async def _store_cached(_h, _d):
            return None

        async def _safe_embed(*a, **k):
            return None

        monkeypatch.setattr(upload_mod, "get_cached_parse", _get_cached)
        monkeypatch.setattr(upload_mod, "store_cached_parse", _store_cached)
        monkeypatch.setattr(upload_mod, "_safe_embedding_task", _safe_embed)
        return calls

    def _post(self, client, force):
        files = {"file": ("a.pdf", b"%PDF-1.4 fake", "application/pdf")}
        data = {"ai_model": "groq", "force_reparse": "true" if force else "false"}
        return client.post(
            "/api/upload/parse-pdf-stream",
            files=files,
            data=data,
            headers={"Authorization": "Bearer x"},
        )

    def test_default_uses_cache(self, app, professor_user, stub_streaming):
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = self._post(client, force=False)
        assert r.status_code == 200
        # Cache lookup occurred and returned a cached payload (the response
        # body should include a 'cached' slide title from the stub).
        assert stub_streaming["get_cached_parse"] == 1
        assert "cached" in r.text

    def test_force_reparse_skips_cache(self, app, professor_user, stub_streaming):
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = self._post(client, force=True)
        assert r.status_code == 200
        # The cache must not even be consulted when force_reparse=true.
        assert stub_streaming["get_cached_parse"] == 0
        # And the streamed body must come from the fresh parser stub, not
        # the cached payload.
        assert "cached" not in r.text
        assert '"parser": "stub"' in r.text
