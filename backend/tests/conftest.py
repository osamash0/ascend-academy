"""
Shared pytest fixtures.

Goals:
 - Tests must run with ZERO outbound network and no real Supabase project.
 - Auth is controlled by overriding `verify_token` / `require_role` on the
   FastAPI app via `app.dependency_overrides`.
 - LLM providers are patched at the factory level.
 - The slowapi limiter is reset between tests so rate-limit tests don't bleed.
"""
from __future__ import annotations
import os
import sys
from pathlib import Path
from typing import Any
from types import SimpleNamespace

# ── Stub heavyweight env BEFORE any backend.* import ──────────────────────────
# backend.core.database imports at module-load-time and requires real-looking
# env vars or it raises. These are throwaway values; everything routed through
# fixtures replaces the real client anyway.
os.environ.setdefault("SUPABASE_URL", "https://fake.supabase.test")
os.environ.setdefault("SUPABASE_KEY", "fake-anon-key-for-tests")
os.environ.setdefault("SUPABASE_ANON_KEY", "fake-anon-key-for-tests")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key-for-tests")
os.environ.setdefault("VITE_SUPABASE_URL", "https://fake.supabase.test")
os.environ.setdefault("VITE_SUPABASE_PUBLISHABLE_KEY", "fake-anon-key-for-tests")
os.environ.setdefault("GROQ_API_KEY", "fake-groq")
os.environ.setdefault("GEMINI_API_KEY", "fake-gemini")

# Make repo root importable as `backend.*`
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from backend.tests.fake_supabase import FakeSupabaseClient  # noqa: E402


# ── Fake Supabase ─────────────────────────────────────────────────────────────

@pytest.fixture
def fake_supabase() -> FakeSupabaseClient:
    """A fresh in-memory PostgREST-like client for one test."""
    return FakeSupabaseClient()


@pytest.fixture
def patch_supabase(monkeypatch: pytest.MonkeyPatch, fake_supabase: FakeSupabaseClient):
    """Replace every supabase client reference in the backend with the fake.

    Returns the FakeSupabaseClient so tests can seed/inspect it.
    """
    from backend.core import database
    from backend.services import analytics_service
    from backend.api import analytics as analytics_api
    from backend.services import cache as cache_module

    monkeypatch.setattr(database, "supabase_admin", fake_supabase, raising=True)
    monkeypatch.setattr(database, "supabase_anon", fake_supabase, raising=True)
    monkeypatch.setattr(database, "supabase", fake_supabase, raising=True)
    monkeypatch.setattr(analytics_service, "supabase_admin", fake_supabase, raising=False)
    monkeypatch.setattr(analytics_api, "supabase", fake_supabase, raising=True)
    monkeypatch.setattr(cache_module, "supabase_admin", fake_supabase, raising=True)

    # upload.py imports supabase_admin by name at module-load — patch the
    # local reference so each test's fresh fake is the one used.
    try:
        from backend.api import upload as upload_api
        monkeypatch.setattr(upload_api, "supabase_admin", fake_supabase, raising=False)
    except Exception:
        pass

    # assignments.py also imports supabase_admin by name at module-load.
    try:
        from backend.api import assignments as assignments_api
        monkeypatch.setattr(assignments_api, "supabase_admin", fake_supabase, raising=False)
    except Exception:
        pass

    # courses.py / worksheets.py import supabase_admin at module load too.
    try:
        from backend.api import courses as courses_api
        monkeypatch.setattr(courses_api, "supabase_admin", fake_supabase, raising=False)
    except Exception:
        pass
    try:
        from backend.api import worksheets as worksheets_api
        monkeypatch.setattr(worksheets_api, "supabase_admin", fake_supabase, raising=False)
    except Exception:
        pass

    # Ensure get_client/get_auth_client return the fake
    monkeypatch.setattr(database, "get_client", lambda use_admin=False: fake_supabase, raising=True)
    monkeypatch.setattr(
        analytics_service,
        "get_auth_client",
        lambda token: fake_supabase,
        raising=True,
    )

    # Patch create_client used by mind_map / ai_content / analytics
    from backend.api import mind_map as mind_map_api
    from backend.api import ai_content as ai_api

    monkeypatch.setattr(mind_map_api, "create_client", lambda url, key: fake_supabase, raising=True)
    monkeypatch.setattr(ai_api, "create_client", lambda url, key: fake_supabase, raising=True)

    return fake_supabase


