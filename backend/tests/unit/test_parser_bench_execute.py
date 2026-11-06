import json
import subprocess
import threading
import time

import psutil
import pytest

from backend.eval.parser_bench import checks, execute, paid, store, tools
from backend.eval.parser_bench.tools import Tool
from backend.tests.unit.parser_bench_fixtures import TITLES, make_deck

FAKE_OK = '''
import json, sys
import fitz
with fitz.open(sys.argv[1]) as d:
    pages = {str(n): p.get_text("text") for n, p in enumerate(d, start=1)}
json.dump({"version": "9.9", "settings": {"fake": True}, "pages": pages}, open(sys.argv[2], "w"))
'''
FAKE_FAIL = 'import sys\nprint("boom")\nsys.exit(3)\n'
FAKE_SLOW = 'import time\ntime.sleep(30)\n'
FAKE_GAP = '''
import json, sys
import fitz
with fitz.open(sys.argv[1]) as d:
    pages = {str(n): p.get_text("text") for n, p in enumerate(d, start=1) if n != 4}
json.dump({"version": "9.9", "settings": {}, "pages": pages}, open(sys.argv[2], "w"))
'''


FAKE_TREE = r'''
import os, subprocess, sys, time
child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
open(os.environ["FAKE_PIDFILE"], "w").write(str(child.pid))
time.sleep(30)
'''
FAKE_ORPHAN = r'''
import json, subprocess, sys
subprocess.run(["sh", "-c", 'sleep 30 & echo $! > "$FAKE_PIDFILE"'], check=True)
json.dump({"version": "1", "settings": {}, "pages": {str(n): "" for n in range(1, 7)}}, open(sys.argv[2], "w"))
'''
FAKE_HEAVY = r'''
import json, subprocess, sys
child = "import time; b = bytearray(b'x' * (100 * 2**20)); time.sleep(1.0)"
subprocess.run([sys.executable, "-c", child], check=True)
json.dump({"version": "1", "settings": {}, "pages": {str(n): "" for n in range(1, 7)}}, open(sys.argv[2], "w"))
'''
FAKE_WARM_ONLY = '''
import json, sys
import fitz
with fitz.open(sys.argv[1]) as d:
    if len(d) > 2:
        sys.exit(3)
json.dump({"version": "9.9", "settings": {}, "pages": {"1": "", "2": ""}}, open(sys.argv[2], "w"))
'''
FAKE_RAW = '''
import sys
open(sys.argv[2], "w").write(%r)
'''
FULL = ", ".join(f'"{n}": "x"' for n in range(1, 7))


def raw_registry(tmp_path, payload):
    return registry(tmp_path, "raw", FAKE_RAW % payload)


def gone(pid, within=2.0):
    end = time.monotonic() + within
    while time.monotonic() < end:
        try:
            if psutil.Process(pid).status() == psutil.STATUS_ZOMBIE:
                return True
        except psutil.NoSuchProcess:
            return True
        time.sleep(0.05)
    return False


def registry(tmp_path, name, body):
    script = tmp_path / f"{name}.py"
    script.write_text(body)
    return {name: Tool(name, name, "fast", str(script), "test double")}


@pytest.fixture
def deck(tmp_path):
    return make_deck(tmp_path / "deck.pdf")


def test_a_finished_run_has_pages_checks_and_cost(tmp_path, deck):
    run = execute.run_tool("fake", deck, pages=[3, 2], root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK))
    m = run.meta
    assert (m["status"], m["version"], m["pages_scored"], m["missing_pages"]) == ("finished", "9.9", [2, 3], [])
    assert m["settings"] == {"fake": True}
    assert set(run.pages()) == {2, 3}
    rows = run.checks()
    assert [r["page"] for r in rows] == ["2", "3"] and rows[0]["footer_leaks"] == "3"
    assert m["seconds_per_page"] >= 0 and m["warmup_seconds"] is not None
    assert m["peak_memory_mb"] is None or m["peak_memory_mb"] > 0  # a 0.0 would look like a real measurement
    assert m["source"]["pages_total"] == 6 and len(m["source"]["sha256"]) == 64
    assert any(line.startswith("pymupdf==") for line in m["environment"])


def test_a_failing_method_leaves_a_failed_run(tmp_path, deck):
    run = execute.run_tool("bad", deck, root=tmp_path / "data", registry=registry(tmp_path, "bad", FAKE_FAIL))
    assert run.meta["status"] == "failed" and "code 3" in run.meta["reason"]
    assert "boom" in (run.path / "log.txt").read_text()


def test_a_timeout_is_a_failed_run(tmp_path, deck):
    run = execute.run_tool("slow", deck, root=tmp_path / "data", warmup=False, timeout=1,
                           registry=registry(tmp_path, "slow", FAKE_SLOW))
    assert run.meta["status"] == "failed" and "timed out" in run.meta["reason"]


@pytest.mark.parametrize("selected", [None, [1, 2]])
def test_a_method_that_skips_a_page_leaves_a_failed_run(tmp_path, deck, selected):
    run = execute.run_tool("gap", deck, pages=selected, warmup=False, root=tmp_path / "data",
                           registry=registry(tmp_path, "gap", FAKE_GAP))
    m = run.meta
    assert m["status"] == "failed" and m["reason"] == "missing pages [4]" and m["missing_pages"] == [4]
    kept = {1, 2} if selected else {1, 2, 3, 5, 6}  # what the tool did produce, for diagnosis
    assert set(run.pages()) == kept and [int(r["page"]) for r in run.checks()] == sorted(kept)
    assert m["seconds_per_page"] >= 0 and "peak_memory_mb" in m and m["environment"]


def test_pages_outside_the_file_are_refused(tmp_path, deck):
    with pytest.raises(ValueError, match="outside"):
        execute.run_tool("fake", deck, pages=[7], root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK))


@pytest.fixture
def bench_ready(monkeypatch):
    """A committed protocol, a clean bench, and pages 2 and 5 of any file in the page set."""
    monkeypatch.setattr(execute, "protocol_commit", lambda: "abc123")
    monkeypatch.setattr(execute, "bench_changes", lambda: [])
    monkeypatch.setattr(execute, "bench_drift", lambda commit: [])
    monkeypatch.setattr(execute, "bench_tree", lambda rev="HEAD": "tree0")
    monkeypatch.setattr(execute, "benchmark_pages", lambda sha: [2, 5])


def test_benchmark_runs_need_a_committed_protocol(tmp_path, deck, monkeypatch, bench_ready):
    reg = registry(tmp_path, "fake", FAKE_OK)
    monkeypatch.setattr(execute, "protocol_commit", lambda: None)
    with pytest.raises(RuntimeError, match="PROTOCOL.md"):
        execute.run_tool("fake", deck, purpose="benchmark", root=tmp_path / "data", registry=reg)
    monkeypatch.setattr(execute, "protocol_commit", lambda: "abc123")
    run = execute.run_tool("fake", deck, purpose="benchmark", root=tmp_path / "data", registry=reg)
    assert (run.meta["purpose"], run.meta["protocol_commit"], run.meta["pages_scored"]) == ("benchmark", "abc123", [2, 5])


def test_a_method_that_is_not_ready_is_refused(tmp_path, deck):
    reg = {"ghost": Tool("ghost", "Ghost", "fast", "ghost_runner.py", "missing", requirements=("nothing",))}
    with pytest.raises(execute.ToolNotReady):
        execute.run_tool("ghost", deck, root=tmp_path / "data", registry=reg)


