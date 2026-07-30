"""Primitives for the unit-test outbound-access guard (wired up in `conftest.py`).

These live outside `conftest.py` on purpose: pytest may import a conftest under
a different module name than an ordinary `backend.tests.*` import would produce
(`tests.conftest` vs `backend.tests.conftest`), which would give tests a
*different* `BlockedOutboundAccess` class than the one the fixture raises and
make `pytest.raises` miss it.
"""
from __future__ import annotations


class BlockedOutboundAccess(BaseException):
    """A unit test tried to reach a real database / network endpoint.

    Deliberately derived from ``BaseException``, not ``Exception``: product code
    is full of ``except Exception`` handlers around DB and HTTP calls
    (``job_locks.acquire_job_lock``, ``cost.log_llm_call``,
    ``event_repo.insert_event``, the analytics cache-refresh endpoint …), and any
    one of them would otherwise swallow this and hand back the silent,
    non-deterministic behaviour the guard exists to prevent.
    """


_GUARD_HELP = """
Unit tests run with zero outbound access. Fix this by stubbing the call, e.g.

    monkeypatch.setattr(the_module, "the_db_helper", fake_async_helper)

or, for Supabase reads/writes, by requesting the `patch_supabase` fixture.

If the code under test genuinely needs a live Postgres, the test belongs in
backend/tests/db and must be marked `@pytest.mark.db`. To allow real outbound
access for one specific test, mark it `@pytest.mark.allow_network`.
"""


def blocked(kind: str, target: object = "") -> BlockedOutboundAccess:
    """Build the failure raised in place of a real connection."""
    where = f" to {target}" if target else ""
    return BlockedOutboundAccess(
        f"BLOCKED: unit test attempted a real {kind} connection{where}.\n{_GUARD_HELP}"
    )
