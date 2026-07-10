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
            {"id": "L1", "professor_id": "00000000-0000-0000-0000-000000000001", "title": "Mine",
             "pdf_hash": VALID_HASH, "total_slides": 5,
             "created_at": "2026-01-01T00:00:00Z"},
            {"id": "L2", "professor_id": "00000000-0000-0000-0000-000000000001", "title": "Mine v2",
             "pdf_hash": VALID_HASH, "total_slides": 6,
             "created_at": "2026-02-01T00:00:00Z"},
            {"id": "L3", "professor_id": "00000000-0000-0000-0000-000000000003", "title": "Theirs",
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


class TestCheckParseCache:
    """`/api/upload/check-parse-cache` surfaces pdf_parse_cache hits to
    the upload UI so users can choose between using the cached parse and
    forcing a fresh one."""

    def test_returns_cached_true_when_row_exists(
        self, app, professor_user, patch_supabase
    ):
        patch_supabase.seed(
            "pdf_parse_cache",
            [
                {
                    "pdf_hash": VALID_HASH,
                    "result": {"slides": [{"title": "x"}], "deck": {}},
                    "created_at": "2026-04-15T12:00:00Z",
                },
            ],
        )
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)

        r = client.post(
            "/api/upload/check-parse-cache",
            json={"pdf_hash": VALID_HASH},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["cached"] is True
        assert body["parsed_at"] == "2026-04-15T12:00:00Z"

    def test_returns_cached_false_when_no_row(
        self, app, professor_user, patch_supabase
    ):
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)

        r = client.post(
            "/api/upload/check-parse-cache",
            json={"pdf_hash": OTHER_HASH},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 200
        assert r.json() == {"cached": False, "parsed_at": None}

    def test_rejects_non_hex_pdf_hash(
        self, app, professor_user, patch_supabase
    ):
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/upload/check-parse-cache",
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
            "/api/upload/check-parse-cache",
            json={"pdf_hash": "abc"},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 400

    def test_requires_auth(self, app, patch_supabase):
        client = TestClient(app)
        r = client.post(
            "/api/upload/check-parse-cache",
            json={"pdf_hash": VALID_HASH},
        )
        assert r.status_code in (401, 403)


class TestParsePdfStreamForceReparse:
    """The force_reparse form field must skip the cache short-circuit."""

    @pytest.fixture
    def stub_streaming(self, monkeypatch):
        """Replace the heavy parser + validation with deterministic stubs.

        After the v1 restructure the endpoint delegates the fresh-parse path
        to ``upload_service.process_pdf_stream`` (which internally calls
        ``parse_pdf_stream`` / ``store_cached_parse`` resolved in the
        upload_service namespace) and validates via
        ``upload_service.validate_upload``. The cache short-circuit lives on
        the endpoint module (``get_cached_parse``) and the cached path's
        embedding fan-out resolves ``_safe_embedding_task`` from
        ``file_parse_service``. Patch each symbol where it is actually
        resolved.
        """
        from backend.api.v1 import upload as upload_mod
        from backend.services import upload_service
        from backend.services import file_parse_service

        async def _validate(_file, _content):
            return 1  # page count

        async def _process(*_a, **_k):
            # The endpoint delegates the fresh-parse path to
            # upload_service.process_pdf_stream, which yields SSE-formatted
            # strings (parser identity + phase/complete markers).
            yield "data: {\"type\": \"info\", \"parser\": \"unified\"}\n\n"
            yield "data: {\"type\": \"phase\", \"phase\": \"extract\"}\n\n"
            yield "data: {\"type\": \"phase\", \"phase\": \"enhance\"}\n\n"
            yield "data: {\"type\": \"complete\", \"total\": 0}\n\n"

        monkeypatch.setattr(upload_service, "validate_upload", _validate)
        monkeypatch.setattr(upload_service, "process_pdf_stream", _process)

        # Track whether the cache lookup happened.
        calls: dict[str, int] = {"get_cached_parse": 0}

        async def _get_cached(pdf_hash, *args, **kwargs):
            calls["get_cached_parse"] += 1
            return {
                # Unified (v5) is the only live pipeline; the endpoint drops any
                # cache not produced by it, so the stub must mark itself unified.
                "parser": "unified",
                "slides": [{"title": "cached", "content": "x", "summary": "s"}],
                "deck_summary": "d",
                "deck_quiz": [],
            }

        async def _safe_embed(*a, **k):
            return None

        # The endpoint resolves get_cached_parse in its own module namespace.
        monkeypatch.setattr(upload_mod, "get_cached_parse", _get_cached)
        # The cached-stream generator imports _safe_embedding_task from
        # file_parse_service at call time.
        monkeypatch.setattr(file_parse_service, "_safe_embedding_task", _safe_embed)
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

    def test_default_uses_cache(self, app, professor_user, patch_supabase, stub_streaming):
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = self._post(client, force=False)
        assert r.status_code == 200
        # Cache lookup occurred and returned a cached payload (the response
        # body should include a 'cached' slide title from the stub).
        assert stub_streaming["get_cached_parse"] == 1
        assert "cached" in r.text

    def test_force_reparse_skips_cache(self, app, professor_user, patch_supabase, stub_streaming):
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = self._post(client, force=True)
        assert r.status_code == 200
        # The cache must not even be consulted when force_reparse=true.
        assert stub_streaming["get_cached_parse"] == 0
        # And the streamed body must come from the fresh parser stub, not
        # the cached payload.
        assert "cached" not in r.text
        # The fresh unified stream contributes the parser identity + phase markers.
        assert '"parser": "unified"' in r.text
        assert '"phase": "enhance"' in r.text


class TestEnhanceSlide:
    """POST /upload/enhance-slide/{id} runs synthesis on a Skip-AI slide and
    flips ai_enhanced, enforcing ownership and idempotency."""

    PROF = "00000000-0000-0000-0000-000000000001"

    def _seed(self, fake, *, ai_enhanced=False, owner=None):
        fake.seed("lectures", [{
            "id": "LEC1", "professor_id": owner or self.PROF, "title": "ML",
            "description": "Intro", "pdf_hash": "d" * 64,
        }])
        fake.seed("slides", [{
            "id": "SL1", "lecture_id": "LEC1", "slide_number": 2,
            "content_text": "gradient descent minimizes the loss",
            "title": "Slide 2", "summary": "", "ai_enhanced": ai_enhanced,
            "parser_engine": "heuristic-v1",
        }])

    def _patch_synth(self, monkeypatch):
        from backend.services.parser import unified_orchestrator as uo
        from backend.services.parser import storage
        import backend.services.file_parse_service as fps

        async def fake_synth(idx, text, ctx, model, pdf):
            return {"title": "Gradient Descent", "content": text,
                    "summary": "How GD minimizes loss.", "slide_type": "text"}

        async def fake_pdf(pdf_hash):
            return b"%PDF-fake"

        async def fake_embed(*a, **k):
            return None

        monkeypatch.setattr(uo, "_synthesize_slide", fake_synth)
        monkeypatch.setattr(storage, "_fetch_pdf_bytes", fake_pdf)
        monkeypatch.setattr(fps, "_safe_embedding_task", fake_embed)

    def test_enhances_skip_ai_slide_and_flips_flag(self, app, professor_user, patch_supabase, monkeypatch):
        self._seed(patch_supabase)
        self._patch_synth(monkeypatch)
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.post("/api/v1/upload/enhance-slide/SL1", headers={"Authorization": "Bearer x"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ai_enhanced"] is True
        assert body["title"] == "Gradient Descent"
        assert body["summary"] == "How GD minimizes loss."
        # The persisted row was updated.
        row = patch_supabase.table("slides").select("*").eq("id", "SL1").execute().data[0]
        assert row["ai_enhanced"] is True
        assert row["parser_engine"] == "unified"

    def test_already_enhanced_is_idempotent_noop(self, app, professor_user, patch_supabase, monkeypatch):
        self._seed(patch_supabase, ai_enhanced=True)
        # Synthesis must NOT run for an already-enhanced slide.
        from backend.services.parser import unified_orchestrator as uo

        async def boom(*a, **k):
            raise AssertionError("synthesis must not run on an enhanced slide")

        monkeypatch.setattr(uo, "_synthesize_slide", boom)
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.post("/api/v1/upload/enhance-slide/SL1", headers={"Authorization": "Bearer x"})
        assert r.status_code == 200
        assert r.json().get("already_enhanced") is True

    def test_rejects_non_owner(self, app, professor_user, patch_supabase, monkeypatch):
        self._seed(patch_supabase, owner="99999999-9999-9999-9999-999999999999")
        self._patch_synth(monkeypatch)
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.post("/api/v1/upload/enhance-slide/SL1", headers={"Authorization": "Bearer x"})
        assert r.status_code == 403


class TestUploadConfig:
    """GET /api/upload/config exposes the single source-of-truth upload limits
    so the client rejects oversize files with the same number the backend does."""

    def test_config_reports_configured_limit(self, app):
        from backend.core.config import settings
        client = TestClient(app)
        r = client.get("/api/v1/upload/config")
        assert r.status_code == 200
        body = r.json()
        # The served limit must equal the backend's single source of truth,
        # and the endpoint stream guard must enforce that same number.
        from backend.api.v1 import upload as upload_mod
        assert body["maxUploadMb"] == settings.max_upload_mb == upload_mod.MAX_FILE_MB
        assert ".pdf" in body["acceptedExtensions"]

    def test_oversize_file_rejected_at_the_configured_limit(self, app, professor_user):
        """A file one byte over the limit is rejected with 413 naming the limit."""
        from backend.core.config import settings
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        oversize = b"%PDF-1.4" + b"\x00" * (settings.max_upload_mb * 1024 * 1024)
        r = client.post(
            "/api/upload/parse-pdf-stream",
            files={"file": ("big.pdf", oversize, "application/pdf")},
            data={"ai_model": "cerebras"},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 413
        assert f"{settings.max_upload_mb}MB" in r.text