def test_a_timeout_kills_the_whole_process_tree(tmp_path, deck, monkeypatch):
    pidfile = tmp_path / "child.pid"
    monkeypatch.setenv("FAKE_PIDFILE", str(pidfile))
    run = execute.run_tool("tree", deck, root=tmp_path / "data", warmup=False, timeout=1,
                           registry=registry(tmp_path, "tree", FAKE_TREE))
    assert run.meta["status"] == "failed" and "timed out" in run.meta["reason"]
    assert gone(int(pidfile.read_text()))


def test_a_child_left_behind_by_a_finished_runner_is_killed(tmp_path, deck, monkeypatch):
    pidfile = tmp_path / "orphan.pid"
    monkeypatch.setenv("FAKE_PIDFILE", str(pidfile))
    run = execute.run_tool("orphan", deck, root=tmp_path / "data", warmup=False,
                           registry=registry(tmp_path, "orphan", FAKE_ORPHAN))
    assert run.meta["status"] == "finished"
    assert gone(int(pidfile.read_text().strip()))


def test_ctrl_c_leaves_no_runner_behind(tmp_path, deck, monkeypatch):
    pidfile = tmp_path / "child.pid"
    monkeypatch.setenv("FAKE_PIDFILE", str(pidfile))
    real, calls = execute._tree_rss, []

    def interrupted(*args, **kwargs):
        calls.append(1)
        if len(calls) == 8:  # about 0.7 s in, long after the runner wrote its child's pid
            raise KeyboardInterrupt
        return real(*args, **kwargs)

    monkeypatch.setattr(execute, "_tree_rss", interrupted)
    tool = registry(tmp_path, "tree", FAKE_TREE)["tree"]
    with pytest.raises(KeyboardInterrupt):
        execute.invoke(tool, deck, timeout=30)
    assert gone(int(pidfile.read_text()))


def test_memory_of_a_child_process_is_counted(tmp_path, deck):
    run = execute.run_tool("heavy", deck, root=tmp_path / "data", warmup=False,
                           registry=registry(tmp_path, "heavy", FAKE_HEAVY))
    assert run.meta["status"] == "finished" and run.meta["peak_memory_mb"] >= 80


def test_a_psutil_error_while_listing_children_does_not_end_the_run(tmp_path, deck, monkeypatch):
    def vanished(self, recursive=False):
        raise psutil.NoSuchProcess(self.pid)

    monkeypatch.setattr(psutil.Process, "children", vanished)
    run = execute.run_tool("fake", deck, warmup=False, root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK))
    assert run.meta["status"] == "finished"


def test_warmup_can_work_and_the_timed_run_fail(tmp_path, deck):
    run = execute.run_tool("warm", deck, root=tmp_path / "data", registry=registry(tmp_path, "warm", FAKE_WARM_ONLY))
    assert run.meta["status"] == "failed" and "code 3" in run.meta["reason"]
    assert run.meta["version"] == "9.9"  # learned from the warm-up


@pytest.mark.parametrize("payload", [
    '{"pages": ["a"]}',
    '{"pages": {"1": null}}',
    '{"pages": {"one": "x"}}',
    '{"pages": {"1": "x"}, "settings": ["a"]}',
    '["pages"]',
    "not json",
])
def test_malformed_output_is_a_failed_run_not_a_crash(tmp_path, deck, payload):
    run = execute.run_tool("raw", deck, warmup=False, root=tmp_path / "data", registry=raw_registry(tmp_path, payload))
    assert run.meta["status"] == "failed" and ("malformed" in run.meta["reason"] or "readable" in run.meta["reason"])


def test_null_settings_are_the_same_as_none(tmp_path, deck):
    run = execute.run_tool("raw", deck, warmup=False, root=tmp_path / "data",
                           registry=raw_registry(tmp_path, '{"pages": {%s}, "settings": null}' % FULL))
    assert run.meta["status"] == "finished" and run.meta["settings"] == {}


def test_an_error_after_the_run_seals_it_as_failed(tmp_path, deck, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("scoring blew up")

    monkeypatch.setattr(execute.checks, "check_page", boom)
    run = execute.run_tool("fake", deck, warmup=False, root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK))
    assert run.meta["status"] == "failed" and run.meta["reason"] == "error after run: RuntimeError: scoring blew up"


def test_an_unknown_purpose_is_refused_before_anything_runs(tmp_path, deck, monkeypatch):
    monkeypatch.setattr(execute, "invoke", lambda *a, **k: pytest.fail("the tool ran"))
    with pytest.raises(ValueError, match="purpose"):
        execute.run_tool("fake", deck, purpose="benchmarks", root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK))
    assert not (tmp_path / "data").exists()


def test_a_data_root_inside_the_repo_is_refused_before_the_long_run(tmp_path, deck, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(execute.store.REPO / "bench-data"))
    monkeypatch.setattr(execute, "invoke", lambda *a, **k: pytest.fail("the tool ran"))
    with pytest.raises(ValueError, match="inside the repository"):
        execute.run_tool("fake", deck, registry=registry(tmp_path, "fake", FAKE_OK))
    assert not (execute.store.REPO / "bench-data").exists()


def test_an_unreadable_pdf_is_found_before_the_long_run(tmp_path, deck, monkeypatch):
    monkeypatch.setattr(execute, "invoke", lambda *a, **k: pytest.fail("the tool ran"))
    monkeypatch.setattr(execute.checks, "document_facts", lambda pdf: (_ for _ in ()).throw(RuntimeError("bad pdf")))
    with pytest.raises(RuntimeError, match="bad pdf"):
        execute.run_tool("fake", deck, root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK))
    assert not (tmp_path / "data").exists()


def git(repo, *args):
    cmd = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false",
           "-c", "core.hooksPath=/dev/null", "-C", str(repo), *args]
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout.strip()


@pytest.fixture
def protocol_repo(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    protocol = repo / "docs" / "PROTOCOL.md"
    protocol.parent.mkdir(parents=True)
    git(repo, "init", "-q")
    monkeypatch.setattr(execute, "PROTOCOL", protocol)
    monkeypatch.setattr(execute.store, "REPO", repo)
    return repo, protocol


def test_protocol_commit_is_none_unless_the_file_is_committed_and_unedited(protocol_repo):
    repo, protocol = protocol_repo
    assert execute.protocol_commit() is None  # missing
    protocol.write_text("v1\n")
    assert execute.protocol_commit() is None  # untracked
    git(repo, "add", "docs/PROTOCOL.md")
    git(repo, "commit", "-q", "-m", "protocol")
    protocol.write_text("v2\n")
    assert execute.protocol_commit() is None  # edited since


def test_protocol_commit_is_the_commit_that_last_changed_the_file(protocol_repo):
    repo, protocol = protocol_repo
    protocol.write_text("v1\n")
    git(repo, "add", "docs/PROTOCOL.md")
    git(repo, "commit", "-q", "-m", "protocol")
    sha = git(repo, "rev-parse", "HEAD")
    assert execute.protocol_commit() == sha  # committed and clean
    (repo / "other.txt").write_text("x")
    git(repo, "add", "other.txt")
    git(repo, "commit", "-q", "-m", "unrelated")
    assert execute.protocol_commit() == sha  # a later commit elsewhere does not move it


def test_a_run_too_short_to_sample_has_no_peak_instead_of_a_made_up_zero(tmp_path, deck, monkeypatch):
    monkeypatch.setattr(execute, "_tree_rss", lambda *args, **kwargs: 0)
    run = execute.run_tool("fake", deck, warmup=False, root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK))
    assert run.meta["status"] == "finished" and run.meta["peak_memory_mb"] is None


