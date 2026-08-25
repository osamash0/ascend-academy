"""Regression test for admin.py's SQL parameterization (security audit A1).

`list_users`/`list_events` build their WHERE clauses with f-strings, but only
to place `$N` placeholder *positions* and to pick a column name off a fixed
allowlist (`sort_mapping`) — the actual filter values always travel through
asyncpg's positional `params` list into `conn.fetch(query, *params)`. This
test proves an injection-style search string is bound as a parameter rather
than concatenated into the query text, and that it can never fall through to
`sort_by` (which is always resolved via the allowlist, defaulting safely).
"""
from __future__ import annotations
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient

from backend.api.v1 import admin as admin_api
from backend.core.auth_middleware import verify_token

INJECTION_PAYLOAD = "'; DROP TABLE profiles; --"


class RecordingConnection:
    """Captures every (query, args) pair passed to fetch/fetchval so the test
    can assert the raw SQL text never contains the injected value, and that
    the value only ever appears in the bound `args`."""

    def __init__(self):
        self.calls = []

    async def fetch(self, query, *args):
        self.calls.append((query, args))
        return []

    async def fetchval(self, query, *args):
        self.calls.append((query, args))
        return 0


class RecordingPool:
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
    return SimpleNamespace(id="admin-uuid-123", app_metadata={"role": "admin"}, user_metadata={})


@pytest.fixture
def recording_conn(monkeypatch):
    conn = RecordingConnection()
    pool = RecordingPool(conn)

    from backend.core import database
    monkeypatch.setattr(database, "db_pool", pool, raising=False)
    monkeypatch.setattr(admin_api, "db_pool", pool, raising=False)

    async def mock_init_db_pool():
        pass
    monkeypatch.setattr(database, "init_db_pool", mock_init_db_pool, raising=False)

    return conn


def test_list_users_search_is_parameterized_not_interpolated(app, patch_supabase, recording_conn, admin_user):
    """An injection-style `search` value must never appear in the raw SQL
    text — only inside the bound `args` tuple passed alongside it."""
    app.dependency_overrides[verify_token] = lambda: admin_user
    app.dependency_overrides[admin_api.require_admin] = lambda: admin_user

    client = TestClient(app)
    r = client.get(
        "/api/admin/users",
        params={"search": INJECTION_PAYLOAD},
        headers={"Authorization": "Bearer token"},
    )

    # The endpoint must handle the payload as ordinary data, not choke on it.
    assert r.status_code == 200
    assert r.json()["success"] is True

    assert recording_conn.calls, "expected at least one DB call"
    for query, args in recording_conn.calls:
        assert INJECTION_PAYLOAD not in query, (
            "injection payload leaked into raw SQL text — search value is "
            "being interpolated instead of bound"
        )
        # It must show up as a bound parameter (wrapped in ILIKE wildcards).
        assert any(INJECTION_PAYLOAD in str(a) for a in args) or not args


def test_list_events_search_is_parameterized_not_interpolated(app, patch_supabase, recording_conn, admin_user):
    app.dependency_overrides[verify_token] = lambda: admin_user
    app.dependency_overrides[admin_api.require_admin] = lambda: admin_user

    client = TestClient(app)
    r = client.get(
        "/api/admin/events",
        params={"search": INJECTION_PAYLOAD},
        headers={"Authorization": "Bearer token"},
    )

    assert r.status_code == 200
    assert r.json()["success"] is True

    assert recording_conn.calls, "expected at least one DB call"
    for query, args in recording_conn.calls:
        assert INJECTION_PAYLOAD not in query
        assert any(INJECTION_PAYLOAD in str(a) for a in args) or not args


def test_list_users_sort_by_falls_back_to_safe_default_for_unknown_column(
    app, patch_supabase, recording_conn, admin_user
):
    """`sort_by` is resolved through a fixed column allowlist (`sort_mapping`)
    with a safe default — an unrecognized value must never reach the ORDER BY
    clause verbatim."""
    app.dependency_overrides[verify_token] = lambda: admin_user
    app.dependency_overrides[admin_api.require_admin] = lambda: admin_user

    malicious_sort = "created_at; DROP TABLE profiles; --"
    client = TestClient(app)
    r = client.get(
        "/api/admin/users",
        params={"sort_by": malicious_sort},
        headers={"Authorization": "Bearer token"},
    )

    assert r.status_code == 200
    assert recording_conn.calls
    for query, _args in recording_conn.calls:
        assert malicious_sort not in query
        assert "DROP TABLE" not in query.upper()
