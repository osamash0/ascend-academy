"""Comparison runs: a frozen duel schedule over extraction runs, and the append-only vote log.

runs/compare/cmp-<YYYY-MM-DD>_<4hex>/
  compare.json  purpose, entrants (tool → its extraction run per PDF), the pages with their types,
                protocol commit, seed and schedule. It changes only while status is "judging"
                (round 2 appends duels, an early unlock is noted); "finished" seals it.
                A comparison that adds methods to finished ones also names them ("builds_on") and its
                "new_entrants"; its ratings pool their votes (results.py), which are only read.
                It may also name its "opponents": the earlier entrants its new ones meet (Deviation 3).
  votes.jsonl   one JSON line per vote or retraction, appended and fsynced, never rewritten.
                Undo appends a retraction; it never deletes a line.
  results.json  recomputed from votes.jsonl by results.py, never edited by hand.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import secrets
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator, Mapping, Sequence

from backend.eval.parser_bench import checks, pageset, schedule, store

CHOICES = ("left", "right", "same", "both_bad")
COMPARE_RECORD_VERSION = 1
SESSION = re.compile(r"s-[0-9a-f]{8,32}")
NOTE_MAX = 500
EVENT_TYPES = ("vote", "retract")


def _check_session(session: Any) -> None:
    if not isinstance(session, str) or not SESSION.fullmatch(session):
        raise ValueError("session must be a string like s-<hex>")


def new_compare_id(*, now: datetime | None = None, token: str | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    return f"cmp-{now:%Y-%m-%d}_{token or secrets.token_hex(2)}"


def _events_in(raw: bytes) -> list[dict[str, Any]]:
    """Every vote and retraction in log order. Split on b"\\n" only, then each line is decoded and
    parsed on its own: a line that does not decode (a crash inside a multi-byte character), does not
    parse (a torn write), or is not a vote or a retraction is skipped."""
    events = []
    for line in raw.split(b"\n"):
        if not line.strip():
            continue
        try:
            e = json.loads(line.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        if isinstance(e, dict) and e.get("type") in EVENT_TYPES:
            events.append(e)
    return events


def active_from_events(events: Sequence[Mapping[str, Any]]) -> dict[int, dict[str, Any]]:
    """Each duel's vote that still counts, in log order. A vote counts when no vote for its duel
    counts already; a later vote for that duel never counts. A retraction withdraws the counting
    vote it names, which brings the duel back to pending."""
    active: dict[int, dict[str, Any]] = {}
    for e in events:
        if e["type"] == "vote":
            active.setdefault(e["duel"], e)
        else:
            active = {d: v for d, v in active.items() if v["vote_id"] != e["vote_id"]}
    return active


@dataclass(frozen=True)
class CompareRun:
    path: Path

    @property
    def run_id(self) -> str:
        return self.path.name

    @property
    def meta(self) -> dict[str, Any]:
        return json.loads((self.path / "compare.json").read_text(encoding="utf-8"))

    @property
    def votes_path(self) -> Path:
        return self.path / "votes.jsonl"

    @classmethod
    def open(cls, run_id: str, root: Path | None = None) -> "CompareRun":
        path = store.find_run(run_id, root)
        if not (path / "compare.json").exists():
            raise FileNotFoundError(f"{run_id} is not a comparison")
        return cls(path)

    @classmethod
    def create(
        cls,
        *,
        entrants: Mapping[str, Mapping[str, str]],
        pages: Sequence[Mapping[str, Any]],
        seed: int,
        duels: Sequence[Mapping[str, Any]],
        protocol_commit: str | None,
        purpose: str = "benchmark",
        anchor: str = "current",
        bench_tree: str | None = None,
        provenance: Mapping[str, Mapping[str, Any]] | None = None,
        builds_on: Sequence[str] = (),
        new_entrants: Sequence[str] = (),
        opponents: Sequence[str] | None = None,
        root: Path | None = None,
    ) -> "CompareRun":
        if purpose not in store.PURPOSES:
            raise ValueError(f"purpose must be one of {store.PURPOSES}, not {purpose!r}")
        if anchor not in entrants:
            raise ValueError(f"the anchor {anchor!r} must be one of the entrants")
        if builds_on and not new_entrants:
            raise ValueError("a comparison that builds on others names its new entrants")
        if any(t not in entrants for t in new_entrants):
            raise ValueError("every new entrant must be an entrant")
        if opponents is not None:
            if not new_entrants:
                raise ValueError("opponents restrict a comparison that adds new entrants")
            if not opponents or any(t not in entrants or t in new_entrants for t in opponents):
                raise ValueError("every opponent must be an earlier entrant")
        base = (root or store.data_root()) / "runs" / "compare"
        base.mkdir(parents=True, exist_ok=True)
        while True:
            path = base / new_compare_id()
            try:
                path.mkdir()
                break
            except FileExistsError:
                continue
        store._write_json(path / "compare.json", {
            "run_id": path.name,
            "kind": "compare",
            "record_version": COMPARE_RECORD_VERSION,
            "purpose": purpose,
            "status": "judging",
            "started_at": store.now_iso(),
            "finished_at": None,
            "protocol_commit": protocol_commit,
            "bench_tree": bench_tree,
            "provenance": {tool: dict(p) for tool, p in sorted((provenance or {}).items())} or None,
            "git": store.git_state(),
            "checks_version": checks.CHECKS_VERSION,
            "seed": seed,
            "anchor": anchor,
            "builds_on": list(builds_on),
            "new_entrants": sorted(new_entrants),
            **({"opponents": sorted(opponents)} if opponents is not None else {}),
            "entrants": {tool: dict(runs) for tool, runs in sorted(entrants.items())},
            "pages": [dict(p) for p in pages],
            "schedule": [dict(d) for d in duels],
            "rounds": 1,
            "round2_duels": 0,
            "unlocked_early": None,
        })
        (path / "votes.jsonl").touch()
        return cls(path)

    # --- the record -------------------------------------------------------------------

    def _update(self, **fields: Any) -> None:
        meta = self.meta
        if meta["status"] != "judging":
            raise store.RunFinishedError(f"{self.run_id} is {meta['status']}; start a new comparison instead")
        meta.update(fields)
        store._write_json(self.path / "compare.json", meta)

    def extend(self, duels: Sequence[Mapping[str, Any]]) -> None:
        """Round 2: append duels (numbered on from the schedule) while judging."""
        with self._exclusive():
            self._extend_locked(duels)

    def extend_if(self, guard: Callable[[], bool], duels: Sequence[Mapping[str, Any]]) -> bool:
        """`extend`, but only if `guard()` still holds. The guard runs under the vote lock, so no vote or
        undo can land between it and the extension. Returns whether the duels were added."""
        with self._exclusive():
            if not guard():
                return False
            self._extend_locked(duels)
            return True

    def _extend_locked(self, duels: Sequence[Mapping[str, Any]]) -> None:
        meta = self.meta
        self._update(schedule=meta["schedule"] + [dict(d) for d in duels], rounds=meta["rounds"] + 1,
                     round2_duels=meta["round2_duels"] + len(duels))

    def finish(self) -> None:
        """Seal the comparison. Under the vote lock, so no vote can land after the seal."""
        with self._exclusive():
            self._update(status="finished", finished_at=store.now_iso())

    def finish_if(self, guard: Callable[[], bool]) -> bool:
        """`finish`, but only if `guard()` still holds under the vote lock. Returns whether it sealed."""
        with self._exclusive():
            if not guard():
                return False
            self._update(status="finished", finished_at=store.now_iso())
            return True

    def unlock_early(self, reason: str) -> None:
        with self._exclusive():
            done, total = self.progress()
            self._update(unlocked_early={"at": store.now_iso(), "reason": reason, "done": done, "total": total})

    # --- the vote log -----------------------------------------------------------------

    @contextmanager
    def _exclusive(self) -> Iterator[None]:
        """One writer at a time: vote() and undo() check the log and append under this lock, so two
        posts of the same duel cannot both pass the check. The lock is per open file, so two
        CompareRun objects (two threads, or the CLI and the webpage) exclude each other too."""
        with open(self.path / "votes.lock", "a") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

    def _append(self, line: Mapping[str, Any]) -> None:
        """Append one line. A torn last line (a crash mid-write, no newline) is closed off first, so
        the new line starts on its own; events() skips the torn line."""
        prefix = ""
        if self.votes_path.exists() and self.votes_path.stat().st_size and not self._ends_with_newline():
            prefix = "\n"
        with open(self.votes_path, "a", encoding="utf-8") as f:
            f.write(prefix + json.dumps(line, ensure_ascii=False) + "\n")
            f.flush()
            os.fsync(f.fileno())

    def _ends_with_newline(self) -> bool:
        with open(self.votes_path, "rb") as f:
            f.seek(-1, os.SEEK_END)
            return f.read(1) == b"\n"

    def read_log(self) -> tuple[list[dict[str, Any]], str]:
        """The log read once: its vote and retraction events in order, and the sha256 digest of the
        same bytes. Callers that need both take them from here, so they never come from two reads."""
        raw = self.votes_path.read_bytes() if self.votes_path.exists() else b""
        return _events_in(raw), hashlib.sha256(raw).hexdigest()

    def events(self) -> list[dict[str, Any]]:
        """Every vote and retraction in log order (see `_events_in` for what is skipped)."""
        return self.read_log()[0]

    def active_votes(self) -> dict[int, dict[str, Any]]:
        """The votes that still count (see `active_from_events`)."""
        return active_from_events(self.events())

    def active_votes_and_digest(self) -> tuple[dict[int, dict[str, Any]], str]:
        """The votes that still count and the digest of the log they came from, from one read."""
        events, digest = self.read_log()
        return active_from_events(events), digest

    def progress(self) -> tuple[int, int]:
        return len(self.active_votes()), len(self.meta["schedule"])

    def next_duel(self) -> dict[str, Any] | None:
        """The first scheduled duel without a vote; after an undo, the duel that lost its vote."""
        active = self.active_votes()
        return next((d for d in self.meta["schedule"] if d["duel"] not in active), None)

    def vote(self, *, duel: int, choice: str, seconds: float, session: str, note: str | None = None) -> dict[str, Any]:
        with self._exclusive():
            if self.meta["status"] != "judging":
                raise store.RunFinishedError(f"{self.run_id} is finished")
            if choice not in CHOICES:
                raise ValueError(f"choice must be one of {CHOICES}")
            _check_session(session)
            if isinstance(seconds, bool) or not isinstance(seconds, (int, float)):
                raise ValueError(f"seconds must be a number, not {type(seconds).__name__}")
            if not 0 <= float(seconds) < 24 * 3600:
                raise ValueError("seconds must be between 0 and a day")
            scheduled = [d for d in self.meta["schedule"] if d["duel"] == duel]
            if not scheduled:
                raise ValueError(f"duel {duel} is not in the schedule")
            expected = self.next_duel()
            if expected is None or expected["duel"] != duel:
                raise ValueError(f"duel {duel} is not the next duel to judge")
            line = {
                "type": "vote",
                "vote_id": f"v-{secrets.token_hex(4)}",
                "duel": duel,
                "page": expected["page"],
                "left": expected["left"],
                "right": expected["right"],
                "choice": choice,
                "seconds": round(float(seconds), 1),
                "session": session,
                "at": store.now_iso(),
                "note": (note or "").strip()[:NOTE_MAX] or None,
            }
            self._append(line)
            return line

    def undo(self, *, session: str) -> dict[str, Any] | None:
        """Withdraw the most recent vote that still counts, by appending a retraction."""
        with self._exclusive():
            if self.meta["status"] != "judging":
                raise store.RunFinishedError(f"{self.run_id} is finished")
            _check_session(session)
            active = self.active_votes()
            if not active:
                return None
            last = max(active.values(), key=lambda v: self._order(v["vote_id"]))
            line = {"type": "retract", "vote_id": last["vote_id"], "duel": last["duel"], "session": session, "at": store.now_iso()}
            self._append(line)
            return line

    def _order(self, vote_id: str) -> int:
        return next(i for i, e in enumerate(self.events()) if e.get("vote_id") == vote_id and e["type"] == "vote")

    # --- outputs ----------------------------------------------------------------------

    def page(self, key: str) -> dict[str, Any]:
        for p in self.meta["pages"]:
            if p["key"] == key:
                return p
        raise FileNotFoundError(f"{self.run_id} has no page {key!r}")

    def output(self, tool: str, key: str, root: Path | None = None) -> str:
        """The Markdown an entrant produced for one page of this comparison."""
        page = self.page(key)
        run_id = self.meta["entrants"][tool][page["sha256"]]
        run = store.ExtractRun(store.find_run(run_id, root))
        return run.pages()[int(page["page"])]


def latest_benchmark_runs(tools: Sequence[str], pages: Sequence[pageset.BenchPage], commit: str,
                          root: Path | None = None) -> dict[str, dict[str, str]]:
    """Per tool and PDF, the newest finished benchmark run made under this protocol commit that
    scored exactly the page set's pages of that PDF with the current checks."""
    metas = [m for m in store.list_runs(root) if m.get("kind") == "extract"]  # newest first
    files = {p.sha256: p.file for p in pages}
    entrants: dict[str, dict[str, str]] = {}
    missing = []
    for tool in tools:
        entrants[tool] = {}
        for sha, file in sorted(files.items()):
            want = pageset.pages_for(sha, pages)
            match = next((m for m in metas
                          if m.get("tool") == tool and m.get("status") == "finished" and m.get("purpose") == "benchmark"
                          and m.get("source", {}).get("sha256") == sha and m.get("protocol_commit") == commit
                          and store.checks_version(m) == checks.CHECKS_VERSION and sorted(m.get("pages_scored") or []) == want),
                         None)
            if match is None:
                missing.append(f"{tool} on {file}")
            else:
                entrants[tool][sha] = match["run_id"]
    if missing:
        raise ValueError("no finished benchmark run under this protocol for: " + "; ".join(missing))
    return entrants


