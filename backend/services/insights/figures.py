"""The three figures, each with its last eight weeks (oldest first).

- reading: members who read anything that week (a count);
- landing: of the pages at least `floor` members read that week, the percent
  where fewer than one in five of them needed it;
- cleared: of the checkpoint questions members tried for the first time that
  week, the percent they got right, once at least `floor` people tried one.

Who read a page and who needed it are not decided here: each week is folded
by `space_facts.lesson_facts`, the one rule every number on the door shares
(a sitting is a reader, a taken-back check-in is not a need).

A week is seven days back from now. A week with nothing to say (no page `floor`
people read, fewer than `floor` people at a checkpoint) is `None`, not 0%: the
door shows a dash, never a claim. Under the Space's floor only `reading` is
real; the other two are empty, and the door shows no figures (spec §5).
"""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from typing import Any, Optional

from backend.services.insights.sources.space import Event, SpaceData
from backend.services.insights.space_facts import first_tries, lesson_facts

WEEKS = 8
#: A page lands in a week when fewer than this share of its readers needed it.
LANDS_BELOW = 0.2


def _week(at: datetime, now: datetime) -> Optional[int]:
    """0 = the oldest of the eight weeks, 7 = the last seven days; None outside them."""
    age = now - at
    if age.total_seconds() < 0:
        return None
    i = WEEKS - 1 - age.days // 7
    return i if 0 <= i < WEEKS else None


def figures(data: SpaceData, floor: int) -> dict[str, Any]:
    buckets: list[list[Event]] = [[] for _ in range(WEEKS)]
    for e in data.events:
        w = _week(e.at, data.now)
        if w is not None:
            buckets[w].append(e)
    weeks = [lesson_facts(replace(data, events=tuple(b))) for b in buckets]

    readers = [set().union(*(lf.readers for lf in facts.values())) for facts in weeks]
    reading = [len(r) for r in readers]
    out: dict[str, Any] = {"reading": {"value": reading[-1], "history": reading}}
    if len(set().union(*readers)) < floor:
        out["landing"] = {"value": 0, "history": []}
        out["cleared"] = {"value": 0, "history": []}
        return out

    landing: list[Optional[int]] = []
    for facts in weeks:
        pages = [pf for lf in facts.values() for pf in lf.pages.values() if pf.readers and len(pf.readers) >= floor]
        lands = sum(1 for pf in pages if len(pf.helped & pf.readers) / len(pf.readers) < LANDS_BELOW)
        landing.append(round(100 * lands / len(pages)) if pages else None)

    tries: list[list] = [[] for _ in range(WEEKS)]
    for t in first_tries(data):
        if t.source != "checkpoint":
            continue
        w = _week(t.at, data.now)
        if w is not None:
            tries[w].append(t)
    cleared: list[Optional[int]] = [
        round(100 * sum(1 for t in ts if t.correct) / len(ts)) if ts and len({t.user_id for t in ts}) >= floor else None
        for ts in tries
    ]

    out["landing"] = {"value": landing[-1], "history": landing}
    out["cleared"] = {"value": cleared[-1], "history": cleared}
    return out
