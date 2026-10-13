import pytest

from backend.workers import arq_worker


def test_drain_cron_is_registered():
    names = {getattr(j.coroutine, "__name__", "") for j in arq_worker.WorkerSettings.cron_jobs}
    assert "drain_erasure_jobs_cron" in names


def test_drain_cron_runs_every_ten_minutes():
    job = next(
        j for j in arq_worker.WorkerSettings.cron_jobs
        if getattr(j.coroutine, "__name__", "") == "drain_erasure_jobs_cron"
    )
    assert job.minute == {0, 10, 20, 30, 40, 50}
    assert job.unique is True


@pytest.mark.asyncio
async def test_drain_cron_delegates(monkeypatch):
    seen = {}

    async def fake_drain(client=None, limit=20):
        seen["called"] = True
        return {"finished": 0, "retrying": 0, "cancelled": 0, "stuck": 0}

    monkeypatch.setattr(arq_worker.erasure, "drain", fake_drain)
    assert await arq_worker.drain_erasure_jobs_cron({}) == {
        "finished": 0, "retrying": 0, "cancelled": 0, "stuck": 0,
    }
    assert seen["called"]
