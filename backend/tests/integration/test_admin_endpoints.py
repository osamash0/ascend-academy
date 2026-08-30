"""Integration tests for the platform admin endpoints."""
from __future__ import annotations
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient

from backend.api.v1 import admin as admin_api
from backend.core import auth_middleware
from backend.core.auth_middleware import verify_token


class MockConnection:
    def __init__(self, users_data=None, events_data=None, backups_data=None, content_data=None):
        self.users_data = users_data or []
        self.events_data = events_data or []
        self.backups_data = backups_data or []
        self.content_data = content_data or []

    async def fetch(self, query, *args):
        # MUST come first: list_content's query joins public.profiles (to
        # resolve the owner's email), so it would otherwise be captured by
        # the "public.profiles" branch below and served users_data.
        if "content_rows" in query:
            return self.content_data
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

    content_mock = [
        {
            "id": "c1",
            "kind": "course",
            "title": "Datenbanksysteme",
            "is_archived": False,
            "course_id": None,
            "course_title": None,
            "visibility": None,
            "owner_id": "prof-1",
            "owner_kind": "professor",
            "owner_email": "prof@admin.com",
            "owner_name": "Informatics Professor",
            "lecture_count": 10,
            "enrollment_count": 0,
            "duplicate_title": True,
            "created_at": None,
        },
        {
            "id": "l1",
            "kind": "lecture",
            "title": "Private student upload",
            "is_archived": False,
            "course_id": None,
            "course_title": None,
            "visibility": "private_student",
            "owner_id": "stu-1",
            "owner_kind": "student",
            "owner_email": "abdul@test.com",
            "owner_name": "Abdulah",
            "lecture_count": 0,
            "enrollment_count": 0,
            "duplicate_title": False,
            "created_at": None,
        },
    ]

    mock_conn = MockConnection(users_mock, events_mock, backups_mock, content_mock)
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


