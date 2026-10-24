"""The limiter's counters must be shareable across worker processes.

Audit Q-C-F-12: slowapi kept its state in process memory, so every extra
uvicorn worker multiplied every per-user limit. The storage is now a
setting, Redis-backed in production (docker-compose.prod.yml), memory in
tests and single-process dev.
"""
from __future__ import annotations

from backend.core import rate_limit


def test_default_storage_is_in_memory():
    limiter = rate_limit.build_limiter("")
    assert limiter._storage_uri == "memory://"


def test_configured_storage_uri_is_used():
    limiter = rate_limit.build_limiter("redis://:pw@redis:6379/2")
    assert limiter._storage_uri == "redis://:pw@redis:6379/2"


def test_setting_exists_and_defaults_to_memory():
    from backend.core.config import settings

    assert settings.rate_limit_storage_uri == ""
