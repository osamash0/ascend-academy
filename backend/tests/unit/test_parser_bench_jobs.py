import json
import threading
import time
from types import SimpleNamespace

import pytest

from backend.eval.parser_bench import execute, files, jobs
from backend.tests.unit.parser_bench_fixtures import make_deck


def wait_for(predicate, within=10.0):
    end = time.monotonic() + within
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(0.05)
    return False


@pytest.fixture
def stored(tmp_path):
    return files.store_pdf(make_deck(tmp_path / "deck.pdf").read_bytes(), "deck.pdf", root=tmp_path / "data")


def fake_run(status="finished", reason=None):
    return SimpleNamespace(meta={"run_id": "2026-10-30_fake-1_abcd", "status": status, "reason": reason})


def queue(tmp_path, runner, **kw):
    q = jobs.JobQueue(tmp_path / "data", runner=runner, poll=0.05, **kw)
    q.start()
    return q


def test_jobs_run_one_at_a_time_in_order(tmp_path, stored):
    spans = []

    def runner(tool, pdf, **kw):
        start = time.monotonic()
        time.sleep(0.2)
        spans.append((tool, start, time.monotonic()))
        return fake_run()

    q = queue(tmp_path, runner)
    try:
        ids = [q.submit_run(tool=t, sha256=stored.sha256, purpose="explore")["job_id"] for t in ("current", "pdfjs", "markitdown")]
        assert wait_for(lambda: all(q.get(i)["state"] == "finished" for i in ids))
    finally:
        q.stop()
    assert [s[0] for s in spans] == ["current", "pdfjs", "markitdown"]
    assert all(a[2] <= b[1] for a, b in zip(spans, spans[1:]))
    assert q.get(ids[0])["run_id"] == "2026-10-30_fake-1_abcd" and q.get(ids[0])["ended_at"]


def test_the_stage_of_a_running_job_is_visible(tmp_path, stored):
    release = threading.Event()

    def runner(tool, pdf, *, on_stage, **kw):
        on_stage("timed")
        release.wait(5)
        return fake_run()

    q = queue(tmp_path, runner)
    try:
        job = q.submit_run(tool="current", sha256=stored.sha256, purpose="explore")
        assert wait_for(lambda: q.get(job["job_id"])["stage"] == "timed")
        assert q.get(job["job_id"])["state"] == "running"
        release.set()
        assert wait_for(lambda: q.get(job["job_id"])["state"] == "finished")
        assert q.get(job["job_id"])["stage"] is None
    finally:
        release.set()
        q.stop()


def test_a_queued_job_is_cancelled_at_once_and_a_running_one_through_its_runner(tmp_path, stored):
    def runner(tool, pdf, *, cancel, **kw):
        cancel.wait(5)
        return fake_run("failed", f"{tool} was cancelled")

    q = queue(tmp_path, runner)
    try:
        first = q.submit_run(tool="current", sha256=stored.sha256, purpose="explore")
        second = q.submit_run(tool="pdfjs", sha256=stored.sha256, purpose="explore")
        assert wait_for(lambda: q.get(first["job_id"])["state"] == "running")
        assert q.cancel(second["job_id"])["state"] == "cancelled"
        q.cancel(first["job_id"])
        assert wait_for(lambda: q.get(first["job_id"])["state"] == "cancelled")
        assert q.get(first["job_id"])["error"] == "current was cancelled"
        with pytest.raises(ValueError, match="only a queued or running job"):
            q.cancel(first["job_id"])
    finally:
        q.stop()


def test_a_failing_job_records_why(tmp_path, stored):
    def runner(tool, pdf, **kw):
        raise RuntimeError("another timed run is in progress")

    q = queue(tmp_path, runner)
    try:
        job = q.submit_run(tool="current", sha256=stored.sha256, purpose="explore")
        assert wait_for(lambda: q.get(job["job_id"])["state"] == "failed")
        assert q.get(job["job_id"])["error"] == "RuntimeError: another timed run is in progress"
    finally:
        q.stop()


def test_jobs_left_by_a_stopped_server_are_interrupted(tmp_path):
    folder = tmp_path / "data" / "jobs"
    folder.mkdir(parents=True)
    (folder / "job-20261030000000abc123.json").write_text(json.dumps(
        {"job_id": "job-20261030000000abc123", "state": "running", "created_at": "1.0", "server_pid": -1}))
    q = jobs.JobQueue(tmp_path / "data")
    [job] = q.list()
    assert job["state"] == "interrupted" and "stopped" in job["error"]


