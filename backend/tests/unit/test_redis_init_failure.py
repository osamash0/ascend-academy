"""init_redis must not leave a dead client behind when the ping fails."""
import pytest

import backend.core.redis as redis_mod


class _DeadClient:
    async def ping(self):
        raise ConnectionError("redis down")


@pytest.mark.asyncio
async def test_failed_init_leaves_no_client(monkeypatch):
    monkeypatch.setattr(redis_mod, "redis_client", None)
    monkeypatch.setattr(redis_mod.redis, "from_url", lambda *a, **k: _DeadClient())

    with pytest.raises(ConnectionError):
        await redis_mod.init_redis()

    assert redis_mod.redis_client is None
    from backend.services.ai.cost import get_redis_or_none
    assert get_redis_or_none() is None
