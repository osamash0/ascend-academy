"""The blinding lock (spec "The webpage").

A page of a benchmark comparison that is still being judged is locked for every method. A page of the page
set is locked for a method until a finished (or early-unlocked) benchmark comparison had that method among
its entrants and included that page: a method that joins later (ai_vision, the heavy methods) stays hidden
on the page set until its own comparison is judged, even though the fast methods' outputs there are open.
While locked, no output of that page by that method is shown anywhere, whichever run it comes from (explore
runs of a benchmark deck included): not in Runs, Compare, the Scoreboard or My votes. Only the duels show it,
without names. Abi may unlock a comparison early; that is written to the lab log as a deviation.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Iterable

from backend.eval.parser_bench import pageset, store
from backend.eval.parser_bench.compare import CompareRun, list_comparisons

LAB_LOG = store.REPO / "docs" / "thesis" / "experiments" / "parser-benchmark" / "LAB_LOG.md"
LOCKED_MESSAGE = ("this page is in the benchmark set and still being judged blind; "
                  "its outputs open when judging is finished")
PageRef = tuple[str, int]  # (sha256, page)


class Locked(Exception):
    """An output view of a page that is still being judged blind."""


@dataclass(frozen=True)
class Lock:
    judging: frozenset[PageRef]                 # pages of comparisons still judging: hidden for every method
    page_set: frozenset[PageRef]
    judged: frozenset[tuple[str, int, str]]     # (sha256, page, method) opened by a finished comparison

    def hides(self, sha256: str | None, page: int, tool: str | None) -> bool:
        ref = (sha256, int(page))
        if ref in self.judging:
            return True
        return ref in self.page_set and (sha256, int(page), tool) not in self.judged


def _open(meta: dict) -> bool:
    return meta["status"] == "finished" or bool(meta.get("unlocked_early"))


def lock_state(root: Path | None = None, pages: Iterable[pageset.BenchPage] | None = None) -> Lock:
    metas = [c.meta for c in list_comparisons(root)]
    metas = [m for m in metas if m.get("purpose") == "benchmark"]
    judging = {(p["sha256"], int(p["page"])) for m in metas if not _open(m) for p in m["pages"]}
    judged = {(p["sha256"], int(p["page"]), tool)
              for m in metas if _open(m) for p in m["pages"] for tool in m["entrants"]}
    page_set = pageset.load_or_empty() if pages is None else pages
    return Lock(frozenset(judging), frozenset((p.sha256, p.page) for p in page_set), frozenset(judged))


def check(sha256: str, page: int, tool: str | None, state: Lock) -> None:
    if state.hides(sha256, page, tool):
        raise Locked(LOCKED_MESSAGE)


def comparison_locked(meta: dict) -> bool:
    return meta.get("purpose") == "benchmark" and not _open(meta)


def unlock_early(cmp: CompareRun, reason: str, *, lab_log: Path | None = None) -> None:
    """Lift the lock before judging is finished, and log it as a deviation."""
    lab_log = LAB_LOG if lab_log is None else lab_log
    reason = " ".join(reason.split())
    if not reason:
        raise ValueError("say why the lock is lifted early; it goes into the lab log")
    if not comparison_locked(cmp.meta):  # only a benchmark comparison still judging, never twice
        raise ValueError(f"{cmp.run_id} is not a locked benchmark comparison; nothing to unlock")
    done, total = cmp.progress()
    # The log line goes first: if the write fails, the error propagates and the comparison stays locked.
    with open(lab_log, "a", encoding="utf-8") as f:
        f.write(f"\n## {date.today().isoformat()} — deviation: blinding lock lifted early\n\n"
                f"- Comparison `{cmp.run_id}`: {done} of {total} duels judged when the lock was lifted.\n"
                f"- Reason given: {reason}\n")
    cmp.unlock_early(reason)