def test_list_content_resolves_owner_for_both_upload_paths(app, patch_admin_deps, admin_user):
    """The whole point of the endpoint: say who owns each piece of content.

    Ownership is a two-column XOR — professor_id for course content,
    student_owner_id for private uploads — so a row must carry an
    identifiable owner regardless of which path created it.
    """
    app.dependency_overrides[verify_token] = lambda: admin_user
    app.dependency_overrides[admin_api.require_admin] = lambda: admin_user

    client = TestClient(app)
    r = client.get("/api/admin/content", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True

    course, lecture = body["data"][0], body["data"][1]
    assert course["owner_email"] == "prof@admin.com"
    assert course["owner_kind"] == "professor"
    assert lecture["owner_email"] == "abdul@test.com"
    assert lecture["owner_kind"] == "student"


def test_list_content_exposes_the_inputs_to_visibility(app, patch_admin_deps, admin_user):
    """Raw facts, not a computed verdict.

    We deliberately do NOT recompute the RLS predicates here — that would go
    stale the moment a policy changes. The endpoint surfaces the inputs
    (enrolment count, archived, visibility, duplicate titles) and the reader
    draws the conclusion.
    """
    app.dependency_overrides[verify_token] = lambda: admin_user
    app.dependency_overrides[admin_api.require_admin] = lambda: admin_user

    client = TestClient(app)
    r = client.get("/api/admin/content", headers={"Authorization": "Bearer token"})
    course = r.json()["data"][0]

    # 10 lectures but nobody enrolled → students see "0/0 lectures".
    assert course["lecture_count"] == 10
    assert course["enrollment_count"] == 0
    assert course["duplicate_title"] is True
    assert course["is_archived"] is False


def test_list_content_blocked_for_non_admin(app, patch_admin_deps, non_admin_user):
    app.dependency_overrides[verify_token] = lambda: non_admin_user
    app.dependency_overrides[admin_api.require_admin] = auth_middleware.require_role("admin")

    client = TestClient(app)
    r = client.get("/api/admin/content", headers={"Authorization": "Bearer token"})
    assert r.status_code == 403


class _RecordingAdminAuth:
    """Stub exposing just `.auth.admin.delete_user`, mirroring the client shape.

    Same approach as test_auth_account_deletion.py: the Supabase admin call is
    real I/O, so it's the one thing we stub. Everything else about the
    endpoint — the ownership guardrail, the self/last-admin checks — runs for
    real against the seeded fake.
    """

    def __init__(self, fake):
        self._fake = fake
        self.deleted: list[str] = []

    def __getattr__(self, name):
        return getattr(self._fake, name)

    @property
    def auth(self):
        outer = self

        class _Auth:
            class admin:  # noqa: N801 - mirrors supabase client shape
                @staticmethod
                def delete_user(uid):
                    outer.deleted.append(uid)

        return _Auth()


@pytest.fixture
def recording_admin(monkeypatch, fake_supabase):
    rec = _RecordingAdminAuth(fake_supabase)
    monkeypatch.setattr(admin_api, "supabase_admin", rec, raising=True)

    async def _fake_erase(uid):
        return {"pdf_blobs_deleted": 0, "pdf_blobs_retained_shared": 0,
                "worksheet_files_deleted": 0, "slide_embeddings_deleted": 0}

    monkeypatch.setattr(admin_api, "erase_user_storage_and_derived_data", _fake_erase, raising=False)
    return rec


def _as_admin(app, admin_user):
    app.dependency_overrides[verify_token] = lambda: admin_user
    app.dependency_overrides[admin_api.require_admin] = lambda: admin_user
    return TestClient(app)


def test_delete_users_refuses_a_content_owner(app, patch_admin_deps, admin_user, fake_supabase, recording_admin):
    """The guardrail that makes catastrophic loss structurally impossible.

    courses.professor_id and lectures.professor_id are both ON DELETE CASCADE
    on auth.users, so deleting a professor would take their whole catalogue —
    and every student's progress against it — with no PITR to recover from.
    """
    fake_supabase.seed("user_roles", [{"user_id": "prof-1", "role": "professor"},
                                      {"user_id": "admin-uuid-123", "role": "admin"}])
    fake_supabase.seed("courses", [{"id": "c1", "professor_id": "prof-1", "title": "Datenbanksysteme"}])
    fake_supabase.seed("lectures", [{"id": "l1", "professor_id": "prof-1", "title": "L1"},
                                    {"id": "l2", "professor_id": "prof-1", "title": "L2"}])

    client = _as_admin(app, admin_user)
    r = client.post("/api/admin/users/delete", json={"user_ids": ["prof-1"]},
                    headers={"Authorization": "Bearer token"})

    assert r.status_code == 200
    blocked = r.json()["data"]["blocked"]
    assert len(blocked) == 1
    assert blocked[0]["user_id"] == "prof-1"
    assert blocked[0]["reason"] == "owns_content"
    assert blocked[0]["courses"] == 1
    assert blocked[0]["lectures"] == 2
    # The account must still exist.
    assert recording_admin.deleted == []


def test_delete_users_removes_a_user_owning_nothing(app, patch_admin_deps, admin_user, fake_supabase, recording_admin):
    fake_supabase.seed("user_roles", [{"user_id": "stu-1", "role": "student"},
                                      {"user_id": "admin-uuid-123", "role": "admin"}])

    client = _as_admin(app, admin_user)
    r = client.post("/api/admin/users/delete", json={"user_ids": ["stu-1"]},
                    headers={"Authorization": "Bearer token"})

    assert r.status_code == 200
    assert r.json()["data"]["deleted"] == ["stu-1"]
    assert recording_admin.deleted == ["stu-1"]


def test_delete_users_refuses_self(app, patch_admin_deps, admin_user, fake_supabase, recording_admin):
    fake_supabase.seed("user_roles", [{"user_id": "admin-uuid-123", "role": "admin"},
                                      {"user_id": "other-admin", "role": "admin"}])

    client = _as_admin(app, admin_user)
    r = client.post("/api/admin/users/delete", json={"user_ids": ["admin-uuid-123"]},
                    headers={"Authorization": "Bearer token"})

    assert r.json()["data"]["blocked"][0]["reason"] == "self"
    assert recording_admin.deleted == []


def test_delete_users_refuses_the_last_admin(app, patch_admin_deps, admin_user, fake_supabase, recording_admin):
    """Locking every human out of the admin console is unrecoverable from the UI."""
    fake_supabase.seed("user_roles", [{"user_id": "lonely-admin", "role": "admin"}])

    client = _as_admin(app, admin_user)
    r = client.post("/api/admin/users/delete", json={"user_ids": ["lonely-admin"]},
                    headers={"Authorization": "Bearer token"})

    assert r.json()["data"]["blocked"][0]["reason"] == "last_admin"
    assert recording_admin.deleted == []


def test_deletion_impact_reports_without_deleting(app, patch_admin_deps, admin_user, fake_supabase, recording_admin):
    fake_supabase.seed("courses", [{"id": "c1", "professor_id": "prof-1", "title": "C"}])
    fake_supabase.seed("lectures", [{"id": "l1", "professor_id": "prof-1", "title": "L"}])
    fake_supabase.seed("course_enrollments", [{"course_id": "c1", "user_id": "stu-9"}])

    client = _as_admin(app, admin_user)
    r = client.post("/api/admin/users/deletion-impact", json={"user_ids": ["prof-1"]},
                    headers={"Authorization": "Bearer token"})

    assert r.status_code == 200
    impact = r.json()["data"][0]
    assert impact["courses"] == 1
    assert impact["lectures"] == 1
    assert impact["students_affected"] == 1
    assert impact["deletable"] is False
    assert recording_admin.deleted == []


def test_delete_users_blocked_for_non_admin(app, patch_admin_deps, non_admin_user):
    app.dependency_overrides[verify_token] = lambda: non_admin_user
    app.dependency_overrides[admin_api.require_admin] = auth_middleware.require_role("admin")

    client = TestClient(app)
    r = client.post("/api/admin/users/delete", json={"user_ids": ["x"]},
                    headers={"Authorization": "Bearer token"})
    assert r.status_code == 403


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
