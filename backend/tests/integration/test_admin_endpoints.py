"""Integration tests for the platform admin endpoints."""
from __future__ import annotations
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient

from backend.api.v1 import admin as admin_api
from backend.core import auth_middleware
from backend.core.auth_middleware import verify_token


class MockConnection:
    def __init__(self, users_data=None, events_data=None, backups_data=None):
        self.users_data = users_data or []
        self.events_data = events_data or []
        self.backups_data = backups_data or []

    async def fetch(self, query, *args):
        # list_users's query selects from public.profiles but also embeds a
        # `FROM public.learning_events e` scalar subquery (for last_seen), so
        # a naive "public.learning_events" substring check matches BOTH the
        # events query and the users query. "LEFT JOIN public.profiles" is
        # unique to the events query (it joins profiles onto events; the
        # users query never joins profiles to itself), so check that first.
        if "LEFT JOIN public.profiles" in query:
            return self.events_data
        if "public.profiles" in query:
            return self.users_data
        if "public.learning_events" in query:
            return self.events_data
        if "public.analytics_backups" in query:
            return self.backups_data
        return []

    async def fetchval(self, query, *args):
        if "pg_stat_activity" in query:
            # Deliberately much larger than the pool's own size — R37: the
            # server-wide pg_stat_activity count must NOT be what the
            # endpoint reports, so this value should never surface in the
            # response even though this mock still answers the query if
            # something calls it.
            return 47
        return 1


class MockPool:
    def __init__(self, conn, size=8, idle=3, min_size=5, max_size=20):
        self.conn = conn
        self._size = size
        self._idle = idle
        self._min_size = min_size
        self._max_size = max_size

    def acquire(self):
        class AsyncContext:
            def __init__(self, conn):
                self.conn = conn
            async def __aenter__(self):
                return self.conn
            async def __aexit__(self, exc_type, exc_val, exc_tb):
                pass
        return AsyncContext(self.conn)

    # R37: mirror the subset of asyncpg.Pool's introspection API that
    # get_deployment_info now reads (checked-out connections + real min/max),
    # instead of the server-wide `pg_stat_activity` count it used to query.
    def get_size(self):
        return self._size

    def get_idle_size(self):
        return self._idle

    def get_min_size(self):
        return self._min_size

    def get_max_size(self):
        return self._max_size


@pytest.fixture
def admin_user():
    return SimpleNamespace(
        id="admin-uuid-123",
        app_metadata={"role": "admin"},
        user_metadata={},
    )


@pytest.fixture
def non_admin_user():
    return SimpleNamespace(
        id="student-uuid-456",
        app_metadata={"role": "student"},
        user_metadata={},
    )


@pytest.fixture
def patch_admin_deps(monkeypatch, fake_supabase, patch_supabase, admin_user):
    # Patch supabase client inside admin.py
    monkeypatch.setattr(admin_api, "supabase_admin", fake_supabase, raising=True)

    # Setup database mocks
    users_mock = [
        {
            "user_id": "u1",
            "email": "user1@example.com",
            "full_name": "User One",
            "display_name": "User1",
            "avatar_url": None,
            "total_xp": 100,
            "current_level": 2,
            "created_at": None,
            "last_seen": None,
            # asyncpg returns json/jsonb columns as raw JSON text, not a
            # parsed Python object — admin.py's list_users does
            # json.loads(r["roles"]), so the fixture must match that shape.
            "roles": '["student"]',
        }
    ]
    events_mock = [
        {
            "id": "e1",
            "user_id": "u1",
            "event_type": "slide_view",
            "event_data": {"slideIndex": 2},
            "created_at": None,
            "user_email": "user1@example.com",
            "user_name": "User1"
        }
    ]
    backups_mock = [
        {
            "id": "b1",
            "created_at": None,
            "size_bytes": 1024
        }
    ]

    mock_conn = MockConnection(users_mock, events_mock, backups_mock)
    mock_pool = MockPool(mock_conn)

    # Patch database pool in core.database and api.admin
    from backend.core import database
    monkeypatch.setattr(database, "db_pool", mock_pool, raising=False)
    monkeypatch.setattr(admin_api, "db_pool", mock_pool, raising=False)

    async def mock_init_db_pool():
        pass
    monkeypatch.setattr(database, "init_db_pool", mock_init_db_pool, raising=False)

    return fake_supabase


def test_admin_route_blocked_for_non_admin(app, patch_admin_deps, non_admin_user):
    app.dependency_overrides[verify_token] = lambda: non_admin_user
    app.dependency_overrides[admin_api.require_admin] = auth_middleware.require_role("admin")

    client = TestClient(app)
    r = client.get("/api/admin/users", headers={"Authorization": "Bearer token"})
    assert r.status_code == 403


