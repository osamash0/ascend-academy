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
# Mount the review router during tests regardless of the real deploy's flag,
# so its own tests can exercise it through the real app. Production defaults
# to off (FEATURE_REVIEW_ENGINE unset) unless explicitly enabled.
os.environ.setdefault("FEATURE_REVIEW_ENGINE", "1")
os.environ.setdefault("FEATURE_EXAM_MODE", "1")
os.environ.setdefault("FEATURE_GLOBAL_SEARCH", "1")

# Assigned, not setdefault: whatever DATABASE_URL the developer's shell exports
# must NOT leak into a unit-test run. `backend.core.database` binds
# `DB_URL = os.environ.get("DATABASE_URL")` once at import, and `init_db_pool`
# returns early when it is empty (database.py:156) -- leaving `db_pool` unset, so
# `get_db_connection` raises RuntimeError("Database pool not initialized") on the
# next line and no socket is ever attempted.
#
# That made the outbound guard's coverage depend on the environment: with a
# DATABASE_URL present the pool attempt reached the socket and the guard fired;
# with it absent the RuntimeError won and the guard was never exercised. Same
# assertion, different meaning locally vs in CI.
#
# A syntactically valid but unroutable DSN (.invalid is reserved by RFC 2606)
# makes init_db_pool always attempt a connection, so the guard is what stops it,
# deterministically and in every environment. The db/ suite is unaffected: it
# takes its DSN from DB_TEST_LOCAL_ADMIN_DSN or testcontainers and never reads
# DATABASE_URL.
os.environ["DATABASE_URL"] = "postgresql://guard:guard@db.invalid:5432/unit_tests"

# Make repo root importable as `backend.*`
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import freezegun
import pytest

from backend.tests.fake_redis import FakeRedis  # noqa: E402
from backend.tests.fake_supabase import FakeSupabaseClient  # noqa: E402
from backend.tests.network_guard import blocked as _blocked  # noqa: E402

# ── freezegun / outbound-guard interaction ────────────────────────────────────
# freezegun walks sys.modules to repoint time references, and touching a
# module's attributes can run that module's lazy initialisation. `docker` (pulled
# in transitively by backend/tests/db/conftest.py's module-level
# `testcontainers.postgres` import, which pytest executes during *collection*
# even for `-m "not db"` runs) opens a socket to the daemon when probed. The
# outbound guard then raises, and because the exception surfaces inside
# `freeze_time.start()`, the corresponding `__exit__` never runs -- so the clock
# stays frozen for the remainder of the session. That is not a theoretical
# concern: it made test_cache_token::test_ttl_expiry fail 500 tests later and
# reported the suite duration as 20,569 days.
#
# freezegun ships this escape hatch for exactly this class of module (its
# defaults already exclude selenium, gi, prompt_toolkit).
freezegun.configure(extend_ignore_list=["docker", "testcontainers"])


# ── Outbound-access guard (unit tests only) ───────────────────────────────────
# Unit tests must never open a real socket, and in particular must never build a
# real asyncpg pool: `backend.core.database` caches `db_pool` at module level
# while pytest-asyncio hands every test its own event loop, so one leaked pool
# resurfaces as a *different* test failing with
#   InterfaceError: cannot perform operation: another operation is in progress
#   RuntimeError: ... got Future attached to a different loop
# The whole point of this guard is to turn that class of intermittent, hard-to-
# attribute breakage into an immediate failure in the test that caused it.
# See backend/tests/network_guard.py for the error type, and
# backend/tests/unit/test_outbound_guard.py for its coverage.

def _is_guarded_unit_test(request: pytest.FixtureRequest) -> bool:
    """True for tests under backend/tests/unit that haven't opted out.

    db/ integration/ contract/ tests manage their own access and are left alone.
    """
    test_file = Path(str(getattr(request.node, "path", None) or request.node.fspath))
    if "unit" not in test_file.parts:
        return False
    return request.node.get_closest_marker("allow_network") is None