# --- what every record says about how it ended (ruling B) ----------------------------


def test_a_finished_run_records_its_versions_timeout_and_no_failed_stage(tmp_path, deck):
    run = execute.run_tool("fake", deck, warmup=False, timeout=120, root=tmp_path / "data",
                           registry=registry(tmp_path, "fake", FAKE_OK))
    m = run.meta
    assert m["status"] == "finished"
    assert (m["record_version"], m["checks_version"]) == (store.RECORD_VERSION, checks.CHECKS_VERSION)
    assert (m["timeout_s"], m["failed_stage"]) == (120, None)


@pytest.mark.parametrize("body", [FAKE_OK, FAKE_FAIL], ids=["finished", "failed"])
def test_the_git_state_is_taken_when_the_run_starts(tmp_path, deck, monkeypatch, body):
    """A commit made while a long run is going must not be credited with its result."""
    ran, real_invoke = [], execute.invoke

    def spy(*args, **kwargs):
        ran.append(1)
        return real_invoke(*args, **kwargs)

    monkeypatch.setattr(execute, "invoke", spy)
    monkeypatch.setattr(execute.store, "git_state", lambda: {"commit": "later" if ran else "at-start", "dirty": False})
    run = execute.run_tool("t", deck, root=tmp_path / "data", registry=registry(tmp_path, "t", body))
    assert ran and run.meta["git"] == {"commit": "at-start", "dirty": False}


def test_a_failed_warmup_records_its_stage(tmp_path, deck):
    run = execute.run_tool("bad", deck, timeout=60, root=tmp_path / "data", registry=registry(tmp_path, "bad", FAKE_FAIL))
    m = run.meta
    assert (m["status"], m["failed_stage"], m["timeout_s"]) == ("failed", "warmup", 60)
    assert any(line.startswith("pymupdf==") for line in m["environment"])
    assert (m["warmup_seconds"], m["seconds_total"], m["seconds_per_page"]) == (None, None, None)


def test_a_failed_timed_run_records_its_stage_and_the_warmup_time(tmp_path, deck):
    run = execute.run_tool("warm", deck, root=tmp_path / "data", registry=registry(tmp_path, "warm", FAKE_WARM_ONLY))
    m = run.meta
    assert (m["status"], m["failed_stage"]) == ("failed", "timed")
    assert m["warmup_seconds"] is not None and m["warmup_seconds"] >= 0
    assert (m["seconds_total"], m["seconds_per_page"]) == (None, None)
    assert m["environment"] and m["timeout_s"] == execute.DEFAULT_TIMEOUT


def test_a_timeout_records_the_timed_stage_and_its_limit(tmp_path, deck):
    run = execute.run_tool("slow", deck, root=tmp_path / "data", warmup=False, timeout=1,
                           registry=registry(tmp_path, "slow", FAKE_SLOW))
    m = run.meta
    assert (m["failed_stage"], m["timeout_s"], m["seconds_total"]) == ("timed", 1, None)


def test_malformed_output_records_the_output_stage_and_the_time_it_took(tmp_path, deck):
    run = execute.run_tool("raw", deck, warmup=False, root=tmp_path / "data", registry=raw_registry(tmp_path, '["pages"]'))
    m = run.meta
    assert (m["status"], m["failed_stage"]) == ("failed", "output")
    assert m["seconds_total"] >= 0 and m["seconds_per_page"] >= 0  # the timed run ran to its end


def test_missing_pages_record_the_output_stage(tmp_path, deck):
    run = execute.run_tool("gap", deck, warmup=False, root=tmp_path / "data", registry=registry(tmp_path, "gap", FAKE_GAP))
    assert (run.meta["failed_stage"], run.meta["timeout_s"]) == ("output", execute.DEFAULT_TIMEOUT)


def test_an_error_after_the_run_records_the_after_run_stage_and_what_was_measured(tmp_path, deck, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("scoring blew up")

    monkeypatch.setattr(execute.checks, "check_page", boom)
    run = execute.run_tool("fake", deck, timeout=90, root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK))
    m = run.meta
    assert (m["status"], m["failed_stage"], m["timeout_s"]) == ("failed", "after_run", 90)
    assert m["warmup_seconds"] is not None and m["seconds_total"] >= 0 and m["seconds_per_page"] >= 0
    assert m["environment"]


def test_an_environment_that_cannot_be_read_is_none_on_a_failed_run(tmp_path, deck, monkeypatch):
    def broken(tool):
        raise OSError("uv vanished")

    monkeypatch.setattr(execute, "environment", broken)
    run = execute.run_tool("bad", deck, warmup=False, root=tmp_path / "data", registry=registry(tmp_path, "bad", FAKE_FAIL))
    m = run.meta
    assert (m["status"], m["failed_stage"], m["environment"]) == ("failed", "timed", None)
    assert "code 3" in m["reason"]


def test_a_finished_run_whose_environment_cannot_be_read_is_failed_after_run(tmp_path, deck, monkeypatch):
    def broken(tool):
        raise OSError("uv vanished")

    monkeypatch.setattr(execute, "environment", broken)
    run = execute.run_tool("fake", deck, warmup=False, root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK))
    m = run.meta
    assert (m["status"], m["failed_stage"], m["environment"]) == ("failed", "after_run", None)
    assert m["reason"] == "error after run: OSError: uv vanished"


def test_ctrl_c_after_the_run_seals_it_as_failed_and_still_interrupts(tmp_path, deck, monkeypatch):
    def interrupted(*args, **kwargs):
        raise KeyboardInterrupt

    monkeypatch.setattr(execute.checks, "check_page", interrupted)
    with pytest.raises(KeyboardInterrupt):
        execute.run_tool("fake", deck, warmup=False, root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK))
    [meta] = store.list_runs(tmp_path / "data")
    assert (meta["status"], meta["failed_stage"]) == ("failed", "after_run")
    assert meta["reason"] == "error after run: KeyboardInterrupt"


# --- Plan 2: benchmark integrity, stages, cancel, one timed run at a time --------------


def test_a_benchmark_run_always_warms_up(tmp_path, deck, bench_ready):
    with pytest.raises(ValueError, match="warm up"):
        execute.run_tool("fake", deck, purpose="benchmark", warmup=False, root=tmp_path / "data",
                         registry=registry(tmp_path, "fake", FAKE_OK))


def test_a_benchmark_run_refuses_uncommitted_bench_code(tmp_path, deck, monkeypatch, bench_ready):
    monkeypatch.setattr(execute, "bench_changes", lambda: [" M backend/eval/parser_bench/checks.py"])
    with pytest.raises(RuntimeError, match="committed first: .*checks.py"):
        execute.run_tool("fake", deck, purpose="benchmark", root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK))


def test_a_benchmark_run_scores_exactly_the_page_set(tmp_path, deck, monkeypatch, bench_ready):
    reg = registry(tmp_path, "fake", FAKE_OK)
    with pytest.raises(ValueError, match=r"page set's pages of this file: \[2, 5\]"):
        execute.run_tool("fake", deck, pages=[1, 2], purpose="benchmark", root=tmp_path / "data", registry=reg)
    monkeypatch.setattr(execute, "benchmark_pages", lambda sha: [])
    with pytest.raises(ValueError, match="not in the benchmark page set"):
        execute.run_tool("fake", deck, purpose="benchmark", root=tmp_path / "data", registry=reg)