def _provenance(entrants: Mapping[str, Mapping[str, str]], root: Path | None = None) -> dict[str, dict[str, Any]]:
    """Per entrant: the protocol commit and bench tree its runs were made under (runs from before bench trees
    were recorded have None). One entrant's runs must agree."""
    out: dict[str, dict[str, Any]] = {}
    for tool, runs in sorted(entrants.items()):
        seen = set()
        for run_id in runs.values():
            meta = store.ExtractRun(store.find_run(run_id, root)).meta
            seen.add((meta.get("protocol_commit"), meta.get("bench_tree")))
        if len(seen) != 1:
            raise ValueError(f"{tool}'s runs were made under different protocol commits or bench trees: {sorted(seen, key=str)}")
        commit, tree = seen.pop()
        out[tool] = {"protocol_commit": commit, "bench_tree": tree}
    return out


def require_one_bench_tree(provenance: Mapping[str, Mapping[str, Any]], tree: str | None) -> None:
    """The one check every comparison creator makes: all entrants' runs were made with the same bench tree, and
    that tree is the one being recorded in compare.json (`tree`, from execute.benchmark_gate()). create_benchmark
    and the pooled creator both call it, so a comparison can never record a tree its outputs were not made with."""
    trees = {p["bench_tree"] for p in provenance.values()}
    if len(trees) > 1:
        raise ValueError(f"the entrants' runs were made with different bench trees ({', '.join(sorted(map(str, trees)))}); "
                         "make them again under one protocol commit")
    if trees != {tree}:
        raise ValueError(f"the entrants' runs were made with bench tree {', '.join(sorted(map(str, trees)))}; "
                         f"they do not match the benchmark's current tree {tree}")


