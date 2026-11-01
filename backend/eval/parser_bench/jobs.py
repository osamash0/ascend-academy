"""Background jobs for the webpage: method runs and installs, one at a time, journalled on disk.

Each job is a JSON file under <data root>/jobs/. The journal is what makes a running method
visible (its run record is only written when it ends), lets a page reload see the progress, and
survives the server: a job the server did not finish is marked "interrupted" when it starts again.
Runs go through execute.run_tool, which also holds the one-timed-run slot against the command line.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Any, Callable

from backend.eval.parser_bench import execute, files, paid, store, tools

log = logging.getLogger(__name__)

STATES = ("queued", "running", "finished", "failed", "cancelled", "interrupted")
ACTIVE = ("queued", "running")


class JobQueue:
    def __init__(self, root: Path, *, runner: Callable[..., Any] = execute.run_tool,
                 installer: Callable[[tools.Tool], Any] = tools.install,
                 poll: float = 0.2):
        self.root = root
        self.dir = root / "jobs"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.runner, self.installer, self.poll = runner, installer, poll
        self._cancel: dict[str, threading.Event] = {}
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._recover()

    # --- the journal ------------------------------------------------------------------

    def _path(self, job_id: str) -> Path:
        if not (job_id.startswith("job-") and job_id[4:].isalnum()):
            raise ValueError(f"{job_id!r} is not a job id")
        return self.dir / f"{job_id}.json"

    def get(self, job_id: str) -> dict[str, Any]:
        path = self._path(job_id)
        if not path.exists():
            raise FileNotFoundError(f"no job {job_id}")
        return json.loads(path.read_text(encoding="utf-8"))

    def _save(self, job: dict[str, Any]) -> dict[str, Any]:
        store._write_json(self._path(job["job_id"]), job)
        return job

    def _update(self, job_id: str, **fields: Any) -> dict[str, Any]:
        with self._lock:
            job = self.get(job_id)
            job.update(fields)
            return self._save(job)

    def _end(self, job_id: str, state: str, **fields: Any) -> dict[str, Any]:
        """The one write that ends a job: state, end time and a cleared stage land together, so a reader
        who sees the final state also sees when it ended."""
        return self._update(job_id, state=state, ended_at=store.now_iso(), stage=None, **fields)

    def list(self) -> list[dict[str, Any]]:
        """Every readable job, newest first. A file that is not valid JSON or lacks the fields every job
        has is skipped (and logged), so one bad file never takes the queue down."""
        jobs = []
        for path in self.dir.glob("job-*.json"):
            try:
                job = json.loads(path.read_text(encoding="utf-8"))
                if not (isinstance(job, dict) and isinstance(job.get("job_id"), str)
                        and isinstance(job.get("state"), str) and isinstance(job.get("created_at"), str)):
                    raise ValueError("not a job record")
            except (OSError, ValueError) as e:
                log.warning("parser-bench jobs: skipping unreadable journal file %s (%s)", path.name, e)
                continue
            jobs.append(job)
        return sorted(jobs, key=lambda j: j["created_at"], reverse=True)

    def _set_stage(self, job_id: str, stage: str) -> None:
        """A stage reported by the runner; it never replaces "cancelling" and never touches a job that has ended."""
        with self._lock:
            job = self.get(job_id)
            if job["state"] == "running" and job["stage"] != "cancelling":
                job["stage"] = stage
                self._save(job)

    def _recover(self) -> None:
        for job in self.list():
            if job["state"] in ACTIVE and job.get("server_pid") != os.getpid():
                job.update(state="interrupted", ended_at=store.now_iso(), stage=None,
                           error="the server stopped before this job finished")
                self._save(job)

    def _new(self, **fields: Any) -> dict[str, Any]:
        job = {"job_id": f"job-{time.strftime('%Y%m%d%H%M%S')}{secrets.token_hex(3)}", "state": "queued",
               "created_at": f"{time.time():.6f}", "queued_at": store.now_iso(), "started_at": None, "ended_at": None,
               "stage": None, "run_id": None, "error": None, "server_pid": os.getpid(), **fields}
        self._save(job)
        self._wake.set()
        return job

    # --- what the webpage asks for ----------------------------------------------------

    def pages_for(self, stored: files.StoredFile, purpose: str) -> list[int]:
        """The pages a run of this file would score, which are the pages a paid method sends. The run itself
        decides (execute.planned_pages); this only hands it the stored file, so the estimate shown before the
        cost OK and the pages actually sent can never differ."""
        return execute.planned_pages(files.resolve_pdf(stored.sha256, self.root), None, purpose)

    def _checked_run(self, tool: str, sha256: str, purpose: str, cost_ok: Any) -> dict[str, Any]:
        """Everything a run needs to be accepted, without queueing it: the job's fields, or ValueError."""
        if tool not in tools.TOOLS:
            raise ValueError(f"unknown method {tool!r}")
        if purpose not in store.PURPOSES:
            raise ValueError(f"purpose must be one of {store.PURPOSES}")
        stored = files.find_file(sha256, self.root)
        pages = self.pages_for(stored, purpose)
        method = tools.TOOLS[tool]
        estimate = None
        if method.paid:
            if cost_ok is not True:
                raise ValueError(f"{tool} sends page images to OpenAI and costs money; confirm the cost first")
            estimate = paid.estimate(method.model, len(pages)).as_dict()
        return dict(kind="run", tool=tool, sha256=sha256, file_name=stored.name, purpose=purpose,
                    cost_ok=bool(method.paid), estimate=estimate)

    def submit_run(self, *, tool: str, sha256: str, purpose: str, cost_ok: bool = False) -> dict[str, Any]:
        """Queue one method on one stored file. A paid method needs cost_ok (exactly True), given after the
        page count and the estimate were shown (spec: an explicit OK each run); the job keeps that estimate,
        never the key."""
        return self._new(**self._checked_run(tool, sha256, purpose, cost_ok))

    def submit_runs(self, tool_ids: list[str], *, sha256: str, purpose: str, cost_ok: bool = False) -> list[dict[str, Any]]:
        """Queue several methods on one file, all or none: every one is checked before the first is queued, so
        a refusal (a paid method without the OK, a method without a price) leaves nothing behind. A method
        named twice runs once, so one cost OK never pays for two runs."""
        unique = list(dict.fromkeys(tool_ids))
        checked = [self._checked_run(t, sha256, purpose, cost_ok) for t in unique]
        return [self._new(**fields) for fields in checked]

    def submit_install(self, tool: str) -> dict[str, Any]:
        if tool not in tools.TOOLS:
            raise ValueError(f"unknown method {tool!r}")
        return self._new(kind="install", tool=tool, sha256=None, file_name=None, purpose=None)

    def cancel(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            job = self.get(job_id)
            if job["state"] == "queued":
                job.update(state="cancelled", ended_at=store.now_iso())
                return self._save(job)
            if job["state"] == "running" and job["kind"] == "install":
                raise ValueError("an install can't be cancelled once it has started")
            if job["state"] == "running" and job_id in self._cancel:
                self._cancel[job_id].set()
                job.update(stage="cancelling")
                return self._save(job)
        raise ValueError(f"{job_id} is {job['state']}; only a queued or running job can be cancelled")

    # --- the worker -------------------------------------------------------------------

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            if self._stop.is_set():
                raise RuntimeError("the previous worker is still stopping; start again when it has ended")
            return  # already running
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="parser-bench-jobs", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = execute.TERM_GRACE + 5.0) -> None:  # longer than a paid runner's grace
        with self._lock:  # under the lock, so a job is either claimed with its cancel event set or not claimed
            self._stop.set()
            for event in self._cancel.values():
                event.set()
        self._wake.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout)
            if not thread.is_alive():
                self._thread = None  # a worker that is still alive stays on record, so start() cannot add a second

    def _next(self) -> dict[str, Any] | None:
        queued = [j for j in self.list() if j["state"] == "queued"]
        return min(queued, key=lambda j: j["created_at"]) if queued else None

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                job = self._next()
                if job is None:
                    self._wake.wait(self.poll)
                    self._wake.clear()
                    continue
                self._execute(job["job_id"])
            except Exception:  # whatever went wrong with one job or file, the worker carries on
                log.exception("parser-bench jobs: worker error")
                self._stop.wait(self.poll)

    def _execute(self, job_id: str) -> None:
        cancel = threading.Event()
        with self._lock:
            job = self.get(job_id)
            if job["state"] != "queued" or self._stop.is_set():
                return  # cancelled meanwhile, or the queue is stopping: the job stays as it is
            self._cancel[job_id] = cancel
            job.update(state="running", started_at=store.now_iso(), stage="starting")
            self._save(job)
        try:
            if job["kind"] == "run":
                # resolve_pdf re-hashes the stored upload, so a file changed on disk is never run.
                pdf = files.resolve_pdf(job["sha256"], self.root)
                run = self.runner(job["tool"], pdf, purpose=job["purpose"], cost_ok=bool(job.get("cost_ok")),
                                  root=self.root, wait_for_slot=True, cancel=cancel,
                                  on_stage=lambda stage: self._set_stage(job_id, stage))
                meta = run.meta
                reason = meta.get("reason")
                # The record decides: a run that finished stays finished even if cancel came too late.
                if meta["status"] == "finished":
                    state = "finished"
                elif "was cancelled" in (reason or ""):
                    state = "cancelled"
                else:
                    state = "failed"
                self._end(job_id, state, run_id=meta["run_id"], error=reason)
            else:
                self.installer(tools.TOOLS[job["tool"]])
                self._end(job_id, "finished")
        except execute.Cancelled as e:
            self._end(job_id, "cancelled", error=str(e) or None)
        except Exception as e:  # a job's failure is its record, never the server's
            self._end(job_id, "failed", error=f"{type(e).__name__}: {e}")
        finally:
            self._cancel.pop(job_id, None)
