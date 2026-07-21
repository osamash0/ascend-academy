"""Integration tests for POST /api/auth/delete-account (GDPR erasure).

Pins the AUTH-29 fix: account deletion must invoke the service-role admin API to
remove the auth.users row (which cascades to all referencing tables) — not just
delete client-reachable rows. The Supabase admin call is the only real I/O and is
mocked; we assert it's called with the caller's id and that failures surface as
502 (so the client knows the account was NOT fully deleted).
"""
from __future__ import annotations

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


async def _fake_erase(uid):
    """Stand-in for account_service.erase_user_storage_and_derived_data —
    these tests exercise the auth-endpoint wiring (rate limit, admin-delete
    call, error surfacing), not the storage/embeddings cleanup itself, which
    has its own coverage in test_account_service.py and
    test_gdpr_erasure_cascade.py (real local Postgres)."""
    return {
        "pdf_blobs_deleted": 0,
        "pdf_blobs_retained_shared": 0,
        "worksheet_files_deleted": 0,
        "slide_embeddings_deleted": 0,
    }


def test_delete_account_invokes_admin_delete_with_caller_id(app, professor_user, monkeypatch):
    admin = _RecordingAdmin()
    monkeypatch.setattr(auth_api, "supabase_admin", admin)
    monkeypatch.setattr(auth_api, "erase_user_storage_and_derived_data", _fake_erase)
    app.dependency_overrides[verify_token] = lambda: professor_user

    r = TestClient(app).post("/api/auth/delete-account", headers=H)

    assert r.status_code == 200
    assert admin.deleted == [professor_user.id]


def test_delete_account_returns_502_when_admin_delete_fails(app, professor_user, monkeypatch):
    monkeypatch.setattr(auth_api, "supabase_admin", _RecordingAdmin(fail=True))
    monkeypatch.setattr(auth_api, "erase_user_storage_and_derived_data", _fake_erase)
    app.dependency_overrides[verify_token] = lambda: professor_user

    r = TestClient(app).post("/api/auth/delete-account", headers=H)

    # Surfacing the failure (not a silent 200) matters: a 200 would tell the
    # client the account is gone when the auth identity actually survived.
    assert r.status_code == 502


def test_delete_account_requires_authentication(app, monkeypatch):
    monkeypatch.setattr(auth_api, "supabase_admin", _RecordingAdmin())
    monkeypatch.setattr(auth_api, "erase_user_storage_and_derived_data", _fake_erase)
    # No verify_token override → the real dependency runs and rejects the
    # bogus bearer token.
    r = TestClient(app).post("/api/auth/delete-account", headers=H)
    assert r.status_code == 401


def test_delete_account_proceeds_and_reports_when_storage_cleanup_errors(app, professor_user, monkeypatch):
    """Storage cleanup failing must not block DB-level erasure — the user's
    right to erasure of their DB-resident PII should not depend on a
    best-effort storage sweep succeeding."""
    admin = _RecordingAdmin()
    monkeypatch.setattr(auth_api, "supabase_admin", admin)

    async def _boom(uid):
        raise RuntimeError("storage backend unavailable")

    monkeypatch.setattr(auth_api, "erase_user_storage_and_derived_data", _boom)
    app.dependency_overrides[verify_token] = lambda: professor_user

    r = TestClient(app).post("/api/auth/delete-account", headers=H)

    assert r.status_code == 200
    assert admin.deleted == [professor_user.id]
    assert r.json()["storage_cleanup"] is None


def test_export_data_returns_caller_scoped_document(app, professor_user, monkeypatch):
    async def _fake_export(uid):
        return {"exported_at": "now", "user_id": uid, "profiles": []}

    monkeypatch.setattr(auth_api, "export_user_data", _fake_export)
    app.dependency_overrides[verify_token] = lambda: professor_user

    r = TestClient(app).get("/api/auth/export-data", headers=H)

    assert r.status_code == 200
    body = r.json()
    assert body["user_id"] == professor_user.id
    assert "profiles" in body


def test_export_data_requires_authentication(app):
    # No verify_token override → the real dependency runs and rejects the
    # bogus bearer token.
    r = TestClient(app).get("/api/auth/export-data", headers=H)
    assert r.status_code == 401


def test_export_data_returns_502_when_export_fails(app, professor_user, monkeypatch):
    async def _fake_export(uid):
        raise RuntimeError("db unavailable")

    monkeypatch.setattr(auth_api, "export_user_data", _fake_export)
    app.dependency_overrides[verify_token] = lambda: professor_user

    r = TestClient(app).get("/api/auth/export-data", headers=H)

    assert r.status_code == 502