def create_benchmark(tools: Sequence[str], *, seed: int, commit: str | None, tree: str | None = None,
                     pages: Sequence[pageset.BenchPage] | None = None, anchor: str = "current",
                     root: Path | None = None) -> CompareRun:
    """A new blind comparison of `tools` on the page set, from their latest benchmark runs. `commit` and `tree`
    come from execute.benchmark_gate(); the entrants' runs must all carry exactly that bench tree."""
    if commit is None:
        raise RuntimeError("a benchmark comparison needs PROTOCOL.md committed and unmodified")
    pages = pageset.load() if pages is None else list(pages)
    entrants = latest_benchmark_runs(tools, pages, commit, root)
    provenance = _provenance(entrants, root)
    require_one_bench_tree(provenance, tree)
    duels = schedule.round1(list(tools), [schedule.SchedPage(p.key, p.type) for p in pages], seed)
    return CompareRun.create(entrants=entrants, pages=[pageset.as_entry(p) for p in pages], seed=seed, duels=duels,
                             protocol_commit=commit, anchor=anchor, bench_tree=tree, provenance=provenance, root=root)


def _page_ids(entries: Sequence[Mapping[str, Any]]) -> list[tuple]:
    return sorted((p["key"], p["sha256"], int(p["page"]), p["type"]) for p in entries)


