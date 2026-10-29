"""The three figures, each with its last eight weeks (oldest first).

- reading: members who read anything that week (a count);
- landing: of the pages at least `floor` members read that week, the percent
  where fewer than one in five of them needed it (asked, opened Explain,
  said foggy, or came back to it);
- cleared: of the checkpoint questions members tried for the first time that
  week, the percent they got right, once at least `floor` people tried one.

A week is seven days back from now. Under the Space's floor only `reading` is
real; the other two are empty, and the door shows no figures (spec §5).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any, Optional

from backend.services.insights.sources.space import SpaceData
from backend.services.insights.space_facts import first_tries, page_of

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
    readers: list[set[str]] = [set() for _ in range(WEEKS)]
    page_readers: list[dict[tuple[str, int], set[str]]] = [defaultdict(set) for _ in range(WEEKS)]
    page_helped: list[dict[tuple[str, int], set[str]]] = [defaultdict(set) for _ in range(WEEKS)]

    for e in data.events:
        w = _week(e.at, data.now)
        if w is None:
            continue
        lesson = str(e.data.get("lectureId") or "")
        if e.type == "slide_view":
            p = page_of(e, data)
            if p is not None:
                readers[w].add(e.user_id)
                page_readers[w][(lesson, p)].add(e.user_id)
        elif e.type == "ai_tutor_query" or (
            e.type == "confidence_rating" and e.data.get("rating") in ("unsure", "confused")
        ):
            p = page_of(e, data)
            if p is not None:
                page_helped[w][(lesson, p)].add(e.user_id)
        elif e.type == "slide_back_navigation":
            p = page_of(e, data, "toPage", "toSlideId")
            if p is not None:
                page_helped[w][(lesson, p)].add(e.user_id)

    reading = [len(r) for r in readers]
    out: dict[str, Any] = {"reading": {"value": reading[-1], "history": reading}}
    if len(set().union(*readers)) < floor:
        out["landing"] = {"value": 0, "history": []}
        out["cleared"] = {"value": 0, "history": []}
        return out

    landing: list[int] = []
    for w in range(WEEKS):
        eligible = [k for k, who in page_readers[w].items() if len(who) >= floor]
        lands = sum(
            1 for k in eligible
            if len(page_helped[w][k] & page_readers[w][k]) / len(page_readers[w][k]) < LANDS_BELOW
        )
        landing.append(round(100 * lands / len(eligible)) if eligible else 0)

    tries: list[list] = [[] for _ in range(WEEKS)]
    for t in first_tries(data):
        if t.source != "checkpoint":
            continue
        w = _week(t.at, data.now)
        if w is not None:
            tries[w].append(t)
    cleared = [
        round(100 * sum(1 for t in ts if t.correct) / len(ts)) if len({t.user_id for t in ts}) >= floor else 0
        for ts in tries
    ]

    out["landing"] = {"value": landing[-1], "history": landing}
    out["cleared"] = {"value": cleared[-1], "history": cleared}
    return out
