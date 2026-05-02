"""Integration tests for the JWT auth middleware."""
import pytest
from types import SimpleNamespace

from backend.core import auth_middleware
from backend.services import cache as cache_module


class _AuthRes:
    def __init__(self, user):
        self.user = user


def test_verify_token_uses_cache(monkeypatch):
    cached_user = {"id": "u1", "app_metadata": {"role": "student"}}
    cache_module.store_cached_token("token-cached", cached_user)

    # Sentinel to ensure Supabase NOT called when cache hits
    called = {"hit": False}

    def fake_get_user(token):
        called["hit"] = True
        return _AuthRes(cached_user)

    monkeypatch.setattr(
        auth_middleware.supabase_admin.auth, "get_user", fake_get_user, raising=False
    )

    creds = SimpleNamespace(credentials="token-cached")
    user = auth_middleware.verify_token(credentials=creds)
    assert user == cached_user
    assert called["hit"] is False


def test_verify_token_calls_supabase_on_miss(monkeypatch):
    user = SimpleNamespace(id="u-2", app_metadata={"role": "student"})
    monkeypatch.setattr(
        auth_middleware.supabase_admin.auth,
        "get_user",
        lambda token: _AuthRes(user),
        raising=False,
    )
    creds = SimpleNamespace(credentials="fresh-token")
    out = auth_middleware.verify_token(credentials=creds)
    assert out is user


def test_verify_token_401_on_failure(monkeypatch):
    def boom(token):
        raise RuntimeError("invalid")

    monkeypatch.setattr(
        auth_middleware.supabase_admin.auth, "get_user", boom, raising=False
    )
    creds = SimpleNamespace(credentials="bad")
    with pytest.raises(Exception) as exc:
        auth_middleware.verify_token(credentials=creds)
    # FastAPI HTTPException
    assert getattr(exc.value, "status_code", None) == 401


def test_require_role_passes_with_app_metadata():
    """JWT app_metadata.role takes precedence and avoids a DB roundtrip."""
    user = SimpleNamespace(id="u1", app_metadata={"role": "professor"})
    checker = auth_middleware.require_role("professor")
    out = checker(user=user)
    assert out is user


def test_require_role_blocks_wrong_role():
    user = SimpleNamespace(id="u1", app_metadata={"role": "student"})
    checker = auth_middleware.require_role("professor")
    with pytest.raises(Exception) as exc:
        checker(user=user)
    assert getattr(exc.value, "status_code", None) == 403


def test_require_role_falls_back_to_db(monkeypatch):
    user = SimpleNamespace(id="u1", app_metadata={})

    monkeypatch.setattr(
        auth_middleware,
        "_lookup_role_from_db",
        lambda uid: {"professor"},
        raising=True,
    )
    checker = auth_middleware.require_role("professor")
    assert checker(user=user) is user


def test_require_role_does_not_consult_user_metadata():
    """User-controlled metadata must NEVER grant authz."""
    user = SimpleNamespace(
        id="u1",
        app_metadata={},
        user_metadata={"role": "professor"},
    )
    checker = auth_middleware.require_role("professor")
    # No app_metadata role and DB returns None → must reject
    with pytest.raises(Exception) as exc:
        checker(user=user)
    assert getattr(exc.value, "status_code", None) in (401, 403)
