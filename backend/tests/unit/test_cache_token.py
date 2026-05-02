"""Unit tests for token cache (cache.py)."""
import time

import pytest
from freezegun import freeze_time

from backend.services import cache


class TestTokenCache:
    def test_round_trip(self):
        cache.store_cached_token("abc", {"id": "u1"})
        assert cache.get_cached_token("abc") == {"id": "u1"}

    def test_miss_returns_none(self):
        assert cache.get_cached_token("never-stored") is None

    def test_empty_token_no_op(self):
        cache.store_cached_token("", {"id": "u1"})
        assert cache.get_cached_token("") is None

    def test_invalidate_removes_entry(self):
        cache.store_cached_token("abc", {"id": "u1"})
        cache.invalidate_cached_token("abc")
        assert cache.get_cached_token("abc") is None

    def test_ttl_expiry(self):
        # Use monkeypatching of monotonic to simulate the clock without sleep
        import backend.services.cache as c

        original = time.monotonic
        t = [0.0]
        c.time.monotonic = lambda: t[0]  # type: ignore[attr-defined]
        try:
            c.store_cached_token("tok-x", {"id": "u1"})
            assert c.get_cached_token("tok-x") == {"id": "u1"}
            t[0] += c._TOKEN_TTL + 1
            assert c.get_cached_token("tok-x") is None
        finally:
            c.time.monotonic = original  # type: ignore[attr-defined]

    def test_lru_eviction(self):
        # Fill beyond MAX, then check the oldest token is evicted
        old_max = cache._TOKEN_CACHE_MAX
        cache._TOKEN_CACHE_MAX = 3  # type: ignore[attr-defined]
        try:
            for i in range(5):
                cache.store_cached_token(f"t-{i}", {"id": f"u{i}"})
            # First two should be evicted
            assert cache.get_cached_token("t-0") is None
            assert cache.get_cached_token("t-1") is None
            # Last three should remain
            assert cache.get_cached_token("t-4") is not None
        finally:
            cache._TOKEN_CACHE_MAX = old_max  # type: ignore[attr-defined]

    def test_token_is_hashed_not_stored_raw(self):
        cache.store_cached_token("super-secret", {"id": "u1"})
        # The raw token must never appear as a key
        for k in cache._token_cache.keys():  # type: ignore[attr-defined]
            assert "super-secret" not in k