def test_submissions_are_checked(tmp_path, stored, monkeypatch):
    monkeypatch.setattr(execute, "benchmark_pages", lambda sha: [])
    q = jobs.JobQueue(tmp_path / "data")
    with pytest.raises(ValueError, match="unknown method"):
        q.submit_run(tool="nope", sha256=stored.sha256, purpose="explore")
    with pytest.raises(ValueError, match="not in the benchmark page set"):
        q.submit_run(tool="current", sha256=stored.sha256, purpose="benchmark")
    with pytest.raises(FileNotFoundError):
        q.submit_run(tool="current", sha256="0" * 64, purpose="explore")
    with pytest.raises(ValueError, match="job id"):
        q.get("../x")


def test_an_install_job_calls_the_installer(tmp_path):
    installed = []
    q = queue(tmp_path, runner=None, installer=lambda tool: installed.append(tool.id))
    try:
        job = q.submit_install("markitdown")
        assert wait_for(lambda: q.get(job["job_id"])["state"] == "finished")
    finally:
        q.stop()
    assert installed == ["markitdown"]


def test_a_real_run_of_current_through_the_queue(tmp_path, stored):
    q = jobs.JobQueue(tmp_path / "data", poll=0.05)
    q.start()
    try:
        job = q.submit_run(tool="current", sha256=stored.sha256, purpose="explore")
        assert wait_for(lambda: q.get(job["job_id"])["state"] in ("finished", "failed"), within=60)
    finally:
        q.stop()
    done = q.get(job["job_id"])
    assert done["state"] == "finished" and done["run_id"]
    assert (tmp_path / "data" / "runs" / "extract" / done["run_id"] / "run.json").exists()


def test_stop_ends_a_running_job_and_a_second_start_is_refused_while_the_old_worker_lives(tmp_path, stored):
    release = threading.Event()

    def runner(tool, pdf, *, cancel, **kw):
        release.wait(5)  # ignores the cancel event for a while, like a method that is slow to stop
        return fake_run("failed", f"{tool} was cancelled")

    q = queue(tmp_path, runner)
    job = q.submit_run(tool="current", sha256=stored.sha256, purpose="explore")
    assert wait_for(lambda: q.get(job["job_id"])["state"] == "running")
    q.stop(timeout=0.2)  # returns with the worker still alive
    with pytest.raises(RuntimeError, match="still stopping"):
        q.start()
    assert sum(t.name == "parser-bench-jobs" and t.is_alive() for t in threading.enumerate()) == 1
    release.set()
    assert wait_for(lambda: q.get(job["job_id"])["state"] != "running")
    done = q.get(job["job_id"])
    assert done["state"] == "cancelled" and done["ended_at"] and done["stage"] is None
    q.stop()
    q.start()  # a stopped queue can start again
    q.stop()


def test_stop_cancels_the_running_job_through_its_runner(tmp_path, stored):
    def runner(tool, pdf, *, cancel, **kw):
        cancel.wait(5)
        return fake_run("failed", f"{tool} was cancelled")

    q = queue(tmp_path, runner)
    job = q.submit_run(tool="current", sha256=stored.sha256, purpose="explore")
    assert wait_for(lambda: q.get(job["job_id"])["state"] == "running")
    q.stop()
    done = q.get(job["job_id"])
    assert done["state"] == "cancelled" and done["ended_at"]


def test_a_stopping_queue_does_not_claim_a_queued_job(tmp_path, stored):
    q = jobs.JobQueue(tmp_path / "data", runner=lambda *a, **k: fake_run(), poll=0.05)
    job = q.submit_run(tool="current", sha256=stored.sha256, purpose="explore")
    q._stop.set()
    q._execute(job["job_id"])
    assert q.get(job["job_id"])["state"] == "queued"


def test_a_corrupt_journal_file_does_not_stop_the_queue(tmp_path, stored):
    folder = tmp_path / "data" / "jobs"
    folder.mkdir(parents=True)
    (folder / "job-20261030000000bad001.json").write_text("{not json")
    (folder / "job-20261030000000bad002.json").write_text(json.dumps({"job_id": "job-20261030000000bad002", "state": "queued"}))
    (folder / "job-20261030000000bad003.json").write_text("[]")
    q = queue(tmp_path, lambda tool, pdf, **kw: fake_run())
    try:
        job = q.submit_run(tool="current", sha256=stored.sha256, purpose="explore")
        assert wait_for(lambda: q.get(job["job_id"])["state"] == "finished")
        assert [j["job_id"] for j in q.list()] == [job["job_id"]]
    finally:
        q.stop()


