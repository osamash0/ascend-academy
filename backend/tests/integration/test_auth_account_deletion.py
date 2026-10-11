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


def _wire(monkeypatch, calls, *, manifest_fails=False, job_fails=False, auth_fails=False, run_ok=True, ready_raises=False, run_raises=False, exists_after=True):
    from backend.services import erasure as er

    async def manifest(uid, client=None):
        calls.append(("manifest", uid))
        if manifest_fails:
            raise er.ErasureError("listing failed")
        return er.ErasureManifest(subject_id=uid)

    async def create(m, client=None):
        calls.append("job")
        if job_fails:
            raise er.ErasureError("insert failed")
        return "job-1"

    async def ready(job_id, client=None):
        calls.append("ready")
        if ready_raises:
            raise RuntimeError("db hiccup")

    async def run(job_id, client=None):
        calls.append("run")
        if run_raises:
            raise RuntimeError("db hiccup")
        return run_ok

    class _Admin:
        class auth:  # noqa: N801 - mirrors supabase client shape
            class admin:  # noqa: N801
                @staticmethod
                def delete_user(uid):
                    calls.append(("auth_delete", uid))
                    if auth_fails:
                        raise RuntimeError("auth down")

    monkeypatch.setattr(auth_api, "build_erasure_manifest", manifest)
    monkeypatch.setattr(auth_api, "create_erasure_job", create)
    monkeypatch.setattr(auth_api, "mark_erasure_job_ready", ready)
    monkeypatch.setattr(auth_api, "run_erasure_job", run)
    monkeypatch.setattr(auth_api, "supabase_admin", _Admin)
    # What auth says after a raising delete: True / None = maybe alive, False = gone.
    monkeypatch.setattr(auth_api, "erasure_auth_user_exists",
                        lambda c, uid: calls.append("exists?") or exists_after)


def test_delete_account_returns_502_when_admin_delete_fails(app, professor_user, monkeypatch):
    _wire(monkeypatch, [])
    monkeypatch.setattr(auth_api, "supabase_admin", _RecordingAdmin(fail=True))
    app.dependency_overrides[verify_token] = lambda: professor_user

    r = TestClient(app).post("/api/auth/delete-account", headers=H)

    # Surfacing the failure (not a silent 200) matters: a 200 would tell the
    # client the account is gone when the auth identity actually survived.
    assert r.status_code == 502


def test_delete_account_requires_authentication(app, monkeypatch):
    _wire(monkeypatch, [])
    monkeypatch.setattr(auth_api, "supabase_admin", _RecordingAdmin())
    # No verify_token override → the real dependency runs and rejects the
    # bogus bearer token.
    r = TestClient(app).post("/api/auth/delete-account", headers=H)
    assert r.status_code == 401


def _post(app, professor_user):
    app.dependency_overrides[verify_token] = lambda: professor_user
    return TestClient(app).post("/api/auth/delete-account", headers=H)


def test_records_the_job_before_deleting_and_removes_files_after(app, professor_user, monkeypatch):
    calls = []
    _wire(monkeypatch, calls)
    resp = _post(app, professor_user)
    assert resp.status_code == 200
    assert calls == [("manifest", professor_user.id), "job", ("auth_delete", professor_user.id), "ready", "run"]
    assert resp.json() == {"message": "Account deleted.", "files": "removed"}


def test_aborts_before_anything_when_the_manifest_fails(app, professor_user, monkeypatch):
    calls = []
    _wire(monkeypatch, calls, manifest_fails=True)
    resp = _post(app, professor_user)
    assert resp.status_code == 502
    assert calls == [("manifest", professor_user.id)]  # the account and its files are untouched


def test_aborts_when_the_job_cannot_be_recorded(app, professor_user, monkeypatch):
    calls = []
    _wire(monkeypatch, calls, job_fails=True)
    resp = _post(app, professor_user)
    assert resp.status_code == 502
    assert not any(isinstance(c, tuple) and c[0] == "auth_delete" for c in calls)


def test_says_files_are_finishing_when_the_run_is_deferred(app, professor_user, monkeypatch):
    calls = []
    _wire(monkeypatch, calls, run_ok=False)
    resp = _post(app, professor_user)
    assert resp.status_code == 200
    assert resp.json()["files"] == "finishing"


def test_502_when_auth_delete_fails_leaves_the_job_to_the_drain(app, professor_user, monkeypatch):
    calls = []
    _wire(monkeypatch, calls, auth_fails=True)
    resp = _post(app, professor_user)
    assert resp.status_code == 502
    assert "run" not in calls and "ready" not in calls



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


def test_a_failing_ready_mark_still_answers_200_finishing(app, professor_user, monkeypatch):
    calls = []
    _wire(monkeypatch, calls, ready_raises=True)
    resp = _post(app, professor_user)
    assert resp.status_code == 200
    assert resp.json()["files"] == "finishing"


def test_a_raising_run_still_answers_200_finishing(app, professor_user, monkeypatch):
    calls = []
    _wire(monkeypatch, calls, run_raises=True)
    resp = _post(app, professor_user)
    assert resp.status_code == 200
    assert resp.json()["files"] == "finishing"


def test_auth_delete_raising_after_it_landed_still_finishes(app, professor_user, monkeypatch):
    calls = []
    _wire(monkeypatch, calls, auth_fails=True, exists_after=False, run_ok=False)
    resp = _post(app, professor_user)
    assert resp.status_code == 200
    assert resp.json() == {"message": "Account deleted.", "files": "finishing"}
    assert calls[-3:] == ["exists?", "ready", "run"]


def test_auth_delete_raising_with_auth_unreachable_is_still_502(app, professor_user, monkeypatch):
    calls = []
    _wire(monkeypatch, calls, auth_fails=True, exists_after=None)
    resp = _post(app, professor_user)
    assert resp.status_code == 502
    assert "ready" not in calls and "run" not in calls
