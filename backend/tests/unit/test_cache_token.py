"""Unit tests for the Supabase-backed token cache (cache.py)."""
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from backend.services import cache


pytestmark = pytest.mark.usefixtures("patch_supabase")


class TestTokenCache:
    async def test_round_trip(self):
        await cache.store_cached_token("abc", {"id": "u1"})
        assert await cache.get_cached_token("abc") == {"id": "u1"}

    async def test_miss_returns_none(self):
        assert await cache.get_cached_token("never-stored") is None

    async def test_empty_token_no_op(self, patch_supabase):
        await cache.store_cached_token("", {"id": "u1"})
        assert await cache.get_cached_token("") is None
        # Nothing should have been persisted for the empty token.
        assert patch_supabase.tables.get("backend_cache", []) == []

    async def test_invalidate_removes_entry(self, patch_supabase):
        await cache.store_cached_token("abc", {"id": "u1"})
        assert await cache.get_cached_token("abc") == {"id": "u1"}

        await cache.invalidate_cached_token("abc")
        assert await cache.get_cached_token("abc") is None
        assert patch_supabase.tables.get("backend_cache", []) == []

    async def test_invalidate_empty_token_is_noop(self, patch_supabase):
        await cache.store_cached_token("abc", {"id": "u1"})
        await cache.invalidate_cached_token("")
        # Real entry must still be present after a no-op invalidate.
        assert await cache.get_cached_token("abc") == {"id": "u1"}

    async def test_ttl_expiry(self, patch_supabase):
        """Rows whose expires_at is in the past must not be returned."""
        await cache.store_cached_token("tok-x", {"id": "u1"})
        rows = patch_supabase.tables["backend_cache"]
        assert len(rows) == 1
        # Force the row to be already expired.
        rows[0]["expires_at"] = (datetime.utcnow() - timedelta(seconds=1)).isoformat()
        assert await cache.get_cached_token("tok-x") is None

    async def test_token_is_hashed_not_stored_raw(self, patch_supabase):
        await cache.store_cached_token("super-secret", {"id": "u1"})
        rows = patch_supabase.tables.get("backend_cache", [])
        assert rows, "expected a row to be persisted"
        for row in rows:
            assert "super-secret" not in row["cache_key"]
            assert row["cache_key"].startswith("auth_token:")
            # SHA-256 hex digest is 64 chars after the prefix.
            assert len(row["cache_key"].split(":", 1)[1]) == 64

    async def test_user_object_is_serialized(self, patch_supabase):
        """Supabase User objects (with __dict__) are flattened before storage."""
        user = SimpleNamespace(
            id="u9",
            app_metadata={"role": "student"},
            _internal="hide-me",
        )
        await cache.store_cached_token("tok-obj", user)
        result = await cache.get_cached_token("tok-obj")
        assert result == {"id": "u9", "app_metadata": {"role": "student"}}
        # Private/internal attrs must be filtered out.
        assert "_internal" not in result

    async def test_user_with_dict_method_is_serialized(self, patch_supabase):
        """If the user object exposes .dict(), that representation is stored."""

        class _PydanticLike:
            def dict(self):
                return {"id": "u10", "email": "a@b.test"}

        await cache.store_cached_token("tok-pyd", _PydanticLike())
        assert await cache.get_cached_token("tok-pyd") == {
            "id": "u10",
            "email": "a@b.test",
        }