@pytest.fixture(autouse=True)
def block_outbound_access(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch):
    """Make every real DB connection / network request from a unit test raise."""
    if not _is_guarded_unit_test(request):
        yield
        return

    import socket

    # 1. asyncpg — the pool-leak source. Patch the entry points rather than the
    #    caller so the message names the real culprit wherever it is reached from.
    import asyncpg

    def _no_asyncpg(*_args, **_kwargs):
        raise _blocked("Postgres (asyncpg)")

    monkeypatch.setattr(asyncpg, "create_pool", _no_asyncpg)
    monkeypatch.setattr(asyncpg, "connect", _no_asyncpg)

    # A pool leaked by an earlier test would bypass create_pool entirely, so
    # drop the cached one for the duration of this test.
    from backend.core import database as _database

    monkeypatch.setattr(_database, "db_pool", None, raising=False)

    # 2. httpx real transports (Supabase/PostgREST, storage, LLM providers).
    #    Only the network transports are patched — Starlette's TestClient uses
    #    ASGITransport, which stays fully functional.
    import httpx

    def _no_httpx_sync(_self, request_, *args, **kwargs):
        raise _blocked("HTTP", request_.url)

    async def _no_httpx_async(_self, request_, *args, **kwargs):
        raise _blocked("HTTP", request_.url)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", _no_httpx_sync)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", _no_httpx_async)

    # 3. requests, if anything still uses it.
    try:
        import requests.adapters

        def _no_requests(_self, request_, *args, **kwargs):
            raise _blocked("HTTP", getattr(request_, "url", ""))

        monkeypatch.setattr(requests.adapters.HTTPAdapter, "send", _no_requests)
    except Exception:
        pass

    # 4. Backstop at the socket layer, so a client library we do not know about
    #    (or a raw urllib call) cannot slip past the three checks above.
    def _no_connect(_self, address, *args, **kwargs):
        raise _blocked("socket", address)

    def _no_create_connection(address, *args, **kwargs):
        raise _blocked("socket", address)

    monkeypatch.setattr(socket.socket, "connect", _no_connect)
    monkeypatch.setattr(socket.socket, "connect_ex", _no_connect)
    monkeypatch.setattr(socket, "create_connection", _no_create_connection)

    yield


@pytest.fixture(autouse=True)
def fake_redis(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch):
    """Give unit tests an in-memory Redis instead of a real one.

    Unlike Supabase (which tests opt into via `patch_supabase`), Redis
    connections are opened *inside* the code under test — `unified_orchestrator`
    and `card_factory` build a throwaway `aioredis.from_url` connection for
    their in-flight locks, and `upload_service.get_arq_pool` builds an Arq pool
    — so there is no collaborator a test could stub instead. Without this,
    every such test silently talks to whatever Redis the dev machine happens to
    be running (and the guard above now turns that into a failure).

    `upload_service._arq_pool` is also reset per test: like
    `database.db_pool`, it is a module-level cache holding connections bound to
    one test's event loop.
    """
    if not _is_guarded_unit_test(request):
        yield None
        return

    shared = FakeRedis()

    import redis.asyncio as aioredis

    monkeypatch.setattr(aioredis, "from_url", lambda *a, **k: shared)
    monkeypatch.setattr(aioredis.Redis, "from_url", classmethod(lambda cls, *a, **k: shared))

    import arq.connections

    async def _fake_arq_pool(*_args, **_kwargs):
        return shared

    monkeypatch.setattr(arq.connections, "create_pool", _fake_arq_pool)

    from backend.services import upload_service

    monkeypatch.setattr(upload_service, "_arq_pool", None, raising=False)

    yield shared


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
    from backend.api.v1 import analytics as analytics_api
    from backend.services import cache as cache_module

    monkeypatch.setattr(database, "supabase_admin", fake_supabase, raising=True)
    monkeypatch.setattr(database, "supabase_anon", fake_supabase, raising=True)
    monkeypatch.setattr(database, "supabase", fake_supabase, raising=True)
    monkeypatch.setattr(analytics_service, "supabase_admin", fake_supabase, raising=False)
    monkeypatch.setattr(analytics_api, "supabase", fake_supabase, raising=True)
    monkeypatch.setattr(cache_module, "supabase_admin", fake_supabase, raising=True)

    from backend.services import analytics_cache as analytics_cache_module
    monkeypatch.setattr(analytics_cache_module, "supabase_admin", fake_supabase, raising=True)

    # upload.py imports supabase_admin by name at module-load — patch the
    # local reference so each test's fresh fake is the one used.
    try:
        from backend.api.v1 import upload as upload_api
        monkeypatch.setattr(upload_api, "supabase_admin", fake_supabase, raising=False)
    except Exception:
        pass

    # assignments.py also imports supabase_admin by name at module-load.
    try:
        from backend.api.v1 import assignments as assignments_api
        monkeypatch.setattr(assignments_api, "supabase_admin", fake_supabase, raising=False)
    except Exception:
        pass

    # schedule.py imports supabase_admin by name at module-load.
    try:
        from backend.api.v1 import schedule as schedule_api
        monkeypatch.setattr(schedule_api, "supabase_admin", fake_supabase, raising=False)
    except Exception:
        pass

    # courses.py / worksheets.py import supabase_admin at module load too.
    try:
        from backend.api.v1 import courses as courses_api
        monkeypatch.setattr(courses_api, "supabase_admin", fake_supabase, raising=False)
    except Exception:
        pass
    try:
        from backend.api.v1 import worksheets as worksheets_api
        monkeypatch.setattr(worksheets_api, "supabase_admin", fake_supabase, raising=False)
    except Exception:
        pass

    # slides_ai.py / practice_sheets.py import supabase_admin at module load too.
    try:
        from backend.api.v1 import slides_ai as slides_ai_api
        monkeypatch.setattr(slides_ai_api, "supabase_admin", fake_supabase, raising=False)
    except Exception:
        pass
    try:
        from backend.api.v1 import practice_sheets as practice_sheets_api
        monkeypatch.setattr(practice_sheets_api, "supabase_admin", fake_supabase, raising=False)
    except Exception:
        pass

    # diagnostics_service imports supabase_admin by name at module-load; its
    # get_pdf_diagnostics ownership lookup uses that local binding directly, so
    # patch it or the lookup hits the real network.
    try:
        from backend.services import diagnostics_service as diagnostics_svc
        monkeypatch.setattr(diagnostics_svc, "supabase_admin", fake_supabase, raising=False)
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

    # Patch create_client used by mind_map / analytics (module-level import).
    from backend.api.v1 import mind_map as mind_map_api
    from backend.api.v1 import ai_content as ai_api

    monkeypatch.setattr(mind_map_api, "create_client", lambda url, key: fake_supabase, raising=True)
    # ai_content (v1) no longer imports create_client — it uses supabase_admin
    # directly, and the AI create_client flows moved into services/ai/tutor_service
    # (which imports create_client from backend.core.database at call time). Patch
    # the source binding so those flows resolve the fake, plus ai_content's admin.
    monkeypatch.setattr(database, "create_client", lambda url, key: fake_supabase, raising=False)
    monkeypatch.setattr(ai_api, "supabase_admin", fake_supabase, raising=False)
    # mind_map.py imports supabase_admin by name at module-load — patch the
    # local binding so the admin-client ownership check uses the fake.
    monkeypatch.setattr(mind_map_api, "supabase_admin", fake_supabase, raising=False)

    return fake_supabase


