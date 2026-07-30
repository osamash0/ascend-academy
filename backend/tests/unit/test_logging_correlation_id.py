"""Regression test for the correlation-ID race (Roadmap Foundation 10x, P1-2).

Before this fix, backend/core/logging_config.py's CorrelationIdFilter kept
the current correlation id as a single mutable attribute on a module-global
instance. Under concurrent requests on the same worker, one request's
set_correlation_id() call could overwrite another's before all of its log
lines had been emitted, so a log line could carry the WRONG request's id.

This test drives many concurrent asyncio tasks — mirroring how FastAPI runs
each request in its own Task on one event loop — each setting its own id,
yielding control (so other tasks interleave), then logging. Every emitted
record must carry the id its OWN task set, never another task's.
"""
from __future__ import annotations

import asyncio
import logging

import pytest

from backend.core.logging_config import correlation_id_filter, set_correlation_id


class _RecordCollector(logging.Handler):
    def __init__(self):
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


@pytest.fixture
def captured_logger():
    logger = logging.getLogger("test.correlation_id")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    collector = _RecordCollector()
    logger.addFilter(correlation_id_filter)
    logger.addHandler(collector)
    try:
        yield logger, collector
    finally:
        logger.removeHandler(collector)
        logger.removeFilter(correlation_id_filter)


@pytest.mark.asyncio
async def test_concurrent_requests_each_keep_their_own_correlation_id(captured_logger):
    logger, collector = captured_logger

    async def handle_request(request_id: str) -> None:
        set_correlation_id(request_id)
        # Yield control so other concurrently-scheduled "requests" can run
        # set_correlation_id() before this one logs — this is exactly the
        # interleaving that broke the old module-global implementation.
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        logger.info("handled %s", request_id, extra={"request_id": request_id})

    request_ids = [f"req-{i}" for i in range(50)]
    await asyncio.gather(*(handle_request(rid) for rid in request_ids))

    assert len(collector.records) == 50
    for record in collector.records:
        expected = record.request_id
        assert record.correlation_id == expected, (
            f"log line for {expected} carried correlation_id={record.correlation_id!r} "
            "— it leaked from a concurrently-running request"
        )


@pytest.mark.asyncio
async def test_correlation_id_isolated_across_sibling_tasks():
    """A more direct check on the primitive itself: two sibling tasks set
    different ids; neither's read (_correlation_id_var.get() via the filter)
    should ever observe the other's value while both are alive."""
    from backend.core.logging_config import _correlation_id_var

    observed: dict[str, list[str]] = {"a": [], "b": []}

    async def task(name: str, my_id: str, other_started: asyncio.Event, started: asyncio.Event):
        set_correlation_id(my_id)
        started.set()
        await other_started.wait()
        for _ in range(5):
            observed[name].append(_correlation_id_var.get())
            await asyncio.sleep(0)

    a_started = asyncio.Event()
    b_started = asyncio.Event()
    await asyncio.gather(
        task("a", "id-a", b_started, a_started),
        task("b", "id-b", a_started, b_started),
    )

    assert observed["a"] == ["id-a"] * 5
    assert observed["b"] == ["id-b"] * 5
