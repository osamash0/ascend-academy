"""Run one method on one PDF and keep the result as a permanent run.

Every free method first runs once on a two-page sample (warm-up), so a first-time
model download is never timed. A paid method (ai_vision) never warms up: it downloads
no model, and a warm-up would send two more page images and pay for them
(PROTOCOL.md deviation 2). It needs an explicit cost OK for every run, is sent only
the pages the run scores, and its seconds per page are over the pages sent. Its run
records the API's usage per page and the cost at the recorded price, also when it
fails. A paid runner that is stopped (cancelled, timed out, Ctrl-C) is first sent SIGTERM and given
a few seconds to write that record; if none is recovered the run says so (pages_sent None, cost
usage_lost) instead of claiming nothing was sent. The timed run's peak memory is the largest
resident size of the runner's whole process tree, sampled every 0.1 s (and once
at the start); that includes OpenDataLoader's Java child. A run too short to be
sampled has no peak (None), never a made-up 0.

The runner starts in its own session so that, however it ends (finished, timed
out, Ctrl-C), nothing it started is left running.

A failed run records where it failed (failed_stage): "warmup", "timed" (the
timed run exited non-zero or timed out), "output" (its output is malformed or
misses pages) or "after_run" (scoring or writing the record went wrong, Ctrl-C
included). It keeps whatever was measured before that point.

A heavy method (tools.Tool.downloads_models) runs with its own model folders (tools.runner_env). Its timed run is
held to the spec's time limit, limit_per_page × the pages it is given: past it the run is stopped, kept as failed
with did_not_run_here, and the method "did not run here" (spec, contenders). Its warm-up keeps the plain timeout,
because it may include a one-time model download. Its record says how large its model folder is and whether the
folder grew during the timed run (a download the warm-up should have made). Without an explicit timeout a limited
method's timed run is bounded by its time limit alone (DEFAULT_TIMEOUT would cap a long deck below it); an explicit
timeout shorter than the limit wins and is then a plain timeout. The run's timeout_s is the bound that applied to its
timed run, the warm-up's bound when it failed in the warm-up; did_not_run_here is None when the warm-up failed (the
timed run never ran, so nothing was measured).

A heavy method may be given only the scored pages and N neighbours of each (tools.HEAVY_NEIGHBOURS, deviation 3): they are
cut from the PDF, its output is mapped back to the file's page numbers, and its time limit and seconds per page count the
pages given. The checks still read the whole file.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
import signal
import subprocess
import tempfile
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator, Mapping, Sequence

import psutil

from backend.eval.parser_bench import checks, pageset, paid, store
from backend.eval.parser_bench.normalize import normalize_figures
from backend.eval.parser_bench.sources import page_count, sha256_file, two_page_sample
from backend.eval.parser_bench.tools import (TOOLS, Tool, ToolNotReady, cache_mb, command, environment, missing,
                                             paid_args, runner_env)

PROTOCOL = store.REPO / "docs" / "thesis" / "experiments" / "parser-benchmark" / "PROTOCOL.md"
# What a benchmark run's result depends on besides the tool: the bench's code, the protocol, the page set.
BENCH_TRACKED = (
    "backend/eval/parser_bench",
    "docs/thesis/experiments/parser-benchmark/PROTOCOL.md",
    "docs/thesis/experiments/parser-benchmark/pages.json",
)
DEFAULT_TIMEOUT = 3600.0
SAMPLE_EVERY = 0.1
SLOT_POLL = 0.5
KILL_SWEEPS = 5
TERM_GRACE = 5.0  # a paid runner gets SIGTERM and this long to write what it was charged for, then SIGKILL
USAGE_LOST = {"usd": None, "usage_lost": True,
              "basis": "the runner was stopped before it could write its record; check the OpenAI usage page"}
WARMUP_SKIPPED = ("skipped: a paid API downloads no local model, and a warm-up would send two more page images "
                  "and pay for them (PROTOCOL.md deviation 2)")

__all__ = [
    "Cancelled", "Invocation", "RunnerError", "SlotBusy", "ToolNotReady",
    "bench_changes", "bench_drift", "bench_tree", "benchmark_gate", "benchmark_pages", "invoke", "planned_pages", "protocol_commit", "run_tool", "timed_slot",
]


class SlotBusy(RuntimeError):
    """Another timed run is in progress; two at once would distort each other's time and memory."""