def test_the_worker_survives_a_failing_write_and_runs_the_next_job(tmp_path, stored):
    calls = []

    def runner(tool, pdf, **kw):
        calls.append(tool)
        return fake_run()

    q = queue(tmp_path, runner)
    real_end = q._end
    broke = []

    def flaky_end(job_id, state, **fields):
        if not broke:
            broke.append(job_id)
            raise OSError("disk hiccup")
        return real_end(job_id, state, **fields)

    q._end = flaky_end
    try:
        first = q.submit_run(tool="current", sha256=stored.sha256, purpose="explore")
        assert wait_for(lambda: bool(broke))
        second = q.submit_run(tool="pdfjs", sha256=stored.sha256, purpose="explore")
        assert wait_for(lambda: q.get(second["job_id"])["state"] == "finished")
    finally:
        q.stop()
    assert calls == ["current", "pdfjs"] and broke == [first["job_id"]]


def test_a_started_install_cannot_be_cancelled(tmp_path):
    release = threading.Event()
    q = queue(tmp_path, runner=None, installer=lambda tool: release.wait(5))
    try:
        job = q.submit_install("markitdown")
        assert wait_for(lambda: q.get(job["job_id"])["state"] == "running")
        with pytest.raises(ValueError, match="can't be cancelled once it has started"):
            q.cancel(job["job_id"])
        assert q.get(job["job_id"])["stage"] != "cancelling"
    finally:
        release.set()
        q.stop()


def test_a_run_that_finished_stays_finished_even_if_cancel_came_late(tmp_path, stored):
    def runner(tool, pdf, *, cancel, **kw):
        cancel.wait(5)
        return fake_run()  # finished anyway

    q = queue(tmp_path, runner)
    try:
        job = q.submit_run(tool="current", sha256=stored.sha256, purpose="explore")
        assert wait_for(lambda: q.get(job["job_id"])["state"] == "running")
        q.cancel(job["job_id"])
        assert wait_for(lambda: q.get(job["job_id"])["state"] != "running")
        assert q.get(job["job_id"])["state"] == "finished"
    finally:
        q.stop()


def test_a_late_stage_does_not_overwrite_cancelling(tmp_path, stored):
    seen = []
    holder = {}

    def runner(tool, pdf, *, cancel, on_stage, **kw):
        cancel.wait(5)
        on_stage("scoring")
        seen.append(holder["q"].get(holder["id"])["stage"])
        return fake_run("failed", f"{tool} was cancelled")

    q = queue(tmp_path, runner)
    holder["q"] = q
    try:
        job = q.submit_run(tool="current", sha256=stored.sha256, purpose="explore")
        holder["id"] = job["job_id"]
        assert wait_for(lambda: q.get(job["job_id"])["state"] == "running")
        q.cancel(job["job_id"])
        assert wait_for(lambda: q.get(job["job_id"])["state"] == "cancelled")
    finally:
        q.stop()
    assert seen == ["cancelling"]


def test_a_job_cancelled_while_waiting_for_the_slot_is_cancelled(tmp_path, stored):
    def runner(tool, pdf, *, cancel, on_stage, **kw):
        on_stage("waiting")
        cancel.wait(5)
        raise jobs.execute.Cancelled("cancelled while waiting for the running method to finish")

    q = queue(tmp_path, runner)
    try:
        job = q.submit_run(tool="current", sha256=stored.sha256, purpose="explore")
        assert wait_for(lambda: q.get(job["job_id"])["stage"] == "waiting")
        q.cancel(job["job_id"])
        assert wait_for(lambda: q.get(job["job_id"])["state"] == "cancelled")
    finally:
        q.stop()
    done = q.get(job["job_id"])
    assert done["error"] == "cancelled while waiting for the running method to finish"
    assert done["run_id"] is None and done["stage"] is None and done["ended_at"]


