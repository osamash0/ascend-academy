"""Integration-suite fixtures.

Purpose: keep endpoint tests deterministic by severing the *ambient*
dependencies an HTTP test should never have. Same motivation as the
`DATABASE_URL` handling in `backend/tests/conftest.py`, which deliberately
assigns rather than `setdefault`s so a developer's shell cannot change what a
test means.
"""
from __future__ import annotations

import pytest

from backend.services import upload_service


@pytest.fixture(autouse=True)
def isolate_queue_depth(monkeypatch, request):
    """Report an empty Arq queue unless a test explicitly asks otherwise.

    Why this is needed. The upload endpoints apply queue backpressure before
    enqueueing (`backend/api/v1/upload.py:200-205` for the single-file stream,
    `:555-560` for batch), returning HTTP 429 once
    `upload_service.queue_depth()` reaches `ARQ_MAX_QUEUE_DEPTH` (default 50).
    `queue_depth()` issues a real `ZCARD` against the Arq Redis
    (`upload_service.py:44-63`), and under the test environment
    `redis_queue_url` resolves to the developer's own `redis://localhost:6379`.

    So on a machine with a real backlog the endpoint correctly returns 429 and
    the test fails — measured at 112 pending jobs on the machine where this
    was diagnosed. `test_check_duplicate.py::test_force_reparse_skips_cache`
    failed for exactly this reason, while its sibling
    `test_default_uses_cache` passed only because the parse-cache branch
    (`upload.py:134-178`) returns before the backpressure check is reached.

    The batch tests in `test_upload_batch_endpoints.py` passed only by
    accident: their `fake_arq_pool` fixture patches `get_arq_pool`, which
    `queue_depth()` calls internally, so the fake pool's missing `zcard`
    raised and the `except` returned 0. Remove that fixture and they would
    have failed too. This makes the isolation intentional instead.

    Opt out with `@pytest.mark.real_queue_depth` to exercise the real
    function, or request the `saturated_queue` fixture to drive the 429 path.
    """
    if request.node.get_closest_marker("real_queue_depth"):
        return

    async def _empty_queue() -> int:
        return 0

    monkeypatch.setattr(upload_service, "queue_depth", _empty_queue, raising=True)


@pytest.fixture
def saturated_queue(monkeypatch):
    """Drive the backpressure path deterministically.

    Reports a depth far above any plausible `ARQ_MAX_QUEUE_DEPTH` so a test
    can assert the 429 without depending on a real Redis backlog. Applied
    after `isolate_queue_depth` (function-scoped fixtures resolve in request
    order, and this one is requested explicitly), so it wins.
    """
    async def _full_queue() -> int:
        return 10_000

    monkeypatch.setattr(upload_service, "queue_depth", _full_queue, raising=True)
