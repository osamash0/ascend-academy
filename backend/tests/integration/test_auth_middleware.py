"""Integration tests for the JWT auth middleware."""
from types import SimpleNamespace

import pytest

from backend.core import auth_middleware
from backend.services import cache as cache_module


class _AuthRes:
    def __init__(self, user):
        self.user = user


@pytest.fixture
def patched_auth(monkeypatch, patch_supabase):
    """Point both the cache layer AND the auth middleware at the same fake."""
    monkeypatch.setattr(
        auth_middleware, "supabase_admin", patch_supabase, raising=True
    )
    return patch_supabase


# ── verify_token ──────────────────────────────────────────────────────────────

async def test_verify_token_uses_cache(monkeypatch, patched_auth):
    cached_user = {"id": "u1", "app_metadata": {"role": "student"}}
    await cache_module.store_cached_token("token-cached", cached_user)

    # Sentinel: Supabase MUST NOT be called when the cache hits.
    called = {"hit": False}

    def fake_get_user(token):
        called["hit"] = True
        raise AssertionError("get_user must not run on a cache hit")

    monkeypatch.setattr(patched_auth.auth, "get_user", fake_get_user, raising=False)

    creds = SimpleNamespace(credentials="token-cached")
    user = await auth_middleware.verify_token(credentials=creds)

    # Cached dicts are wrapped in a Namespace so callers can use attribute access.
    assert user.id == "u1"
    assert user.app_metadata == {"role": "student"}
    assert called["hit"] is False


class _FakeResp:
    """Minimal stand-in for an httpx.Response."""

    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _patch_supabase_user_http(monkeypatch, patched_auth, payload, status_code=200):
    """Mock the httpx GET {auth_url}/user call verify_token now performs.

    The slow path was changed to hit Supabase Auth directly via
    httpx.AsyncClient.get instead of supabase_admin.auth.get_user, then
    rehydrate the user through CachedUser.from_dict(resp.json()). Tests mock
    the HTTP call and capture how many times it ran.
    """
    import httpx

    # verify_token reads supabase_admin.auth_url / .supabase_key to build the
    # request; the FakeSupabaseClient doesn't define these, so provide them.
    monkeypatch.setattr(
        patched_auth, "auth_url", "https://stub.supabase.co/auth/v1", raising=False
    )
    monkeypatch.setattr(patched_auth, "supabase_key", "stub-key", raising=False)

    calls = {"count": 0}

    async def fake_get(self, url, *args, **kwargs):
        calls["count"] += 1
        return _FakeResp(status_code, payload)

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get, raising=True)
    return calls


async def test_verify_token_calls_supabase_on_miss(monkeypatch, patched_auth):
    # New slow path: GET {auth_url}/user -> CachedUser.from_dict(resp.json()).
    payload = {"id": "u-2", "app_metadata": {"role": "student"}}
    calls = _patch_supabase_user_http(monkeypatch, patched_auth, payload)

    creds = SimpleNamespace(credentials="fresh-token")
    out = await auth_middleware.verify_token(credentials=creds)

    # verify_token now reconstructs a CachedUser from the JSON response, so it
    # is no longer the same object — assert on the rehydrated fields instead.
    assert calls["count"] == 1
    assert out.id == "u-2"
    assert out.app_metadata == {"role": "student"}


async def test_verify_token_caches_after_supabase_lookup(monkeypatch, patched_auth):
    """A successful Supabase lookup populates the shared cache."""
    payload = {"id": "u-3", "app_metadata": {"role": "professor"}}
    calls = _patch_supabase_user_http(monkeypatch, patched_auth, payload)

    creds = SimpleNamespace(credentials="cache-me")
    await auth_middleware.verify_token(credentials=creds)
    assert calls["count"] == 1

    # The next lookup must come from the cache, not the Supabase HTTP call.
    cached = await auth_middleware.verify_token(credentials=creds)
    assert calls["count"] == 1  # still 1 — HTTP path not hit again
    assert cached.id == "u-3"
    assert cached.app_metadata == {"role": "professor"}


async def test_verify_token_401_on_failure(monkeypatch, patched_auth):
    def boom(token):
        raise RuntimeError("invalid")

    monkeypatch.setattr(patched_auth.auth, "get_user", boom, raising=False)

    creds = SimpleNamespace(credentials="bad")
    with pytest.raises(Exception) as exc:
        await auth_middleware.verify_token(credentials=creds)
    assert getattr(exc.value, "status_code", None) == 401


async def test_verify_token_401_when_user_response_empty(monkeypatch, patched_auth):
    """Supabase returning a response with no user must yield a 401."""
    monkeypatch.setattr(
        patched_auth.auth,
        "get_user",
        lambda token: _AuthRes(None),
        raising=False,
    )

    creds = SimpleNamespace(credentials="ghost")
    with pytest.raises(Exception) as exc:
        await auth_middleware.verify_token(credentials=creds)
    assert getattr(exc.value, "status_code", None) == 401


# ── require_role ──────────────────────────────────────────────────────────────

async def test_require_role_passes_with_app_metadata():
    """JWT app_metadata.role takes precedence and avoids a DB roundtrip."""
    user = SimpleNamespace(id="u1", app_metadata={"role": "professor"})
    checker = auth_middleware.require_role("professor")
    out = await checker(user=user)
    assert out is user


async def test_require_role_blocks_wrong_role(monkeypatch):
    user = SimpleNamespace(id="u1", app_metadata={"role": "student"})
    # Ensure DB fallback can't rescue the wrong-role check.
    monkeypatch.setattr(
        auth_middleware, "_lookup_role_from_db", lambda uid: set(), raising=True
    )
    checker = auth_middleware.require_role("professor")
    with pytest.raises(Exception) as exc:
        await checker(user=user)
    assert getattr(exc.value, "status_code", None) == 403


async def test_require_role_falls_back_to_db(monkeypatch):
    user = SimpleNamespace(id="u1", app_metadata={})

    monkeypatch.setattr(
        auth_middleware,
        "_lookup_role_from_db",
        lambda uid: {"professor"},
        raising=True,
    )
    checker = auth_middleware.require_role("professor")
    assert await checker(user=user) is user


async def test_require_role_does_not_consult_user_metadata(monkeypatch):
    """User-controlled metadata must NEVER grant authz."""
    user = SimpleNamespace(
        id="u1",
        app_metadata={},
        user_metadata={"role": "professor"},
    )
    # DB has no role for this user.
    monkeypatch.setattr(
        auth_middleware, "_lookup_role_from_db", lambda uid: set(), raising=True
    )
    checker = auth_middleware.require_role("professor")
    with pytest.raises(Exception) as exc:
        await checker(user=user)
    assert getattr(exc.value, "status_code", None) in (401, 403)


async def test_require_role_401_when_no_user_id():
    """A user object without an id must be rejected with 401."""
    user = SimpleNamespace(app_metadata={"role": "professor"})
    checker = auth_middleware.require_role("professor")
    with pytest.raises(Exception) as exc:
        await checker(user=user)
    assert getattr(exc.value, "status_code", None) == 401


async def test_require_role_db_failure_is_not_fatal(monkeypatch):
    """If the DB lookup returns None (error) but JWT has the role, pass."""
    user = SimpleNamespace(id="u1", app_metadata={"role": "professor"})
    monkeypatch.setattr(
        auth_middleware, "_lookup_role_from_db", lambda uid: None, raising=True
    )
    checker = auth_middleware.require_role("professor")
    assert await checker(user=user) is user