# ── User factories ────────────────────────────────────────────────────────────

def _user(role: str, uid: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        id=uid or f"{role}-uuid-1",
        app_metadata={"role": role},
        user_metadata={},
    )


@pytest.fixture
def student_user() -> SimpleNamespace:
    return _user("student", "student-uuid-1")


@pytest.fixture
def professor_user() -> SimpleNamespace:
    return _user("professor", "professor-uuid-1")


@pytest.fixture
def other_professor_user() -> SimpleNamespace:
    return _user("professor", "professor-uuid-2")


# ── FastAPI test client ───────────────────────────────────────────────────────

@pytest.fixture
def app(patch_supabase):  # patches must run before importing main
    from backend.main import app as fastapi_app
    yield fastapi_app
    fastapi_app.dependency_overrides.clear()


@pytest.fixture
def app_client(app, professor_user):
    """TestClient with verify_token + require_role overridden to return the
    professor by default. Tests that need a different identity should call
    `client.app.dependency_overrides[verify_token] = lambda: ...` themselves.
    """
    from fastapi.testclient import TestClient
    from backend.core.auth_middleware import verify_token, require_role

    def _verify():
        return professor_user

    def _require_role(*_args, **_kwargs):
        return lambda: professor_user

    app.dependency_overrides[verify_token] = _verify
    # require_role is a factory; override its returned dependency
    from backend.core import auth_middleware as am
    am.require_professor.__wrapped__ = lambda *a, **k: professor_user  # type: ignore[attr-defined]

    return TestClient(app)


@pytest.fixture
def authed(app):
    """Helper to swap the authenticated user mid-test.

    Usage:
        client = TestClient(app)
        authed.as_user(student_user)
        ...
    """
    from backend.core.auth_middleware import verify_token, require_professor, require_student

    class _Authed:
        def as_user(self, user):
            app.dependency_overrides[verify_token] = lambda: user
            app.dependency_overrides[require_professor] = lambda: user
            app.dependency_overrides[require_student] = lambda: user

        def clear(self):
            app.dependency_overrides.pop(verify_token, None)
            app.dependency_overrides.pop(require_professor, None)
            app.dependency_overrides.pop(require_student, None)

    return _Authed()


# ── Mock LLM provider ─────────────────────────────────────────────────────────

class FakeProvider:
    """Deterministic provider used in tests instead of Groq/Gemini/Ollama."""

    def __init__(self) -> None:
        self.text_calls: list[str] = []
        self.json_calls: list[str] = []
        self.vision_calls: list[tuple[str, str]] = []

    def generate_text(self, prompt: str) -> str:
        self.text_calls.append(prompt)
        return "FAKE_SUMMARY"

    def generate_json(self, prompt: str, schema=None) -> dict:
        self.json_calls.append(prompt)
        return {
            "question": "What is X?",
            "options": ["A", "B", "C", "D"],
            "correctAnswer": 0,
        }

    def analyze_image(self, b64: str, prompt: str) -> dict:
        self.vision_calls.append((b64[:8], prompt[:32]))
        return {"content_extraction": {"summary": "fake-vision"}}


@pytest.fixture
def mock_llm_provider(monkeypatch: pytest.MonkeyPatch) -> FakeProvider:
    fake = FakeProvider()

    from backend.domain import llm

    monkeypatch.setattr(
        llm.provider_factory,
        "get",
        lambda key: fake,
        raising=True,
    )
    return fake


# ── Rate limiter reset ────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_rate_limit() -> None:
    """slowapi keeps its state in module-level memory; reset per test."""
    try:
        from backend.core.rate_limit import limiter
        # `reset` clears all internal counters across all routes
        limiter.reset()
    except Exception:
        # Older slowapi: clear the storage manually
        try:
            limiter._storage.storage.clear()  # type: ignore[attr-defined]
        except Exception:
            pass



# ── Sample PDF bytes ──────────────────────────────────────────────────────────

@pytest.fixture
def sample_pdf_bytes() -> bytes:
    """Return bytes of a small in-memory 3-page PDF, generated with PyMuPDF."""
    import fitz
    doc = fitz.open()
    for i in range(3):
        page = doc.new_page()
        page.insert_text((72, 72), f"Slide {i+1} content")
    out = doc.tobytes()
    doc.close()
    return out