# ── User factories ────────────────────────────────────────────────────────────

def _user(role: str, uid: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        id=uid or ("00000000-0000-0000-0000-000000000001" if role == "professor" else "00000000-0000-0000-0000-000000000002"),
        app_metadata={"role": role},
        user_metadata={},
    )


@pytest.fixture
def student_user() -> SimpleNamespace:
    return _user("student", "00000000-0000-0000-0000-000000000002")


@pytest.fixture
def professor_user() -> SimpleNamespace:
    return _user("professor", "00000000-0000-0000-0000-000000000001")


@pytest.fixture
def other_professor_user() -> SimpleNamespace:
    return _user("professor", "00000000-0000-0000-0000-000000000003")


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

    Also overrides `security` (the shared `HTTPBearer(auto_error=False)`
    dependency) so routes that additionally depend on it for the raw bearer
    token (e.g. to build an RLS-enforcing per-user Supabase client via
    `analytics_service.get_auth_client`, see P2-1) get a non-None
    credentials object without every test having to pass a real
    `Authorization` header.
    """
    from fastapi.testclient import TestClient
    from fastapi.security import HTTPAuthorizationCredentials
    from backend.core.auth_middleware import verify_token, security

    def _verify():
        return professor_user

    def _require_role(*_args, **_kwargs):
        return lambda: professor_user

    def _security():
        return HTTPAuthorizationCredentials(scheme="Bearer", credentials="fake-token")

    app.dependency_overrides[verify_token] = _verify
    app.dependency_overrides[security] = _security
    return TestClient(app)


@pytest.fixture
def authed(app):
    """Helper to swap the authenticated user mid-test.

    Usage:
        client = TestClient(app)
        authed.as_user(student_user)
        ...
    """
    from backend.core.auth_middleware import verify_token

    class _Authed:
        def as_user(self, user):
            app.dependency_overrides[verify_token] = lambda: user

        def clear(self):
            app.dependency_overrides.pop(verify_token, None)

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