def test_list_users_success(app, patch_admin_deps, admin_user):
    app.dependency_overrides[verify_token] = lambda: admin_user
    app.dependency_overrides[admin_api.require_admin] = lambda: admin_user

    client = TestClient(app)
    r = client.get("/api/admin/users", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert len(body["data"]) == 1
    assert body["data"][0]["email"] == "user1@example.com"


def test_list_events_success(app, patch_admin_deps, admin_user):
    app.dependency_overrides[verify_token] = lambda: admin_user
    app.dependency_overrides[admin_api.require_admin] = lambda: admin_user

    client = TestClient(app)
    r = client.get("/api/admin/events", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert len(body["data"]) == 1
    assert body["data"][0]["event_type"] == "slide_view"


def test_get_sentry_errors_unconfigured_returns_no_fabricated_issues(app, patch_admin_deps, admin_user, monkeypatch):
    """R1 regression: when Sentry env vars are unset, the endpoint must return
    an empty issue list plus an honest `configured: false` / `config_help`
    payload — never the three hand-written fake issues it used to return."""
    app.dependency_overrides[verify_token] = lambda: admin_user
    app.dependency_overrides[admin_api.require_admin] = lambda: admin_user

    monkeypatch.delenv("SENTRY_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("SENTRY_ORG", raising=False)
    monkeypatch.delenv("SENTRY_PROJECT", raising=False)

    client = TestClient(app)
    r = client.get("/api/admin/errors", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["configured"] is False
    assert body["data"] == []
    assert "config_help" in body
    assert body["config_help"]["has_token"] is False
    # None of the old fabricated incidents should ever appear again.
    assert "TypeError" not in str(body)
    assert "PostgresError" not in str(body)


def test_get_sentry_errors_configured_calls_sentry(app, patch_admin_deps, admin_user, monkeypatch):
    """When Sentry IS configured, the endpoint should call out to the real API
    (mocked here) rather than ever falling back to fabricated data."""
    app.dependency_overrides[verify_token] = lambda: admin_user
    app.dependency_overrides[admin_api.require_admin] = lambda: admin_user

    monkeypatch.setenv("SENTRY_AUTH_TOKEN", "token-123")
    monkeypatch.setenv("SENTRY_ORG", "learnstation")
    monkeypatch.setenv("SENTRY_PROJECT", "backend")

    class FakeResponse:
        status_code = 200

        def json(self):
            return [
                {
                    "id": "real-1",
                    "title": "Real Sentry issue",
                    "culprit": "backend/real.py",
                    "count": 3,
                    "userCount": 2,
                    "lastSeen": "2026-08-01T00:00:00Z",
                    "status": "unresolved",
                    "permalink": "https://sentry.io/real",
                    "level": "error",
                }
            ]

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return None

        async def get(self, *a, **kw):
            return FakeResponse()

    monkeypatch.setattr(admin_api.httpx, "AsyncClient", lambda *a, **kw: FakeAsyncClient())

    client = TestClient(app)
    r = client.get("/api/admin/errors", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    body = r.json()
    assert body["configured"] is True
    assert len(body["data"]) == 1
    assert body["data"][0]["title"] == "Real Sentry issue"


def test_toggle_course_visibility(app, patch_admin_deps, admin_user, fake_supabase):
    app.dependency_overrides[verify_token] = lambda: admin_user
    app.dependency_overrides[admin_api.require_admin] = lambda: admin_user

    fake_supabase.seed("courses", [{"id": "c1", "title": "Course 1", "is_archived": False}])

    client = TestClient(app)
    r = client.post("/api/admin/courses/c1/toggle-visibility", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["data"]["is_archived"] is True

    # Toggle back
    r = client.post("/api/admin/courses/c1/toggle-visibility", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    assert r.json()["data"]["is_archived"] is False


def test_toggle_lecture_visibility(app, patch_admin_deps, admin_user, fake_supabase):
    app.dependency_overrides[verify_token] = lambda: admin_user
    app.dependency_overrides[admin_api.require_admin] = lambda: admin_user

    fake_supabase.seed("lectures", [{"id": "l1", "title": "Lecture 1", "is_archived": False}])

    client = TestClient(app)
    r = client.post("/api/admin/lectures/l1/toggle-visibility", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["data"]["is_archived"] is True


def test_reset_and_backups_restore(app, patch_admin_deps, admin_user, fake_supabase):
    app.dependency_overrides[verify_token] = lambda: admin_user
    app.dependency_overrides[admin_api.require_admin] = lambda: admin_user

    # Mock RPCs
    fake_supabase.register_rpc("reset_all_analytics", lambda p: "backup-uuid-123")
    fake_supabase.register_rpc("restore_analytics", lambda p: True)

    client = TestClient(app)
    # Test reset
    r = client.post("/api/admin/reset-analytics", json={"confirmation": "RESET_ALL_DATA"}, headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    assert r.json()["success"] is True
    assert r.json()["backup_id"] == "backup-uuid-123"

    # Test list backups
    r = client.get("/api/admin/backups", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    assert len(r.json()["data"]) == 1

    # Test restore backup
    r = client.post("/api/admin/backups/backup-uuid-123/restore", json={"confirmation": "RESTORE_DATA"}, headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    assert r.json()["success"] is True


def test_get_deployment_info(app, patch_admin_deps, admin_user):
    app.dependency_overrides[verify_token] = lambda: admin_user
    app.dependency_overrides[admin_api.require_admin] = lambda: admin_user

    client = TestClient(app)
    r = client.get("/api/admin/deployment-info", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["data"]["health"]["database"] == "healthy"

    # R37: `database_connections` must be the pool's own checked-out count
    # (get_size() - get_idle_size() == 8 - 3 == 5), never the server-wide
    # `pg_stat_activity` count (mocked to 47 above) which includes every
    # other client on the same Postgres instance and is meaningless compared
    # to this app's own pool max.
    assert body["data"]["health"]["database_connections"] == 5
    assert body["data"]["health"]["database_connections"] != 47

    # DB_POOL_MIN/MAX must reflect the pool's real bounds (asyncpg's own
    # get_min_size()/get_max_size()), not a hand-duplicated literal that can
    # drift from what the pool was actually created with.
    assert body["data"]["environment"]["DB_POOL_MIN"] == "5"
    assert body["data"]["environment"]["DB_POOL_MAX"] == "20"


def test_get_deployment_info_app_version_matches_package_json(app, patch_admin_deps, admin_user):
    """R6 regression: app_version must be read from the real package.json
    ("3.0.0"), not the stale hardcoded "0.1.0-alpha" literal."""
    import json
    from pathlib import Path

    app.dependency_overrides[verify_token] = lambda: admin_user
    app.dependency_overrides[admin_api.require_admin] = lambda: admin_user

    client = TestClient(app)
    r = client.get("/api/admin/deployment-info", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    body = r.json()

    repo_root = Path(admin_api.__file__).resolve().parents[3]
    real_version = json.loads((repo_root / "package.json").read_text())["version"]

    assert body["data"]["deployments"]["app_version"] == real_version
    assert body["data"]["deployments"]["app_version"] != "0.1.0-alpha"


def test_get_deployment_info_api_health_reflects_db_check(app, patch_admin_deps, admin_user):
    """R4 regression: the "Platform API" health signal must be derived from
    the real DB health check performed by this endpoint, not a fabricated
    99.99% uptime figure (which was a frontend-only literal with no backing
    field at all). Degraded when the DB ping fails, healthy when it succeeds."""
    app.dependency_overrides[verify_token] = lambda: admin_user
    app.dependency_overrides[admin_api.require_admin] = lambda: admin_user

    client = TestClient(app)
    r = client.get("/api/admin/deployment-info", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    body = r.json()
    assert body["data"]["health"]["api"] == "healthy"  # DB ping succeeds via MockConnection


def test_get_deployment_info_api_health_degrades_with_db(app, patch_admin_deps, admin_user, monkeypatch):
    """Same signal, failure path: a broken DB ping must flip `health.api` to
    "degraded" rather than leaving a permanently-green status."""
    app.dependency_overrides[verify_token] = lambda: admin_user
    app.dependency_overrides[admin_api.require_admin] = lambda: admin_user

    class BrokenConn:
        async def fetchval(self, query, *args):
            raise RuntimeError("db down")

    class BrokenPool:
        def acquire(self):
            class AsyncContext:
                async def __aenter__(self):
                    return BrokenConn()

                async def __aexit__(self, *a):
                    return None
            return AsyncContext()

    # get_deployment_info does a local `from backend.core.database import
    # db_pool`, so the pool must be patched on that module, not admin_api.
    from backend.core import database
    monkeypatch.setattr(database, "db_pool", BrokenPool(), raising=False)

    client = TestClient(app)
    r = client.get("/api/admin/deployment-info", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    body = r.json()
    assert body["data"]["health"]["database"] == "unhealthy"
    assert body["data"]["health"]["api"] == "degraded"
