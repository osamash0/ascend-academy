"""Unit tests for the Supabase-backed token cache (cache.py)."""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from enum import Enum
from types import SimpleNamespace
from uuid import UUID

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

    async def test_supabase_user_with_datetime_and_uuid_is_persisted(self, patch_supabase):
        """Regression: Supabase `User` carries datetime + UUID fields and used to
        crash `set_cache` because the underlying JSON encoder couldn't handle
        them. After the `_to_json_safe` fix, the row must land in `backend_cache`
        with those values coerced to strings."""
        uid = UUID("12345678-1234-5678-1234-567812345678")
        created = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
        last_signin = datetime(2026, 5, 1, 12, 0, 0, tzinfo=timezone.utc)

        user = SimpleNamespace(
            id=uid,
            email="prof@example.com",
            created_at=created,
            last_sign_in_at=last_signin,
            app_metadata={"role": "professor"},
        )
        await cache.store_cached_token("tok-sb", user)

        rows = patch_supabase.tables.get("backend_cache", [])
        assert len(rows) == 1, "expected one cache row to be persisted"
        stored = rows[0]["data"]
        assert stored["id"] == str(uid)
        assert stored["created_at"] == created.isoformat()
        assert stored["last_sign_in_at"] == last_signin.isoformat()
        assert stored["app_metadata"] == {"role": "professor"}

        # And the round-trip getter returns the same coerced payload.
        round_trip = await cache.get_cached_token("tok-sb")
        assert round_trip == stored

    async def test_set_cache_handles_decimal_enum_date_set(self, patch_supabase):
        """`set_cache` is the generic entry point — exercise the other coercions
        directly so we don't regress when callers pass non-User payloads."""

        class _Color(Enum):
            RED = "red"
            BLUE = "blue"

        payload = {
            "amount": Decimal("3.14"),
            "color": _Color.RED,
            "issued_on": date(2026, 5, 2),
            "tags": {"a", "b"},
        }
        await cache.set_cache("k-mixed", payload, ttl_seconds=60)

        rows = patch_supabase.tables.get("backend_cache", [])
        assert len(rows) == 1
        stored = rows[0]["data"]
        assert stored["amount"] == 3.14
        assert stored["color"] == "red"
        assert stored["issued_on"] == "2026-05-02"
        assert sorted(stored["tags"]) == ["a", "b"]