def test_bench_changes_lists_uncommitted_bench_files(protocol_repo):
    repo, _ = protocol_repo
    code = repo / "backend" / "eval" / "parser_bench" / "x.py"
    code.parent.mkdir(parents=True)
    code.write_text("x = 1\n")
    (repo / "elsewhere.txt").write_text("not the bench\n")
    assert execute.bench_changes() == ["?? backend/eval/parser_bench/"]
    git(repo, "add", "backend")
    git(repo, "commit", "-q", "-m", "bench")
    assert execute.bench_changes() == []


def test_the_stages_are_reported_in_order(tmp_path, deck):
    heard = []
    execute.run_tool("fake", deck, root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK), on_stage=heard.append)
    assert heard == ["warmup", "timed", "scoring"]


def test_a_cancelled_run_is_kept_as_failed(tmp_path, deck):
    cancel = threading.Event()
    threading.Timer(0.5, cancel.set).start()
    started = time.monotonic()
    run = execute.run_tool("slow", deck, warmup=False, root=tmp_path / "data", registry=registry(tmp_path, "slow", FAKE_SLOW),
                           cancel=cancel)
    assert time.monotonic() - started < 10
    m = run.meta
    assert (m["status"], m["reason"], m["failed_stage"]) == ("failed", "slow was cancelled", "timed")


def test_only_one_timed_run_at_a_time(tmp_path, deck):
    root, reg = tmp_path / "data", registry(tmp_path, "fake", FAKE_OK)
    with execute.timed_slot(root):
        with pytest.raises(execute.SlotBusy):
            execute.run_tool("fake", deck, warmup=False, root=root, registry=reg)
        cancel, heard = threading.Event(), []
        threading.Timer(0.3, cancel.set).start()
        with pytest.raises(execute.Cancelled):
            execute.run_tool("fake", deck, warmup=False, root=root, registry=reg, wait_for_slot=True,
                             cancel=cancel, on_stage=heard.append)
        assert heard == ["waiting"]
    assert store.list_runs(root) == []
    assert execute.run_tool("fake", deck, warmup=False, root=root, registry=reg).meta["status"] == "finished"


def test_a_waiting_run_starts_when_the_slot_frees(tmp_path, deck):
    root, reg = tmp_path / "data", registry(tmp_path, "fake", FAKE_OK)
    held = threading.Event()
    release = threading.Event()

    def hold():
        with execute.timed_slot(root):
            held.set()
            release.wait(5)

    holder = threading.Thread(target=hold)
    holder.start()
    held.wait(5)
    threading.Timer(0.6, release.set).start()
    run = execute.run_tool("fake", deck, warmup=False, root=root, registry=reg, wait_for_slot=True)
    holder.join(5)
    assert run.meta["status"] == "finished"


# --- Plan 2 review fix: the integrity checks are repeated once the slot is held ----------


def _hold_slot_for(root, seconds):
    held, release = threading.Event(), threading.Event()

    def hold():
        with execute.timed_slot(root):
            held.set()
            release.wait(5)

    holder = threading.Thread(target=hold)
    holder.start()
    held.wait(5)
    threading.Timer(seconds, release.set).start()
    return holder


def test_a_benchmark_run_that_waited_is_refused_when_the_bench_was_edited_meanwhile(tmp_path, deck, monkeypatch, bench_ready):
    root, reg = tmp_path / "data", registry(tmp_path, "fake", FAKE_OK)
    answers = iter([[], [" M backend/eval/parser_bench/checks.py"]])
    monkeypatch.setattr(execute, "bench_changes", lambda: next(answers))
    holder = _hold_slot_for(root, 0.4)
    with pytest.raises(RuntimeError, match="committed first: .*checks.py"):
        execute.run_tool("fake", deck, purpose="benchmark", root=root, registry=reg, wait_for_slot=True)
    holder.join(5)
    assert store.list_runs(root) == []


def test_a_benchmark_run_that_waited_is_refused_when_the_protocol_changed_meanwhile(tmp_path, deck, monkeypatch, bench_ready):
    root, reg = tmp_path / "data", registry(tmp_path, "fake", FAKE_OK)
    answers = iter(["abc123", None])
    monkeypatch.setattr(execute, "protocol_commit", lambda: next(answers))
    holder = _hold_slot_for(root, 0.4)
    with pytest.raises(RuntimeError, match="PROTOCOL.md"):
        execute.run_tool("fake", deck, purpose="benchmark", root=root, registry=reg, wait_for_slot=True)
    holder.join(5)
    assert store.list_runs(root) == []


def test_a_benchmark_run_records_the_protocol_commit_seen_inside_the_slot(tmp_path, deck, monkeypatch, bench_ready):
    root, reg = tmp_path / "data", registry(tmp_path, "fake", FAKE_OK)
    answers = iter(["before", "inside"])
    monkeypatch.setattr(execute, "protocol_commit", lambda: next(answers))
    run = execute.run_tool("fake", deck, purpose="benchmark", root=root, registry=reg)
    assert run.meta["protocol_commit"] == "inside"


def test_a_cancel_that_arrives_as_the_slot_frees_raises_cancelled_and_releases_it(tmp_path, deck):
    root, reg = tmp_path / "data", registry(tmp_path, "fake", FAKE_OK)
    cancel = threading.Event()
    cancel.set()
    with pytest.raises(execute.Cancelled):
        execute.run_tool("fake", deck, warmup=False, root=root, registry=reg, wait_for_slot=True, cancel=cancel)
    assert store.list_runs(root) == []
    with execute.timed_slot(root):  # the lock was released
        pass


def test_a_timed_out_git_status_blocks_a_benchmark_run(monkeypatch):
    def hang(args, **kwargs):
        raise subprocess.TimeoutExpired(args, kwargs.get("timeout", 60))

    monkeypatch.setattr(execute.subprocess, "run", hang)
    changes = execute.bench_changes()
    assert changes and "git status" in changes[0]


def test_a_benchmark_run_refuses_bench_code_committed_after_the_protocol(tmp_path, deck, monkeypatch, bench_ready):
    monkeypatch.setattr(execute, "bench_drift", lambda commit: ["backend/eval/parser_bench/checks.py"])
    with pytest.raises(RuntimeError, match="changed since the protocol commit abc123.*checks.py.*deviation"):
        execute.run_tool("fake", deck, purpose="benchmark", root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK))
    assert store.list_runs(tmp_path / "data") == []


def test_a_benchmark_run_records_the_bench_tree(tmp_path, deck, bench_ready):
    run = execute.run_tool("fake", deck, purpose="benchmark", root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK))
    assert (run.meta["protocol_commit"], run.meta["bench_tree"]) == ("abc123", "tree0")


def _bench_files(repo):
    for rel in execute.BENCH_TRACKED:
        path = repo / rel
        if rel.endswith((".md", ".json")):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("v1\n")
        else:
            path.mkdir(parents=True, exist_ok=True)
            (path / "x.py").write_text("x = 1\n")