def create_pooled(new_tools: Sequence[str], *, against: Sequence[str], seed: int, commit: str | None,
                  tree: str | None = None, pages: Sequence[pageset.BenchPage] | None = None,
                  opponents: Sequence[str] | None = None, root: Path | None = None) -> CompareRun:
    """A comparison that adds `new_tools` to finished comparisons (`against`) on one rating scale (spec decision 9).

    The earlier entrants keep the runs their comparison judged, named by run id, whatever protocol commit (and
    bench tree, or none) they were made under; they are only read, never refused for lacking a tree. The new
    tools' runs are their latest benchmark runs under `commit`, and only those must carry the bench tree `tree`
    (require_one_bench_tree). Only pairs with a new tool are scheduled. The earlier comparisons are only read:
    results.summarize pools their votes with this one's, with the same anchor and pages.
    With opponents, the new tools meet each other and only those earlier entrants (schedule.pair_allowed)."""
    if commit is None:
        raise RuntimeError("a benchmark comparison needs PROTOCOL.md committed and unmodified")
    fresh_tools = sorted(set(new_tools))
    if not fresh_tools:
        raise ValueError("name the new methods (--tools)")
    if not against:
        raise ValueError("name the finished comparison to build on (--against)")
    pages = pageset.load() if pages is None else list(pages)
    entries = [pageset.as_entry(p) for p in pages]
    chain: list[str] = []
    earlier: dict[str, dict[str, str]] = {}
    earlier_provenance: dict[str, dict[str, Any]] = {}
    anchors: set[str] = set()
    for cid in against:
        meta = CompareRun.open(cid, root).meta
        if meta.get("purpose") != "benchmark" or meta.get("status") != "finished":
            raise ValueError(f"{cid} is not a finished benchmark comparison")
        if _page_ids(meta["pages"]) != _page_ids(entries):
            raise ValueError(f"{cid} judged other pages than the page set; a pooled comparison needs the same pages")
        if store.checks_version(meta) != checks.CHECKS_VERSION:
            raise ValueError(f"{cid} was scored with checks version {store.checks_version(meta)}, not {checks.CHECKS_VERSION}")
        for earlier_id in [*(meta.get("builds_on") or []), cid]:
            if earlier_id not in chain:
                chain.append(earlier_id)
        for tool, runs in meta["entrants"].items():
            if tool in earlier and earlier[tool] != runs:
                raise ValueError(f"{tool} was judged with different runs in {', '.join(against)}")
            earlier[tool] = dict(runs)
            if tool not in earlier_provenance:
                recorded = (meta.get("provenance") or {}).get(tool)
                try:
                    earlier_provenance[tool] = dict(recorded) if recorded else _provenance({tool: runs}, root)[tool]
                except ValueError as e:
                    raise ValueError(f"{cid}: {e}") from None
        anchors.add(meta["anchor"])
    if len(anchors) != 1:
        raise ValueError(f"the comparisons built on use different anchors: {sorted(anchors)}")
    clash = [t for t in fresh_tools if t in earlier]
    if clash:
        raise ValueError(f"{', '.join(clash)} already rated in {', '.join(against)}; a pooled comparison adds new methods only")
    rivals = None
    if opponents is not None:
        rivals = sorted(set(opponents))
        unknown = [t for t in rivals if t not in earlier]
        if not rivals or unknown:
            raise ValueError(f"opponents must be methods rated in {', '.join(against)}: "
                             f"{', '.join(unknown) or 'none named'}")
    for runs in earlier.values():
        for run_id in runs.values():
            if store.ExtractRun(store.find_run(run_id, root)).meta.get("status") != "finished":
                raise ValueError(f"{run_id} is not a finished run")
    fresh = latest_benchmark_runs(fresh_tools, pages, commit, root)
    fresh_provenance = _provenance(fresh, root)
    require_one_bench_tree(fresh_provenance, tree)
    entrants = {**earlier, **fresh}
    duels = schedule.round1(sorted(entrants), [schedule.SchedPage(p.key, p.type) for p in pages], seed,
                            new=fresh_tools, opponents=rivals)
    return CompareRun.create(entrants=entrants, pages=entries, seed=seed, duels=duels, protocol_commit=commit,
                             anchor=anchors.pop(), bench_tree=tree,
                             provenance={**earlier_provenance, **fresh_provenance},
                             builds_on=chain, new_entrants=fresh_tools, opponents=rivals, root=root)


def list_comparisons(root: Path | None = None) -> list[CompareRun]:
    base = (root or store.data_root()) / "runs" / "compare"
    if not base.is_dir():
        return []
    runs = [CompareRun(p) for p in base.iterdir() if (p / "compare.json").exists()]
    return sorted(runs, key=lambda r: r.meta.get("started_at") or "", reverse=True)