class Cancelled(RuntimeError):
    """The run was cancelled before it started, while it waited for the timed-run slot."""


class RunnerError(RuntimeError):
    """The runner failed. `output` is True when it ran to its end but left unusable output;
    `seconds` is then how long it ran. `api` is what a paid runner reported it was charged for
    before it failed. `timed_out` is True when the runner was stopped at its timeout."""

    def __init__(self, message: str, log: str = "", *, output: bool = False, seconds: float | None = None,
                 api: dict | None = None, timed_out: bool = False):
        super().__init__(message)
        self.log = log
        self.output = output
        self.seconds = seconds
        self.api = api
        self.timed_out = timed_out


@dataclass
class Invocation:
    pages: dict[int, str]
    version: str
    settings: dict
    seconds: float
    peak_mb: float | None  # None: the run ended before any sample saw memory in use
    log: str
    api: dict | None = None  # a paid runner's usage per page


def _tree_rss(root: psutil.Process, seen: set[psutil.Process]) -> int:
    """Resident size of the runner and everything under it; every process met is added to `seen`."""
    try:
        procs = [root, *root.children(recursive=True)]
    except psutil.Error:
        procs = [root]
    seen.update(procs)
    total = 0
    for proc in procs:
        try:
            total += proc.memory_info().rss
        except psutil.Error:
            pass
    return total


def _alive(proc: psutil.Process) -> bool:
    try:
        return proc.is_running() and proc.status() != psutil.STATUS_ZOMBIE
    except psutil.Error:
        return False


