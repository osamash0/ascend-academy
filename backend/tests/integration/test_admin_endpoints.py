"""Integration tests for the platform admin endpoints."""
from __future__ import annotations
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient

from backend.api import admin as admin_api
from backend.core import auth_middleware
from backend.core.auth_middleware import verify_token


class MockConnection:
    def __init__(self, users_data=None, events_data=None, backups_data=None):
        self.users_data = users_data or []
        self.events_data = events_data or []
        self.backups_data = backups_data or []

    async def fetch(self, query, *args):
        if "public.learning_events" in query:
            return self.events_data
        if "public.profiles" in query:
            return self.users_data
        if "public.analytics_backups" in query:
            return self.backups_data
        return []

    async def fetchval(self, query, *args):
        if "pg_stat_activity" in query:
            return 5
        return 1


class MockPool:
    def __init__(self, conn):
        self.conn = conn

    def acquire(self):
        class AsyncContext:
            def __init__(self, conn):
                self.conn = conn
            async def __aenter__(self):
                return self.conn
            async def __aexit__(self, exc_type, exc_val, exc_tb):
                pass
        return AsyncContext(self.conn)


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
            "roles": ["student"]
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


def test_get_sentry_errors(app, patch_admin_deps, admin_user):
    app.dependency_overrides[verify_token] = lambda: admin_user
    app.dependency_overrides[admin_api.require_admin] = lambda: admin_user

    client = TestClient(app)
    r = client.get("/api/admin/errors", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["configured"] is False  # Fallback to mock issues
    assert len(body["data"]) > 0
    assert "TypeError" in body["data"][0]["title"]


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
    assert body["data"]["health"]["database_connections"] == 5