def test_bench_drift_and_tree_follow_the_bench_files(protocol_repo):
    repo, _ = protocol_repo
    _bench_files(repo)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "protocol")
    first = git(repo, "rev-parse", "HEAD")
    tree = execute.bench_tree()
    assert tree is not None and len(tree) == 64 and execute.bench_drift(first) == []
    (repo / "LAB_LOG.md").write_text("a note\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "log")
    assert execute.bench_drift(first) == [] and execute.bench_tree() == tree  # a lab-log commit changes nothing
    (repo / execute.BENCH_TRACKED[0] / "x.py").write_text("x = 2\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "code")
    assert execute.bench_drift(first) == ["backend/eval/parser_bench/x.py"]
    assert execute.bench_tree() != tree and execute.bench_tree(first) == tree
    assert execute.bench_drift("0" * 40)[0].startswith("git diff failed")


FAKE_PAID = r'''
import json, sys
args = sys.argv[3:]
pages = [int(p) for p in args[args.index("--pages") + 1].split(",")]
print("argv", " ".join(args))
usage = {str(p): {"model": "gpt-test-2026", "prompt_tokens": 1000, "completion_tokens": 100,
                  "attempts": [{"attempt": 1, "status": 200}]} for p in pages}
json.dump({"version": "gpt-test-2026", "settings": {"model": args[args.index("--model") + 1]},
           "pages": {str(p): "# page %d" % p for p in pages}, "api": {"pages": usage}}, open(sys.argv[2], "w"))
'''
FAKE_PAID_FAIL = r'''
import json, sys
args = sys.argv[3:]
first = int(args[args.index("--pages") + 1].split(",")[0])
usage = {str(first): {"model": "gpt-test-2026", "prompt_tokens": 1000, "completion_tokens": 100,
                      "attempts": [{"attempt": 1, "status": 200}]}}
json.dump({"version": "gpt-test-2026", "settings": {}, "pages": {str(first): "# one"}, "api": {"pages": usage},
           "failed": "page 5: no answer after 4 attempts"}, open(sys.argv[2], "w"))
sys.exit(3)
'''
# page 5 was answered 2xx but its body could not be read: billed, no token counts
FAKE_PAID_UNREADABLE = r'''
import json, sys
usage = {"1": {"model": "gpt-test-2026", "prompt_tokens": 1000, "completion_tokens": 100,
               "attempts": [{"attempt": 1, "status": 200}]},
         "5": {"attempts": [{"attempt": 1, "status": 200, "error": "the answer was not JSON"}],
               "billed_unknown_usage": True}}
json.dump({"version": "gpt-test-2026", "settings": {}, "pages": {"1": "# one"}, "api": {"pages": usage},
           "failed": "page 5: the answer was not JSON"}, open(sys.argv[2], "w"))
sys.exit(3)
'''
FAKE_PAID_ONE_PAGE_SHORT = r'''
import json, sys
json.dump({"version": "gpt-test-2026", "settings": {}, "pages": {"2": "# two"},
           "api": {"pages": {"2": {"model": "gpt-test-2026", "prompt_tokens": 1000, "completion_tokens": 100}}}},
          open(sys.argv[2], "w"))
'''
FAKE_PAID_MARKER = r'''
import sys
open(sys.argv[0] + ".started", "w").write("x")
'''


def paid_registry(tmp_path, body, model="gpt-test"):
    script = tmp_path / "paidfake.py"
    script.write_text(body)
    return {"paidfake": Tool("paidfake", "paidfake", "paid", str(script), "test double", paid=True, model=model)}


@pytest.fixture
def paid_ready(tmp_path, monkeypatch):
    key = tmp_path / "openai_key"
    key.write_text("sk-test-SECRET-0123456789\n")
    key.chmod(0o600)
    monkeypatch.setattr(paid, "KEY_FILE", key)
    monkeypatch.setattr(paid, "PRICES", {"gpt-test": paid.Price(1.0, 2.0, 1000, 500, "2026-10-31", "https://example.org")})
    return key


def test_a_paid_method_needs_a_cost_ok(tmp_path, deck):
    with pytest.raises(ValueError, match="cost OK"):
        execute.run_tool("paidfake", deck, root=tmp_path / "data", registry=paid_registry(tmp_path, FAKE_PAID))
    assert not (tmp_path / "data").exists()


def test_a_paid_method_without_a_cost_ok_never_starts_the_runner(tmp_path, deck, paid_ready, monkeypatch):
    reg = paid_registry(tmp_path, FAKE_PAID_MARKER)
    started = []
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: started.append(a) or pytest.fail("a process was started"))
    with pytest.raises(ValueError, match="cost OK"):
        execute.run_tool("paidfake", deck, root=tmp_path / "data", registry=reg)
    assert started == [] and not (tmp_path / "paidfake.py.started").exists()


def test_a_paid_method_without_a_recorded_price_is_refused_before_it_runs(tmp_path, deck, paid_ready):
    with pytest.raises(ValueError, match="no price recorded"):
        execute.run_tool("paidfake", deck, cost_ok=True, root=tmp_path / "data",
                         registry=paid_registry(tmp_path, FAKE_PAID, model="gpt-other"))


def test_a_paid_run_sends_only_the_scored_pages_and_records_usage_and_cost(tmp_path, deck, paid_ready):
    run = execute.run_tool("paidfake", deck, pages=[5, 2], cost_ok=True, root=tmp_path / "data",
                           registry=paid_registry(tmp_path, FAKE_PAID))
    m = run.meta
    assert (m["status"], m["version"], m["pages_scored"], m["pages_sent"], m["missing_pages"]) == ("finished", "gpt-test-2026", [2, 5], [2, 5], [])
    assert m["warmup_seconds"] is None and "paid API" in m["warmup_skipped"]
    assert m["seconds_per_page_basis"] == "pages sent" and abs(m["seconds_per_page"] * 2 - m["seconds_total"]) < 0.02
    assert set(m["api_usage"]["pages"]) == {"2", "5"}
    assert (m["cost"]["requests"], m["cost"]["usd"]) == (2, 0.0024)  # 2 x (1000*1 + 100*2)/1e6
    assert m["cost"]["usd_is_lower_bound"] is False
    log = (run.path / "log.txt").read_text()
    assert f"--key-file {paid_ready}" in log and "--temperature 0.0" in log and "--pages 2,5" in log
    assert "SECRET" not in log and "SECRET" not in (run.path / "run.json").read_text()


def test_a_paid_run_fails_when_a_scored_page_is_missing_and_not_when_an_unscored_one_is(tmp_path, deck, paid_ready):
    run = execute.run_tool("paidfake", deck, pages=[2, 3], cost_ok=True, root=tmp_path / "data",
                           registry=paid_registry(tmp_path, FAKE_PAID_ONE_PAGE_SHORT))
    m = run.meta
    assert (m["status"], m["missing_pages"], m["failed_stage"]) == ("failed", [3], "output")  # pages 1, 4-6 are not scored
    assert m["pages_sent"] == [2]  # what the runner reported it tried, not all scored pages


def test_a_paid_benchmark_run_skips_the_warm_up(tmp_path, deck, paid_ready, bench_ready, monkeypatch):
    calls = []
    real = execute.invoke
    monkeypatch.setattr(execute, "invoke", lambda *a, **k: calls.append(a[1]) or real(*a, **k))
    run = execute.run_tool("paidfake", deck, purpose="benchmark", cost_ok=True, root=tmp_path / "data",
                           registry=paid_registry(tmp_path, FAKE_PAID))
    assert run.meta["status"] == "finished" and run.meta["pages_sent"] == [2, 5] and len(calls) == 1
    assert run.meta["bench_tree"] == "tree0" and run.meta["warmup_seconds"] is None


def test_a_failed_paid_run_keeps_its_usage_and_cost(tmp_path, deck, paid_ready):
    run = execute.run_tool("paidfake", deck, pages=[1, 5], cost_ok=True, root=tmp_path / "data",
                           registry=paid_registry(tmp_path, FAKE_PAID_FAIL))
    m = run.meta
    assert m["status"] == "failed" and m["failed_stage"] == "timed"
    assert m["reason"] == "paidfake exited with code 3: page 5: no answer after 4 attempts"
    assert m["cost"]["usd"] == 0.0012 and set(m["api_usage"]["pages"]) == {"1"}
    assert m["pages_sent"] == [1] and m["pages_scored"] == [1, 5]  # page 5 was never sent
    assert m["seconds_per_page_basis"] == "pages sent"


def test_a_billed_page_with_unreadable_usage_makes_the_cost_a_lower_bound(tmp_path, deck, paid_ready):
    run = execute.run_tool("paidfake", deck, pages=[1, 5], cost_ok=True, root=tmp_path / "data",
                           registry=paid_registry(tmp_path, FAKE_PAID_UNREADABLE))
    m = run.meta
    assert m["status"] == "failed" and m["pages_sent"] == [1, 5]
    assert m["cost"]["usd"] == 0.0012 and m["cost"]["usd_is_lower_bound"] is True
    assert m["cost"]["pages_billed_without_usage"] == 1 and "lower bound" in m["cost"]["basis"]


def test_a_paid_run_that_left_no_record_says_its_usage_is_lost(tmp_path, deck, paid_ready):
    run = execute.run_tool("paidfake", deck, pages=[1], cost_ok=True, root=tmp_path / "data",
                           registry=paid_registry(tmp_path, "import sys\nsys.exit(3)\n"))
    m = run.meta
    assert m["status"] == "failed" and m["reason"] == "paidfake exited with code 3"
    assert m["api_usage"] is None and m["pages_sent"] is None  # unknown, never "none were sent"
    assert m["cost"] == {"usd": None, "usage_lost": True,
                         "basis": "the runner was stopped before it could write its record; check the OpenAI usage page"}


def test_a_key_in_a_failure_message_is_redacted(tmp_path, deck, paid_ready):
    body = FAKE_PAID_FAIL.replace("page 5: no answer after 4 attempts", "bad key sk-test-SECRET-0123456789")
    run = execute.run_tool("paidfake", deck, pages=[1, 5], cost_ok=True, root=tmp_path / "data",
                           registry=paid_registry(tmp_path, body))
    assert "SECRET" not in run.meta["reason"] and "SECRET" not in (run.path / "run.json").read_text()


def test_planned_pages_are_the_pages_a_run_would_score(tmp_path, deck, monkeypatch):
    assert execute.planned_pages(deck, None, "explore") == [1, 2, 3, 4, 5, 6]
    assert execute.planned_pages(deck, [4, 2, 4], "explore") == [2, 4]
    monkeypatch.setattr(execute, "benchmark_pages", lambda sha: [2, 5])
    assert execute.planned_pages(deck, None, "benchmark") == [2, 5]
    assert execute.planned_pages(deck, [1], "benchmark") == [2, 5]
    monkeypatch.setattr(execute, "benchmark_pages", lambda sha: [])
    with pytest.raises(ValueError, match="not in the benchmark page set"):
        execute.planned_pages(deck, None, "benchmark")


# A paid runner that is waiting on a request: it says it is ready, and on SIGTERM writes its record and exits 3.
FAKE_PAID_TERM = r'''
import json, signal, sys, time
READY = %r
def stop(signum, frame):
    usage = {"1": {"model": "gpt-test-2026", "prompt_tokens": 1000, "completion_tokens": 100,
                   "attempts": [{"attempt": 1, "status": 200}]},
             "5": {"interrupted_in_flight": True, "requested_at": "2026-10-31T10:00:00+00:00",
                   "attempts": [{"attempt": 1, "interrupted": True}]}}
    json.dump({"version": "gpt-test-2026", "settings": {}, "pages": {"1": "# one"}, "api": {"pages": usage},
               "failed": "page 5: unexpected KeyboardInterrupt: "}, open(sys.argv[2], "w"))
    sys.exit(3)
signal.signal(signal.SIGTERM, stop)
open(READY, "w").write("x")
time.sleep(60)
'''
FAKE_PAID_DEAF = r'''
import signal, sys, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
open(%r, "w").write("x")
time.sleep(60)
'''


class WhenReady:
    """A stand-in for the cancel event: set once the runner has said it is ready (or raising Ctrl-C then)."""

    def __init__(self, marker, raises=False):
        self.marker, self.raises = marker, raises

    def is_set(self):
        if not self.marker.exists():
            return False
        if self.raises:
            raise KeyboardInterrupt
        return True


def runs_in(root):
    return [json.loads(p.read_text()) for p in sorted(root.glob("**/run.json"))]


def test_a_cancelled_paid_run_gets_sigterm_and_records_what_it_was_charged(tmp_path, deck, paid_ready):
    marker = tmp_path / "ready"
    reg = paid_registry(tmp_path, FAKE_PAID_TERM % str(marker))
    run = execute.run_tool("paidfake", deck, pages=[1, 5], cost_ok=True, root=tmp_path / "data", registry=reg,
                           cancel=WhenReady(marker))
    m = run.meta
    assert m["status"] == "failed" and m["failed_stage"] == "timed" and "cancelled" in m["reason"]
    assert m["pages_sent"] == [1, 5] and m["cost"]["usd"] == 0.0012
    assert m["cost"]["usd_is_lower_bound"] is True and m["cost"]["pages_billed_without_usage"] == 1  # page 5 was in flight


def test_a_timed_out_paid_run_records_its_usage_too(tmp_path, deck, paid_ready):
    marker = tmp_path / "ready"
    reg = paid_registry(tmp_path, FAKE_PAID_TERM % str(marker))
    run = execute.run_tool("paidfake", deck, pages=[1, 5], cost_ok=True, root=tmp_path / "data", registry=reg, timeout=3)
    m = run.meta
    assert m["status"] == "failed" and "timed out" in m["reason"] and m["cost"]["usd"] == 0.0012 and m["pages_sent"] == [1, 5]


def test_a_paid_runner_that_ignores_sigterm_is_killed_after_the_grace_and_its_usage_is_lost(tmp_path, deck, paid_ready, monkeypatch):
    monkeypatch.setattr(execute, "TERM_GRACE", 0.5)
    marker = tmp_path / "ready"
    reg = paid_registry(tmp_path, FAKE_PAID_DEAF % str(marker))
    started = time.monotonic()
    run = execute.run_tool("paidfake", deck, pages=[1], cost_ok=True, root=tmp_path / "data", registry=reg,
                           cancel=WhenReady(marker))
    assert time.monotonic() - started < 8
    m = run.meta
    assert m["status"] == "failed" and m["pages_sent"] is None and m["api_usage"] is None
    assert m["cost"]["usage_lost"] is True and m["cost"]["usd"] is None and "OpenAI usage page" in m["cost"]["basis"]


def test_ctrl_c_during_a_paid_run_seals_a_failed_run_keeps_the_usage_and_is_raised_again(tmp_path, deck, paid_ready):
    marker = tmp_path / "ready"
    reg = paid_registry(tmp_path, FAKE_PAID_TERM % str(marker))
    with pytest.raises(KeyboardInterrupt):
        execute.run_tool("paidfake", deck, pages=[1, 5], cost_ok=True, root=tmp_path / "data", registry=reg,
                         cancel=WhenReady(marker, raises=True))
    (m,) = runs_in(tmp_path / "data")
    assert m["status"] == "failed" and m["reason"] == "interrupted" and m["failed_stage"] == "timed"
    assert m["pages_sent"] == [1, 5] and m["cost"]["usd"] == 0.0012


def test_a_free_method_is_still_killed_at_once_not_asked_to_stop(tmp_path, deck, monkeypatch):
    marker = tmp_path / "ready"
    body = FAKE_PAID_DEAF % str(marker)  # ignores SIGTERM: a polite stop would take the whole grace
    started = time.monotonic()
    run = execute.run_tool("fake", deck, warmup=False, root=tmp_path / "data", registry=registry(tmp_path, "fake", body),
                           cancel=WhenReady(marker))
    assert time.monotonic() - started < execute.TERM_GRACE - 1
    assert run.meta["status"] == "failed" and "cancelled" in run.meta["reason"] and "pages_sent" not in run.meta


def test_malformed_paid_output_still_keeps_the_usage(tmp_path, deck, paid_ready):
    body = ('import json, sys\njson.dump({"pages": ["a"], "api": {"pages": {"1": {"prompt_tokens": 1000, "completion_tokens": 100}}}}, '
            'open(sys.argv[2], "w"))\n')
    run = execute.run_tool("paidfake", deck, pages=[1], cost_ok=True, root=tmp_path / "data",
                           registry=paid_registry(tmp_path, body))
    m = run.meta
    assert m["failed_stage"] == "output" and m["pages_sent"] == [1] and m["cost"]["usd"] == 0.0012


def test_a_paid_explore_run_with_no_pages_listed_is_refused_but_none_means_the_whole_file(tmp_path, deck, paid_ready):
    reg = paid_registry(tmp_path, FAKE_PAID)
    with pytest.raises(ValueError, match="empty page list"):
        execute.run_tool("paidfake", deck, pages=[], cost_ok=True, root=tmp_path / "data", registry=reg)
    assert not (tmp_path / "data").exists()
    run = execute.run_tool("paidfake", deck, pages=None, cost_ok=True, root=tmp_path / "data", registry=reg)
    assert run.meta["status"] == "finished" and run.meta["pages_sent"] == [1, 2, 3, 4, 5, 6]


def test_a_key_shaped_string_in_the_runner_log_is_redacted_for_a_paid_method_only(tmp_path, deck, paid_ready):
    body = FAKE_PAID.replace("print(\"argv\"", "print(\"leak sk-test-SECRET-0123456789\"); print(\"argv\"")
    run = execute.run_tool("paidfake", deck, pages=[1], cost_ok=True, root=tmp_path / "data",
                           registry=paid_registry(tmp_path, body))
    log = (run.path / "log.txt").read_text()
    assert "leak" in log and "SECRET" not in log
    free = execute.run_tool("fake", deck, pages=[1], warmup=False, root=tmp_path / "data",
                            registry=registry(tmp_path, "fake", FAKE_OK.replace("import fitz", "print('sk-test-SECRET-0123456789')\nimport fitz", 1)))
    assert "SECRET" in (free.path / "log.txt").read_text()  # a free method's log is kept as it is


FAKE_ENV = r'''
import json, os, sys
import fitz
with fitz.open(sys.argv[1]) as d:
    pages = {str(n): "" for n in range(1, len(d) + 1)}
seen = {k: os.environ.get(k) for k in ("HF_HOME", "MINERU_TELEMETRY_DISABLED")}
seen["PATH0"] = os.environ["PATH"].split(os.pathsep)[0]
json.dump({"version": "1", "settings": seen, "pages": pages}, open(sys.argv[2], "w"))
'''
FAKE_WARM_SLOW = '''
import json, sys, time
import fitz
with fitz.open(sys.argv[1]) as d:
    n = len(d)
if n <= 2:
    time.sleep(4)
json.dump({"version": "1", "settings": {}, "pages": {str(p): "" for p in range(1, n + 1)}}, open(sys.argv[2], "w"))
'''
FAKE_DOWNLOADS = r'''
import json, os, sys
import fitz
with fitz.open(sys.argv[1]) as d:
    n = len(d)
if n > 2:  # the timed run, not the warm-up, fetches a model
    os.makedirs(os.environ["HF_HOME"], exist_ok=True)
    open(os.path.join(os.environ["HF_HOME"], "late.bin"), "wb").write(b"m" * (3 * 2**20))
json.dump({"version": "1", "settings": {}, "pages": {str(p): "" for p in range(1, n + 1)}}, open(sys.argv[2], "w"))
'''


def heavy_registry(tmp_path, name, body, **kw):
    script = tmp_path / f"{name}.py"
    script.write_text(body)
    return {name: Tool(name, name, "heavy", str(script), "test double", downloads_models=True, **kw)}


@pytest.fixture
def heavy_dirs(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_MODELS", str(tmp_path / "models"))
    monkeypatch.setenv("PARSER_BENCH_BIN", str(tmp_path / "bin"))
    monkeypatch.delenv("HF_HOME", raising=False)
    return tmp_path


def test_a_heavy_method_runs_with_its_own_model_folders(tmp_path, deck, heavy_dirs):
    reg = heavy_registry(tmp_path, "hv", FAKE_ENV)
    run = execute.run_tool("hv", deck, warmup=False, root=tmp_path / "data", registry=reg)
    s = run.meta["settings"]
    assert s["HF_HOME"] == str(tools.models_dir(reg["hv"]) / "huggingface")
    assert s["MINERU_TELEMETRY_DISABLED"] == "1" and s["PATH0"] == str(tools.bin_dir())
    assert run.meta["model_cache_mb"] == 0.0 and run.meta["models_downloaded_in_timed_run"] is False
    assert "time_limit_s" not in run.meta  # this double has no time limit


def test_a_fast_method_inherits_the_environment_and_its_record_is_unchanged(tmp_path, deck, monkeypatch):
    monkeypatch.delenv("HF_HOME", raising=False)
    run = execute.run_tool("fe", deck, warmup=False, root=tmp_path / "data", registry=registry(tmp_path, "fe", FAKE_ENV))
    assert run.meta["settings"]["HF_HOME"] is None
    assert not {"model_cache_mb", "time_limit_s", "did_not_run_here"} & set(run.meta)


def test_a_heavy_run_past_the_time_limit_did_not_run_here(tmp_path, deck, heavy_dirs):
    reg = heavy_registry(tmp_path, "hs", FAKE_SLOW, limit_per_page=0.2)  # 6 pages: stopped at 1.2 s
    started = time.monotonic()
    run = execute.run_tool("hs", deck, warmup=False, timeout=60, root=tmp_path / "data", registry=reg)
    assert time.monotonic() - started < 20  # stopped at the limit, not at the 60 s timeout
    m = run.meta
    assert (m["status"], m["failed_stage"], m["did_not_run_here"]) == ("failed", "timed", True)
    assert (m["time_limit_s"], m["time_limit_per_page"], m["seconds_per_page"]) == (1.2, 0.2, None)
    assert m["timeout_s"] == 1.2  # the limit that applied to the timed run, not the 60 s asked for
    assert m["reason"].startswith("did not run here: slower than 0.2 s/page on this Mac")
    assert m["model_cache_mb"] == 0.0


def test_a_timeout_shorter_than_the_limit_is_a_plain_timeout(tmp_path, deck, heavy_dirs):
    reg = heavy_registry(tmp_path, "hp", FAKE_SLOW, limit_per_page=100.0)  # limit 600 s; the 1 s timeout comes first
    run = execute.run_tool("hp", deck, warmup=False, timeout=1, root=tmp_path / "data", registry=reg)
    m = run.meta
    assert (m["failed_stage"], m["did_not_run_here"], m["timeout_s"]) == ("timed", False, 1)
    assert m["reason"].startswith("hp timed out")


def test_the_warmup_is_not_held_to_the_time_limit(tmp_path, deck, heavy_dirs):
    reg = heavy_registry(tmp_path, "hw", FAKE_WARM_SLOW, limit_per_page=0.5)  # timed run 3 s; the warm-up sleeps 4 s
    run = execute.run_tool("hw", deck, timeout=30, root=tmp_path / "data", registry=reg)
    m = run.meta
    assert m["status"] == "finished" and m["did_not_run_here"] is False and m["warmup_seconds"] >= 4
    assert m["time_limit_s"] == 3.0 and m["timeout_s"] == 3.0


def test_a_model_download_during_the_timed_run_is_recorded(tmp_path, deck, heavy_dirs):
    reg = heavy_registry(tmp_path, "hd", FAKE_DOWNLOADS)
    run = execute.run_tool("hd", deck, root=tmp_path / "data", registry=reg)
    assert run.meta["models_downloaded_in_timed_run"] is True and run.meta["model_cache_mb"] == 3.0


def test_a_failed_heavy_warmup_does_not_claim_a_download_either_way(tmp_path, deck, heavy_dirs):
    run = execute.run_tool("hf", deck, root=tmp_path / "data", registry=heavy_registry(tmp_path, "hf", FAKE_FAIL))
    assert run.meta["failed_stage"] == "warmup" and run.meta["models_downloaded_in_timed_run"] is None
    assert run.meta["timeout_s"] == execute.DEFAULT_TIMEOUT  # the warm-up keeps the plain timeout


FAKE_TIMED_SLOW = '''
import json, sys, time
import fitz
with fitz.open(sys.argv[1]) as d:
    n = len(d)
if n > 2:
    time.sleep(2.5)
json.dump({"version": "1", "settings": {}, "pages": {str(p): "" for p in range(1, n + 1)}}, open(sys.argv[2], "w"))
'''


def test_without_a_timeout_the_time_limit_alone_bounds_a_long_deck(tmp_path, deck, heavy_dirs, monkeypatch):
    """Every caller passes no timeout: a limit above DEFAULT_TIMEOUT (an 85-page deck's 10,200 s) must still apply."""
    monkeypatch.setattr(execute, "DEFAULT_TIMEOUT", 2.0)
    reg = heavy_registry(tmp_path, "hl", FAKE_TIMED_SLOW, limit_per_page=0.5)  # 6 pages: limit 3 s > the patched 2 s
    run = execute.run_tool("hl", deck, root=tmp_path / "data", registry=reg)
    m = run.meta
    assert m["status"] == "finished" and m["did_not_run_here"] is False
    assert (m["time_limit_s"], m["timeout_s"]) == (3.0, 3.0)  # not capped at the default
    assert m["seconds_total"] > 2.0


def test_without_a_timeout_a_slow_long_deck_still_did_not_run_here(tmp_path, deck, heavy_dirs, monkeypatch):
    monkeypatch.setattr(execute, "DEFAULT_TIMEOUT", 0.5)  # would kill the 30 s sleeper at 0.5 s as a plain timeout
    reg = heavy_registry(tmp_path, "hn", FAKE_SLOW, limit_per_page=0.3)  # limit 1.8 s
    run = execute.run_tool("hn", deck, warmup=False, root=tmp_path / "data", registry=reg)
    m = run.meta
    assert (m["failed_stage"], m["did_not_run_here"], m["timeout_s"]) == ("timed", True, 1.8)
    assert m["reason"].startswith("did not run here")


def test_a_failed_warmup_of_a_limited_method_is_not_measured(tmp_path, deck, heavy_dirs):
    reg = heavy_registry(tmp_path, "hx", FAKE_FAIL, limit_per_page=0.5)
    m = execute.run_tool("hx", deck, root=tmp_path / "data", registry=reg).meta
    assert m["failed_stage"] == "warmup" and m["did_not_run_here"] is None and m["time_limit_s"] == 3.0
    assert m["timeout_s"] == execute.DEFAULT_TIMEOUT


def test_a_run_that_ends_just_past_the_limit_did_not_run_here(tmp_path, deck, heavy_dirs, monkeypatch):
    """The runner finished within the last poll step after the limit: the output is not kept as a result."""
    import dataclasses

    real = execute.invoke

    def late(tool, pdf, **kw):
        got = real(tool, pdf, **kw)
        return dataclasses.replace(got, seconds=kw["timeout"] + 0.1) if kw["timeout"] == 3.0 else got

    monkeypatch.setattr(execute, "invoke", late)
    reg = heavy_registry(tmp_path, "hy", FAKE_OK, limit_per_page=0.5)
    run = execute.run_tool("hy", deck, warmup=False, root=tmp_path / "data", registry=reg)
    m = run.meta
    assert (m["status"], m["failed_stage"], m["did_not_run_here"]) == ("failed", "timed", True)
    assert m["reason"].startswith("did not run here") and m["seconds_total"] == 3.1


def test_a_limit_above_the_default_timeout_is_what_the_timed_run_gets(tmp_path, deck, heavy_dirs, monkeypatch):
    """The real defaults, no patching: 6 pages at 1000 s/page is a 6000 s limit, above DEFAULT_TIMEOUT (3600 s)."""
    asked, real = [], execute.invoke
    monkeypatch.setattr(execute, "invoke", lambda tool, pdf, **kw: (asked.append(kw["timeout"]), real(tool, pdf, **kw))[1])
    reg = heavy_registry(tmp_path, "hb", FAKE_OK, limit_per_page=1000.0)
    run = execute.run_tool("hb", deck, root=tmp_path / "data", registry=reg)
    assert asked == [execute.DEFAULT_TIMEOUT, 6000.0]  # the warm-up keeps the default, the timed run gets the limit
    assert (run.meta["timeout_s"], run.meta["time_limit_s"]) == (6000.0, 6000.0)


def test_input_pages_are_the_scored_pages_and_their_neighbours():
    assert execute.input_pages([3], 41, 1) == [2, 3, 4]
    assert execute.input_pages([1, 6], 6, 2) == [1, 2, 3, 4, 5, 6]
    assert execute.input_pages([16, 17], 41, 1) == [15, 16, 17, 18]
    assert execute.input_pages([3], 41, 0) == [3]


def test_a_method_given_neighbours_reads_only_those_pages(tmp_path, deck, heavy_dirs):
    reg = heavy_registry(tmp_path, "nb", FAKE_OK, neighbours=1, limit_per_page=30.0)
    run = execute.run_tool("nb", deck, pages=[3], warmup=False, root=tmp_path / "data", registry=reg)
    m = run.meta
    assert (m["status"], m["input_pages"], m["neighbours"], m["seconds_per_page_basis"]) == ("finished", [2, 3, 4], 1, "pages given")
    assert m["time_limit_s"] == 90.0 and m["missing_pages"] == []
    assert TITLES[2] in run.pages()[3]  # page 3 of the cut is page 3 of the deck


def test_a_cut_keeps_only_the_given_pages_objects(tmp_path):
    import fitz

    deck = make_deck(tmp_path / "deck.pdf", n=6)
    with fitz.open(deck) as doc:  # a large image of its own on every page, as on a slide
        for i, page in enumerate(doc):
            image = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 300, 300), 0)
            image.clear_with(40 * i)
            page.insert_image(fitz.Rect(0, 0, 200, 200), pixmap=image)
        doc.saveIncr()
    cut = execute.cut_pdf(deck, [2], tmp_path / "cut.pdf")
    with fitz.open(cut) as doc:
        assert doc.page_count == 1 and TITLES[1] in doc[0].get_text()
    assert cut.stat().st_size < deck.stat().st_size / 3