def _group_exists(pgid: int) -> bool:
    try:
        os.killpg(pgid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _group_members(pgid: int) -> list[psutil.Process]:
    found = []
    for proc in psutil.process_iter():
        try:
            if os.getpgid(proc.pid) == pgid:
                found.append(proc)
        except (OSError, psutil.Error):
            pass
    return found


def _reap(proc: subprocess.Popen, seen: set[psutil.Process], *, grace: float | None = None) -> None:
    """Leave nothing of the runner alive: its process group first, then every process seen under it.
    With `grace` (a paid runner) the group is first asked to stop (SIGTERM) and given that long to write its
    record; whatever is left then gets SIGKILL, as it always does for a free method."""
    if grace and proc.poll() is None:
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            with contextlib.suppress(subprocess.TimeoutExpired):
                proc.wait(timeout=grace)
        finally:  # a Ctrl-C during the grace must not skip the SIGKILL below
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(proc.pid, signal.SIGKILL)
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(proc.pid, signal.SIGKILL)
    proc.wait()
    for _ in range(KILL_SWEEPS):
        left = set(seen)
        if _group_exists(proc.pid):
            left.update(_group_members(proc.pid))
        left = {p for p in left if _alive(p)}
        if not left:
            return
        for straggler in left:
            with contextlib.suppress(psutil.Error):
                straggler.kill()
        time.sleep(0.05)


def _sweep_folder(folder: Path) -> None:
    """Kill every process whose working directory is in `folder`, the run's own temporary folder (the runner
    starts there, and so does everything it starts). A server that the runner started in a session of its own and
    that outlived it has been handed to init: neither the process group nor the process tree finds it any more."""
    root = str(folder.resolve())
    for _ in range(KILL_SWEEPS):
        left = []
        for proc in psutil.process_iter():
            try:
                cwd = proc.cwd()
            except (psutil.Error, OSError):
                continue
            if (cwd == root or cwd.startswith(root + os.sep)) and proc.pid != os.getpid() and _alive(proc):
                left.append(proc)
        if not left:
            return
        for straggler in left:
            with contextlib.suppress(psutil.Error):
                straggler.kill()
        time.sleep(0.05)


def _shape(data: object) -> tuple[dict[int, str], str, dict]:
    """Pages, version and settings from a runner's output, or ValueError saying what is wrong with it."""
    if not isinstance(data, dict):
        raise ValueError("the top level is not an object")
    raw = data.get("pages")
    if not isinstance(raw, dict):
        raise ValueError("'pages' is not an object")
    pages: dict[int, str] = {}
    for key, text in raw.items():
        if not isinstance(text, str):
            raise ValueError(f"page {key!r} is not text")
        try:
            pages[int(key)] = text
        except (TypeError, ValueError):
            raise ValueError(f"page key {key!r} is not a number") from None
    settings = data.get("settings")
    if settings is None:
        settings = {}
    elif not isinstance(settings, dict):
        raise ValueError("'settings' is not an object")
    version = data.get("version")
    return pages, "unknown" if version is None else str(version), dict(settings)


def _api_of(data: object) -> dict | None:
    """A paid runner's usage record ("api": {"pages": {page: usage}}), or None when there is none or it is not shaped so."""
    api = data.get("api") if isinstance(data, dict) else None
    return api if isinstance(api, dict) and isinstance(api.get("pages"), dict) else None


def _partial(out: Path) -> dict:
    """What a runner that exited non-zero left behind: a paid runner writes the pages it was charged for
    ("api") and why it stopped ("failed") before it exits 3. The text is redacted again here."""
    try:
        data = json.loads(out.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    failed = data.get("failed")
    return {"failed": paid.redact(failed)[:500] if isinstance(failed, str) and failed else None, "api": _api_of(data)}


def invoke(tool: Tool, pdf: Path, *, args: Sequence[str] = (), timeout: float = DEFAULT_TIMEOUT,
           cancel: threading.Event | None = None) -> Invocation:
    with tempfile.TemporaryDirectory() as tmp:
        out, log_file = Path(tmp) / "out.json", Path(tmp) / "log.txt"
        with open(log_file, "w") as log:
            start = time.monotonic()
            proc = subprocess.Popen(
                [*command(tool), str(pdf), str(out), *args],
                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, cwd=tmp, env=runner_env(tool),
                start_new_session=True,
            )
            seen: set[psutil.Process] = set()
            try:
                watched = psutil.Process(proc.pid)
            except psutil.Error:
                watched = None
            peak, seconds, timed_out, cancelled, interrupted = 0, 0.0, False, False, None
            try:
                while True:
                    if watched:
                        peak = max(peak, _tree_rss(watched, seen))
                    if cancel is not None and cancel.is_set():
                        cancelled = True
                        break
                    remaining = timeout - (time.monotonic() - start)
                    if remaining <= 0:
                        timed_out = True
                        break
                    try:
                        proc.wait(timeout=min(SAMPLE_EVERY, remaining))
                    except subprocess.TimeoutExpired:
                        continue
                    seconds = time.monotonic() - start
                    break
            except BaseException as e:  # Ctrl-C: the runner is reaped below, then this is raised again
                interrupted = e
            finally:
                _reap(proc, seen, grace=TERM_GRACE if tool.paid else None)
                _sweep_folder(Path(tmp))
        text = log_file.read_text(errors="replace")
        if tool.paid:
            text = paid.redact(text)  # defence in depth: the runner redacts its own output already
        if interrupted is not None:
            if tool.paid:  # what the stopped runner managed to write, for the record the caller seals
                interrupted.paid_partial = {"api": _partial(out).get("api"), "log": text}
            raise interrupted
        if cancelled:
            raise RunnerError(f"{tool.id} was cancelled", text, api=_partial(out).get("api") if tool.paid else None)
        if timed_out:
            raise RunnerError(f"{tool.id} timed out after {timeout:.0f} s", text,
                              api=_partial(out).get("api") if tool.paid else None, timed_out=True)
        if proc.returncode != 0:
            partial = _partial(out)
            detail = f": {partial['failed']}" if partial.get("failed") else ""
            raise RunnerError(f"{tool.id} exited with code {proc.returncode}{detail}", text, api=partial.get("api"))
        try:
            data = json.loads(out.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            raise RunnerError(f"{tool.id} wrote no readable output: {e}", text, output=True, seconds=seconds) from e
        try:
            pages, version, settings = _shape(data)
        except (ValueError, TypeError, AttributeError, KeyError) as e:
            raise RunnerError(f"{tool.id} wrote malformed output: {e}", text, output=True, seconds=seconds,
                              api=_api_of(data)) from e
    return Invocation(pages, version, settings, seconds, round(peak / 2**20, 1) if peak else None, text,
                      api=_api_of(data))


def protocol_commit() -> str | None:
    """The commit that last changed PROTOCOL.md, or None if it is missing, uncommitted or edited since."""
    if not PROTOCOL.exists():
        return None
    rel = str(PROTOCOL.relative_to(store.REPO))
    git = ["git", "-C", str(store.REPO)]
    if subprocess.run([*git, "status", "--porcelain", "--", rel], capture_output=True, text=True).stdout.strip():
        return None
    return subprocess.run([*git, "log", "-1", "--format=%H", "--", rel], capture_output=True, text=True).stdout.strip() or None


def bench_changes() -> list[str]:
    """Uncommitted changes (git status lines) to what a benchmark result depends on (BENCH_TRACKED)."""
    try:
        probe = subprocess.run(["git", "-C", str(store.REPO), "status", "--porcelain", "--", *BENCH_TRACKED],
                               capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        return ["git status timed out"]  # fail closed, like a git error
    if probe.returncode != 0:
        return [f"git status failed: {probe.stderr.strip() or probe.returncode}"]
    return [line for line in probe.stdout.splitlines() if line.strip()]


def benchmark_pages(sha256: str) -> list[int]:
    """The page set's pages of one PDF; empty when the file is not in the benchmark set."""
    return pageset.pages_for(sha256, pageset.load_or_empty())


def planned_pages(pdf: Path, pages: Sequence[int] | None, purpose: str) -> list[int]:
    """The pages a run of this file would score, which are the pages a paid method sends: the page set's
    pages of the file for a benchmark run, else the pages asked for, else every page. The one place this
    is decided."""
    pdf = Path(pdf).resolve()
    if purpose == "benchmark":
        chosen = benchmark_pages(sha256_file(pdf))
        if not chosen:
            raise ValueError(f"{pdf.name} is not in the benchmark page set; run it as explore")
        return chosen
    return sorted(set(pages)) if pages else list(range(1, page_count(pdf) + 1))


def _paid_fields(tool: Tool, api: dict | None, wanted: list[int], *, finished: bool) -> dict:
    """What a paid run adds to its record: the pages sent, the usage per page and the cost. A run that did
    not finish names as sent only the pages the runner reported usage for (what it actually tried). Without
    any usage record (the runner was killed before it wrote one) what was sent is unknown, never "none":
    pages_sent is None and the cost says the usage is lost."""
    if not tool.paid:
        return {}
    if api is None:
        sent, cost = None, dict(USAGE_LOST)
    else:
        sent = wanted if finished else sorted(int(k) for k in api.get("pages", {}) if str(k).isdigit())
        cost = paid.cost(tool.model, api)
    return {"pages_sent": sent, "api_usage": api, "cost": cost, "seconds_per_page_basis": "pages sent"}


def _git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(store.REPO), *args], capture_output=True, text=True, timeout=60)


def bench_tree(rev: str = "HEAD") -> str | None:
    """One hash for what a benchmark result depends on at `rev`: the git object ids of BENCH_TRACKED (the
    bench's code tree, PROTOCOL.md, pages.json), hashed together. None when git cannot name one of them."""
    ids = []
    try:
        for path in BENCH_TRACKED:
            probe = _git("rev-parse", f"{rev}:{path}")
            if probe.returncode != 0:
                return None
            ids.append(f"{path} {probe.stdout.strip()}")
    except subprocess.TimeoutExpired:
        return None
    return hashlib.sha256("\n".join(ids).encode("utf-8")).hexdigest()


def bench_drift(commit: str) -> list[str]:
    """The files under BENCH_TRACKED that differ between the protocol commit and HEAD. Fails closed: a git
    error or timeout is one line saying so."""
    try:
        probe = _git("diff", "--name-only", commit, "HEAD", "--", *BENCH_TRACKED)
    except subprocess.TimeoutExpired:
        return ["git diff timed out"]
    if probe.returncode != 0:
        return [f"git diff failed: {probe.stderr.strip() or probe.returncode}"]
    return [line for line in probe.stdout.splitlines() if line.strip()]


def benchmark_gate() -> dict[str, str]:
    """What a benchmark run or comparison records ({"protocol_commit", "bench_tree"}), or RuntimeError saying
    why none may start now: PROTOCOL.md committed and unmodified, the bench committed, and the bench unchanged
    since the protocol commit (PROTOCOL.md's own rule: a change is a dated deviation, committed with it)."""
    commit = protocol_commit()
    if commit is None:
        raise RuntimeError("benchmark runs need PROTOCOL.md committed and unmodified first (spec: protocol before the first run)")
    changes = bench_changes()
    if changes:
        raise RuntimeError("benchmark runs need the benchmark's code, protocol and page set committed first: "
                           + "; ".join(changes))
    drift = bench_drift(commit)
    if drift:
        raise RuntimeError(f"the benchmark changed since the protocol commit {commit[:8]}: {'; '.join(drift)}. "
                           "Record the change as a dated deviation in PROTOCOL.md and commit it first")
    tree = bench_tree()
    if tree is None:
        raise RuntimeError("git could not name the benchmark's tree at HEAD")
    return {"protocol_commit": commit, "bench_tree": tree}


@contextmanager
def timed_slot(root: Path, *, wait: bool = False, cancel: threading.Event | None = None,
               on_wait: Callable[[], None] | None = None) -> Iterator[None]:
    """One timed run at a time on this Mac, for the command line and the webpage alike: an exclusive
    lock on <data root>/timed-run.lock, held from the warm-up until the record is sealed."""
    import fcntl

    root.mkdir(parents=True, exist_ok=True)
    with open(root / "timed-run.lock", "a+") as handle:
        told = False
        while True:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if not wait:
                    raise SlotBusy("another timed run is in progress; start this one when it has finished") from None
                if cancel is not None and cancel.is_set():
                    raise Cancelled("cancelled while waiting for the running method to finish") from None
                if on_wait is not None and not told:
                    on_wait()
                    told = True
                time.sleep(SLOT_POLL)
        try:
            if cancel is not None and cancel.is_set():
                raise Cancelled("cancelled as the timed-run slot became free")
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _environment(tool: Tool) -> list[str] | None:
    """The environment for a failed run, best effort: failing to read it must not hide why the run failed."""
    try:
        return environment(tool)
    except Exception:
        return None


def _timing(seconds: float | None, total: int) -> dict:
    if seconds is None:
        return {"seconds_total": None, "seconds_per_page": None}
    return {"seconds_total": round(seconds, 2), "seconds_per_page": round(seconds / total, 3)}


def _time_limit(tool: Tool, pages: int) -> float | None:
    """The spec's time limit for a timed run over `pages` pages, in seconds; None for a method without one."""
    return None if tool.limit_per_page is None else round(tool.limit_per_page * pages, 1)


def _limit_fields(tool: Tool, limit: float | None, exceeded: bool | None) -> dict:
    """`exceeded` is None when the timed run never ran (the warm-up failed): nothing was measured."""
    if limit is None:
        return {}
    return {"time_limit_per_page": tool.limit_per_page, "time_limit_s": limit, "did_not_run_here": exceeded}


def _too_slow(tool: Tool, limit: float, pages: int) -> str:
    return (f"did not run here: slower than {tool.limit_per_page:g} s/page on this Mac "
            f"(the timed run passed its time limit of {limit:g} s for {pages} pages)")


def input_pages(wanted: Sequence[int], total: int, neighbours: int) -> list[int]:
    """The pages a method is given when it gets the scored pages and `neighbours` pages on each side of each."""
    keep: set[int] = set()
    for page in wanted:
        keep.update(range(max(1, page - neighbours), min(total, page + neighbours) + 1))
    return sorted(keep)


def cut_pdf(pdf: Path, pages: Sequence[int], dest: Path) -> Path:
    """A copy of `pdf` holding only `pages` (1-based, in order), for a method given a page subset. The dropped
    pages' objects (images, fonts, content streams) are removed too (garbage=3), so the method reads a file of the
    pages it is given, not the whole deck's bytes."""
    import fitz

    with fitz.open(pdf) as doc:
        doc.select([p - 1 for p in pages])
        doc.save(dest, garbage=3)
    return dest


def _input_fields(given: list[int] | None, tool: Tool) -> dict:
    if given is None:
        return {}
    return {"input_pages": given, "neighbours": tool.neighbours, "seconds_per_page_basis": "pages given"}


def _cache_fields(tool: Tool, before: float | None) -> dict:
    """A heavy method's model folder after the run, and whether it grew during the timed run. `before` is its size
    just before the timed run (None when the run failed earlier: then nothing is claimed either way)."""
    if not tool.downloads_models:
        return {}
    after = cache_mb(tool)
    grew = None if before is None or after is None else after - before > 1.0
    return {"model_cache_mb": after, "models_downloaded_in_timed_run": grew}


@contextmanager
def _seal_on_error(run: store.ExtractRun, tool: Tool, fields: Mapping):
    """Whatever goes wrong while a run is being written, it ends sealed as failed, never stuck on
    'running'. Ctrl-C (any BaseException) seals it too, and is then passed on."""
    try:
        yield
    except BaseException as e:
        if run.meta["status"] != "running":
            raise
        detail = f": {e}" if str(e) else ""
        run.finish("failed", reason=f"error after run: {type(e).__name__}{detail}", failed_stage="after_run",
                   environment=_environment(tool), **fields)
        if not isinstance(e, Exception):
            raise


def run_tool(
    tool_id: str,
    pdf: Path,
    *,
    pages: Sequence[int] | None = None,
    purpose: str = "explore",
    warmup: bool = True,
    root: Path | None = None,
    registry: Mapping[str, Tool] = TOOLS,
    timeout: float | None = None,
    on_stage: Callable[[str], None] | None = None,
    cancel: threading.Event | None = None,
    wait_for_slot: bool = False,
    cost_ok: bool = False,
) -> store.ExtractRun:
    """Run one method on one PDF and keep the result. `on_stage` hears "waiting", "warmup", "timed"
    and "scoring"; setting `cancel` stops the runner (the run is kept, failed, reason "cancelled").
    Free methods warm up first (always, in a benchmark run); a paid method never does, needs
    cost_ok=True for every run, and is sent exactly the pages it is scored on. Benchmark runs need the
    protocol and the bench's code committed, and score exactly the page set's pages of the file."""
    if purpose not in store.PURPOSES:
        raise ValueError(f"purpose must be one of {store.PURPOSES}, not {purpose!r}")
    tool = registry[tool_id]
    if tool.paid and not cost_ok:
        raise ValueError(f"{tool_id} sends page images to OpenAI and costs money; it needs an explicit cost OK for this run")
    if tool.paid and purpose == "explore" and pages is not None and not list(pages):
        raise ValueError(f"{tool_id} is paid per page: an empty page list is refused (pass None for the whole file)")
    gaps = missing(tool)
    if gaps:
        raise ToolNotReady(f"{tool_id} is not ready: {'; '.join(gaps)}")
    extra: dict = {}
    if tool.paid:
        paid.price_of(tool.model)  # a model without a recorded price is refused before anything is sent
        warmup = False             # deviation 2: nothing to download; a warm-up would send and pay for two more pages
        extra["warmup_skipped"] = WARMUP_SKIPPED
    if purpose == "benchmark":
        extra.update(benchmark_gate())  # fast refusal; checked again once the slot is held
        if not warmup and not tool.paid:
            raise ValueError("benchmark runs always warm up, so a first-time model download is never timed")

    root = store.data_root() if root is None else root  # a refused data folder is found now, not after a long run
    pdf = Path(pdf).resolve()
    total = page_count(pdf)
    sha = sha256_file(pdf)
    wanted = planned_pages(pdf, pages, purpose)
    if purpose == "benchmark" and pages and sorted(set(pages)) != wanted:
        raise ValueError(f"benchmark runs score exactly the page set's pages of this file: {wanted}")
    outside = [p for p in wanted if not 1 <= p <= total]
    if outside:
        raise ValueError(f"pages {outside} are outside 1–{total}")
    source = {"path": str(pdf), "name": pdf.name, "sha256": sha, "pages_total": total}
    args = paid_args(tool, wanted)  # the pages a paid method is sent; empty for every other method
    facts = checks.document_facts(pdf)  # an unreadable file is found now, not after a long run

    def stage(name: str) -> None:
        if on_stage is not None:
            on_stage(name)

    with timed_slot(root, wait=wait_for_slot, cancel=cancel, on_wait=lambda: stage("waiting")):
        if purpose == "benchmark":
            # Code, protocol or page set may have been edited while this run waited for the slot.
            extra.update(benchmark_gate())
        return _run_in_slot(tool, tool_id, pdf, wanted, total, source, facts, purpose, extra, root,
                            warmup, timeout, cancel, stage, args)


def _run_in_slot(tool: Tool, tool_id: str, pdf: Path, wanted: list[int], total: int, source: dict,
                 facts: checks.DocFacts, purpose: str, extra: dict, root: Path, warmup: bool,
                 timeout: float | None, cancel: threading.Event | None, stage: Callable[[str], None],
                 args: list[str]) -> store.ExtractRun:
    # The record names the code as it was when the run started, not after a long run during which
    # a commit may have landed.
    started, git = store.now_iso(), store.git_state()
    record = dict(source=source, purpose=purpose, started_at=started, extra=extra, root=root, git=git,
                  checks_version=checks.CHECKS_VERSION)
    version, warm_seconds, step = "unknown", None, "warmup"
    given = None if tool.paid or tool.neighbours is None else input_pages(wanted, total, tool.neighbours)
    # a paid method's time is over the pages it was sent; a method given a page subset, over the pages given
    per_page = len(wanted) if tool.paid else (len(given) if given is not None else total)
    limit = _time_limit(tool, per_page)  # a heavy method's timed run stops here; its warm-up keeps `timeout`
    warm_timeout = DEFAULT_TIMEOUT if timeout is None else timeout  # the warm-up's bound; no time limit applies
    if limit is None:
        timed_timeout = warm_timeout
    else:  # no explicit timeout: the limit alone bounds the timed run; an explicit shorter one wins
        timed_timeout = limit if timeout is None else min(timeout, limit)
    limit_applied = limit is not None and timed_timeout == limit
    cache_before = None
    try:
        if warmup:
            stage("warmup")
            with tempfile.TemporaryDirectory() as tmp:
                warm = invoke(tool, two_page_sample(pdf, Path(tmp) / "warmup.pdf"), timeout=warm_timeout, cancel=cancel)
            version, warm_seconds = warm.version, round(warm.seconds, 2)
        step = "timed"
        stage("timed")
        cache_before = cache_mb(tool)
        with tempfile.TemporaryDirectory() as tmp:
            source_pdf = pdf if given is None else cut_pdf(pdf, given, Path(tmp) / "input.pdf")
            result = invoke(tool, source_pdf, args=args, timeout=timed_timeout, cancel=cancel)
        if given is not None:  # page k of the cut is page given[k - 1] of the file
            result.pages = {given[k - 1]: text for k, text in result.pages.items() if 1 <= k <= len(given)}
    except RunnerError as e:
        if step == "timed" and e.output:
            step = "output"  # the timed run ran to its end, so its time is known
        # stopped at the time limit (not at a shorter timeout the caller asked for): the method did not run here
        too_slow = step == "timed" and e.timed_out and limit_applied
        fields = {"pages_scored": wanted, "timeout_s": warm_timeout if step == "warmup" else timed_timeout,
                  "warmup_seconds": warm_seconds,
                  **_timing(e.seconds if step == "output" else None, per_page),
                  **_paid_fields(tool, e.api, wanted, finished=False),
                  **_limit_fields(tool, limit, None if step == "warmup" else too_slow), **_cache_fields(tool, cache_before),
                  **_input_fields(given, tool)}
        run = store.ExtractRun.create(tool=tool_id, version=version, **record)
        with _seal_on_error(run, tool, fields):
            run.append_log(paid.redact(e.log) if tool.paid else e.log)
            run.finish("failed", reason=_too_slow(tool, limit, per_page) if too_slow else str(e), failed_stage=step,
                       environment=_environment(tool), **fields)
        return run
    except KeyboardInterrupt as e:
        if not (tool.paid and step == "timed"):
            raise
        # Ctrl-C while a paid method ran: it may have been charged, so the record is kept (sealed failed) first.
        partial = getattr(e, "paid_partial", None) or {}
        fields = {"pages_scored": wanted, "timeout_s": timed_timeout, "warmup_seconds": warm_seconds,
                  **_timing(None, per_page), **_paid_fields(tool, partial.get("api"), wanted, finished=False)}
        run = store.ExtractRun.create(tool=tool_id, version=version, **record)
        with _seal_on_error(run, tool, fields):
            run.append_log(partial.get("log", ""))
            run.finish("failed", reason="interrupted", failed_stage="timed", environment=_environment(tool), **fields)
        raise

    if limit_applied and result.seconds > limit:  # ended within the last poll step past it
        fields = {"pages_scored": wanted, "timeout_s": timed_timeout, "warmup_seconds": warm_seconds,
                  **_timing(result.seconds, per_page), "peak_memory_mb": result.peak_mb,
                  **_limit_fields(tool, limit, True), **_cache_fields(tool, cache_before), **_input_fields(given, tool)}
        run = store.ExtractRun.create(tool=tool_id, version=result.version, settings=result.settings, **record)
        with _seal_on_error(run, tool, fields):
            run.append_log(result.log)
            run.finish("failed", reason=_too_slow(tool, limit, per_page), failed_stage="timed",
                       environment=_environment(tool), **fields)
        return run

    stage("scoring")
    # A tool that leaves out any page of the file has not extracted the file: the run
    # is kept, with the pages it did produce, but it is failed (ruling R1). A paid method is given only
    # the pages it scores, so those are the pages it must produce.
    expected = wanted if tool.paid else (given if given is not None else list(range(1, total + 1)))
    absent = [p for p in expected if p not in result.pages]
    fields = {"pages_scored": wanted, "missing_pages": absent, "timeout_s": timed_timeout,
              "warmup_seconds": warm_seconds,
              **_timing(result.seconds, per_page), "peak_memory_mb": result.peak_mb,
              **_paid_fields(tool, result.api, wanted, finished=not absent),
              **_limit_fields(tool, limit, False), **_cache_fields(tool, cache_before), **_input_fields(given, tool)}
    run = store.ExtractRun.create(tool=tool_id, version=result.version, settings=result.settings, **record)
    with _seal_on_error(run, tool, fields):
        run.append_log(paid.redact(result.log) if tool.paid else result.log)
        rows = []
        for page in wanted:
            if page not in result.pages:
                continue
            text = normalize_figures(result.pages[page])
            run.write_page(page, text)
            rows.append(checks.check_page(text, facts.pages[page], facts))
        run.write_checks(rows)
        run.finish(
            "failed" if absent else "finished",
            reason=f"missing pages {absent}" if absent else None,
            failed_stage="output" if absent else None,
            # a finished run must name its environment; a failed one records it if it can
            environment=_environment(tool) if absent else environment(tool),
            **fields,
        )
    return run
