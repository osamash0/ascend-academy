"""Integration tests for POST /api/auth/delete-account (GDPR erasure).

Pins the AUTH-29 fix: account deletion must invoke the service-role admin API to
remove the auth.users row (which cascades to all referencing tables) — not just
delete client-reachable rows. The Supabase admin call is the only real I/O and is
mocked; we assert it's called with the caller's id and that failures surface as
502 (so the client knows the account was NOT fully deleted).
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import verify_token
from backend.api.v1 import auth as auth_api

H = {"Authorization": "Bearer x"}


class _RecordingAdmin:
    def __init__(self, fail=False):
        self.deleted: list[str] = []
        self._fail = fail

    @property
    def auth(self):
        outer = self

        class _Auth:
            class admin:  # noqa: N801 - mirrors supabase client shape
                @staticmethod
                def delete_user(uid):
                    if outer._fail:
                        raise RuntimeError("supabase admin unavailable")
                    outer.deleted.append(uid)

        return _Auth()


def test_delete_account_invokes_admin_delete_with_caller_id(app, professor_user, monkeypatch):
    admin = _RecordingAdmin()
    monkeypatch.setattr(auth_api, "supabase_admin", admin)
    app.dependency_overrides[verify_token] = lambda: professor_user

    r = TestClient(app).post("/api/auth/delete-account", headers=H)

    assert r.status_code == 200
    assert admin.deleted == [professor_user.id]


def test_delete_account_returns_502_when_admin_delete_fails(app, professor_user, monkeypatch):
    monkeypatch.setattr(auth_api, "supabase_admin", _RecordingAdmin(fail=True))
    app.dependency_overrides[verify_token] = lambda: professor_user

    r = TestClient(app).post("/api/auth/delete-account", headers=H)

    # Surfacing the failure (not a silent 200) matters: a 200 would tell the
    # client the account is gone when the auth identity actually survived.
    assert r.status_code == 502


def test_delete_account_requires_authentication(app, monkeypatch):
    monkeypatch.setattr(auth_api, "supabase_admin", _RecordingAdmin())
    # No verify_token override → the real dependency runs and rejects the
    # bogus bearer token.
    r = TestClient(app).post("/api/auth/delete-account", headers=H)
    assert r.status_code == 401