def test_recovery_leaves_this_servers_jobs_alone_and_clears_the_stage_of_interrupted_ones(tmp_path):
    import os

    folder = tmp_path / "data" / "jobs"
    folder.mkdir(parents=True)
    base = {"kind": "run", "created_at": "1.0", "stage": "timed"}
    mine = {**base, "job_id": "job-20261030000000mine01", "state": "running", "server_pid": os.getpid()}
    theirs = {**base, "job_id": "job-20261030000000gone01", "state": "running", "server_pid": -1}
    for job in (mine, theirs):
        (folder / f"{job['job_id']}.json").write_text(json.dumps(job))
    q = jobs.JobQueue(tmp_path / "data")
    assert q.get(mine["job_id"])["state"] == "running" and q.get(mine["job_id"])["stage"] == "timed"
    gone = q.get(theirs["job_id"])
    assert gone["state"] == "interrupted" and gone["stage"] is None and gone["ended_at"]


JOB_KEYS = {"job_id", "state", "created_at", "queued_at", "started_at", "ended_at", "stage", "run_id", "error",
            "server_pid", "kind", "tool", "sha256", "file_name", "purpose", "cost_ok", "estimate"}


def test_a_paid_run_needs_cost_ok_and_records_its_estimate(tmp_path, stored):
    seen = []

    def runner(tool, pdf, **kw):
        seen.append((tool, kw.get("cost_ok")))
        return fake_run()

    q = queue(tmp_path, runner)
    try:
        with pytest.raises(ValueError, match="costs money"):
            q.submit_run(tool="ai_vision", sha256=stored.sha256, purpose="explore")
        job = q.submit_run(tool="ai_vision", sha256=stored.sha256, purpose="explore", cost_ok=True)
        assert job["cost_ok"] is True
        assert (job["estimate"]["model"], job["estimate"]["pages"]) == ("gpt-4.1-mini", 6) and job["estimate"]["usd"] > 0
        plain = q.submit_run(tool="current", sha256=stored.sha256, purpose="explore", cost_ok=True)
        assert (plain["cost_ok"], plain["estimate"]) == (False, None)
        assert wait_for(lambda: q.get(plain["job_id"])["state"] == "finished")
    finally:
        q.stop()
    assert seen == [("ai_vision", True), ("current", False)]
    # No field of a job can hold a key: its exact set of fields is known, and the estimate is numbers and a model id.
    assert {frozenset(j) for j in q.list()} == {frozenset(JOB_KEYS)}
    assert set(job["estimate"]) == {"model", "pages", "usd", "max_usd"}


def test_cost_ok_must_be_exactly_true(tmp_path, stored):
    q = jobs.JobQueue(tmp_path / "data")
    for not_ok in ("true", 1, "yes", None):
        with pytest.raises(ValueError, match="costs money"):
            q.submit_run(tool="ai_vision", sha256=stored.sha256, purpose="explore", cost_ok=not_ok)
    assert q.list() == []


def test_pages_for_is_the_runs_own_page_choice(tmp_path, stored, monkeypatch):
    q = jobs.JobQueue(tmp_path / "data")
    assert q.pages_for(stored, "explore") == [1, 2, 3, 4, 5, 6]
    calls = []
    monkeypatch.setattr(execute, "planned_pages", lambda pdf, pages, purpose: calls.append((pdf.name, pages, purpose)) or [2, 5])
    assert q.pages_for(stored, "benchmark") == [2, 5]
    assert calls == [(files.resolve_pdf(stored.sha256, q.root).name, None, "benchmark")]
    job = q.submit_run(tool="ai_vision", sha256=stored.sha256, purpose="benchmark", cost_ok=True)
    assert job["estimate"]["pages"] == 2


def test_a_refused_batch_queues_nothing(tmp_path, stored, monkeypatch):
    import dataclasses
    from backend.eval.parser_bench import tools
    monkeypatch.setitem(tools.TOOLS, "ai_vision_strong", dataclasses.replace(tools.TOOLS["ai_vision_strong"], model=""))
    q = jobs.JobQueue(tmp_path / "data")
    # the second method is paid and unconfirmed; the third has no model id yet (so no estimate can be made)
    with pytest.raises(ValueError, match="costs money"):
        q.submit_runs(["current", "ai_vision"], sha256=stored.sha256, purpose="explore", cost_ok=False)
    with pytest.raises(ValueError, match="model id"):
        q.submit_runs(["current", "ai_vision_strong"], sha256=stored.sha256, purpose="explore", cost_ok=True)
    assert q.list() == []
    twice = q.submit_runs(["ai_vision", "ai_vision"], sha256=stored.sha256, purpose="explore", cost_ok=True)
    assert [j["tool"] for j in twice] == ["ai_vision"]  # one OK pays for one run, never two
