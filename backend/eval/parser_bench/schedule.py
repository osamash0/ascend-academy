"""The duel schedule (spec "Duels"), fixed by a seed before the first vote.

Round 1: every pair of entrants (in an added comparison: every pair it schedules, see below) meets 3 times, on 3 pages of 3 different page types. Types and
pages are spread evenly (the least-used first, ties broken by the seeded generator), and the sides
are balanced per tool (each entrant is on the left within one duel of half its appearances). Every
entrant then appears 3·(n−1) times.

Hidden repeats: one in ten duels of the final schedule is a repeat, round(r1 / 9) of them, so 135
round-1 duels get 15 (150 in all) and 30 get 3 (33). A repeat shows a round-1 duel again with the
sides swapped, at least `repeat_gap(total)` duels after it and within the next third of the
schedule. The gap is 20, or a third of the schedule when that is shorter (33 duels: 11), so a small
comparison can still hide its repeats.

Round 2 (the stopping rule): after round 1, while the top entrant's 95% interval overlaps the
second's, the adjacent pairs among the top four get 3 more duels each, until the intervals
separate or 75 extra duels have been scheduled.

An added comparison (one that builds on finished ones, compare.create_pooled) schedules only the pairs with
at least one new entrant, under the same round-1 rule (the spec's "every pair 3× on 3 page types", for the
pairs with a new entrant only: Deviation 2). It may also name its opponents (Deviation 3): then a new entrant
meets the other new entrants and those earlier entrants only. pair_allowed() is that one rule. Its round 2
runs only while the overlapping top two are a pair it schedules, and then only for the adjacent top-4 pairs
it schedules: the other pairs were settled under their own comparison's stopping rule and cap.
"""
from __future__ import annotations

import random
from collections import Counter
from dataclasses import dataclass
from itertools import combinations
from typing import Any, Collection, Mapping, Sequence

PER_PAIR = 3
REPEAT_SHARE = 9      # repeats = round(round-1 duels / 9): one in ten of the final schedule
MAX_GAP = 20
ROUND2_CAP = 75
TOP = 4


@dataclass(frozen=True)
class SchedPage:
    key: str
    type: str


def repeat_gap(total: int) -> int:
    """How many duels must lie between a duel and its hidden repeat, for a schedule of `total` duels."""
    return min(MAX_GAP, total // 3)


def _place(a: str, b: str, pages: Sequence[SchedPage], rng: random.Random, page_use: Counter,
           type_use: Counter, tool_type: Counter) -> list[tuple[str, str]]:
    """Three (page key, type) slots for the pair a–b on three different types, least-used first."""
    by_type: dict[str, list[SchedPage]] = {}
    for p in pages:
        by_type.setdefault(p.type, []).append(p)
    if len(by_type) < PER_PAIR:
        raise ValueError(f"the pages cover {len(by_type)} page types; each pair needs {PER_PAIR} different ones")
    order = sorted(by_type, key=lambda t: (tool_type[a, t] + tool_type[b, t], type_use[t], rng.random()))
    slots = []
    for t in order[:PER_PAIR]:
        page = min(by_type[t], key=lambda p: (page_use[p.key], rng.random()))
        page_use[page.key] += 1
        type_use[t] += 1
        tool_type[a, t] += 1
        tool_type[b, t] += 1
        slots.append((page.key, t))
    return slots


def _pages(pages: Sequence[SchedPage]) -> list[SchedPage]:
    """The pages sorted by key, so the caller's order never changes a schedule; duplicate keys are refused."""
    keys = [p.key for p in pages]
    if len(set(keys)) != len(keys):
        raise ValueError("duplicate page keys")
    return sorted(pages, key=lambda p: p.key)


def _names(value: Collection[str], what: str) -> set[str]:
    """Method ids as a set; one string is refused (it would be read letter by letter)."""
    if isinstance(value, str):
        raise ValueError(f"{what} must be a collection of method ids, not one string")
    return set(value)


def pair_allowed(a: str, b: str, new: Collection[str] | None, opponents: Collection[str] | None) -> bool:
    """Whether an added comparison schedules the pair a–b. Without `new` every pair is scheduled. With it, a pair
    needs a new entrant; with `opponents` as well, the other member must be new too or one of the opponents."""
    if new is None:
        return True
    if a in new and b in new:
        return True
    if a not in new and b not in new:
        return False
    return opponents is None or (b if a in new else a) in opponents


def _opponents(opponents: Collection[str], fresh: set[str], names: Sequence[str]) -> set[str]:
    rivals = _names(opponents, "opponents")
    if not rivals:
        raise ValueError("opponents, when given, name at least one earlier entrant")
    unknown = sorted(rivals - set(names))
    if unknown:
        raise ValueError(f"opponents {unknown} are not among the entrants")
    both = sorted(rivals & fresh)
    if both:
        raise ValueError(f"opponents {both} are new entrants; opponents are earlier entrants")
    return rivals


def _duel(a: str, b: str, page: str, type_: str, round_: int) -> dict[str, Any]:
    """A duel without sides yet; `_balance_sides` sets them."""
    return {"duel": -1, "round": round_, "a": a, "b": b, "page": page, "type": type_,
            "left": None, "right": None, "repeat_of": None}


def _balance_sides(duels: Sequence[dict[str, Any]], rng: random.Random) -> None:
    """Set each duel's sides so every entrant is on the left within half a duel of half its appearances.
    The duels are the edges of a multigraph on the entrants. Walking unused edges from a vertex ends
    back at it whenever every remaining degree is even, so the walks cut the edges into closed trails,
    and a trail's direction gives each entrant as many duels on the left as on the right. A dummy vertex
    joined to the odd-degree entrants makes every degree even; its edges are then dropped, which is
    where the half comes from. The walk order is seeded."""
    counts = Counter(x for d in duels for x in (d["a"], d["b"]))
    names = sorted(counts)
    n = len(duels)
    edges = [(d["a"], d["b"]) for d in duels] + [(x, None) for x in names if counts[x] % 2]
    adj: dict = {v: [] for v in names + [None]}
    for i, (u, v) in enumerate(edges):
        adj[u].append(i)
        adj[v].append(i)
    for lst in adj.values():
        rng.shuffle(lst)
    used = [False] * len(edges)
    starts = list(adj)
    rng.shuffle(starts)
    for start in starts:
        cur = start
        while True:
            lst = adj[cur]
            while lst and used[lst[-1]]:
                lst.pop()
            if not lst:
                break
            i = lst.pop()
            used[i] = True
            u, v = edges[i]
            nxt = v if u == cur else u
            if i < n:
                duels[i]["left"], duels[i]["right"] = cur, nxt
            cur = nxt


def round1(entrants: Sequence[str], pages: Sequence[SchedPage], seed: int, *,
           new: Collection[str] | None = None, opponents: Collection[str] | None = None) -> list[dict[str, Any]]:
    """Round 1 with its hidden repeats, numbered 0.. in the order they are judged. With `new`, only the pairs
    that involve at least one of those entrants (an added comparison); with `opponents` too, only the pairs
    pair_allowed() accepts. Without either, every pair."""
    names = sorted(set(entrants))
    if len(names) < 2:
        raise ValueError("a comparison needs at least two entrants")
    pages = _pages(pages)
    rng = random.Random(seed)
    pairs = list(combinations(names, 2))
    if new is not None:
        fresh = _names(new, "new entrants")
        if not fresh:
            raise ValueError("an added comparison needs at least one new entrant")
        unknown = sorted(fresh - set(names))
        if unknown:
            raise ValueError(f"new entrants {unknown} are not among the entrants")
        rivals = None if opponents is None else _opponents(opponents, fresh, names)
        pairs = [(a, b) for a, b in pairs if pair_allowed(a, b, fresh, rivals)]
    elif opponents is not None:
        raise ValueError("opponents restrict an added comparison; name its new entrants too")
    rng.shuffle(pairs)
    page_use: Counter = Counter()
    type_use: Counter = Counter()
    tool_type: Counter = Counter()
    duels = []
    for a, b in pairs:
        for key, t in _place(a, b, pages, rng, page_use, type_use, tool_type):
            duels.append(_duel(a, b, key, t, 1))
    rng.shuffle(duels)
    _balance_sides(duels, rng)

    n_repeats = round(len(duels) / REPEAT_SHARE)
    gap = repeat_gap(len(duels) + n_repeats)
    eligible = duels[: len(duels) - gap]
    if n_repeats > len(eligible):
        raise ValueError(f"{len(duels)} duels are too few to hide {n_repeats} repeats {gap} duels apart")
    originals = rng.sample(eligible, n_repeats)
    final = list(duels)

    def position(duel: dict) -> int:
        return next(i for i, d in enumerate(final) if d is duel)

    for original in sorted(originals, key=position):
        at = position(original)
        repeat = dict(original, left=original["right"], right=original["left"], repeat_of=id(original))
        # Within the gap and the next third of the schedule. The originals are drawn from the first
        # len-gap duels, so the window is never empty; the append is the fallback the spec asks for.
        lo = at + gap
        hi = min(len(final), lo + len(final) // 3)
        final.insert(rng.randint(lo, hi) if lo <= hi else len(final), repeat)
    number = {id(d): i for i, d in enumerate(final)}
    for i, d in enumerate(final):
        d["duel"] = i
        if d["repeat_of"] is not None:
            d["repeat_of"] = number[d["repeat_of"]]
    return final


def needs_round2(ranking: Sequence[Mapping[str, Any]], *, new: Collection[str] | None = None,
                 opponents: Collection[str] | None = None) -> bool:
    """The stopping rule's question: does the top entrant's interval overlap the second's? `ranking` is
    sorted by points, best first, each row with "lo" and "hi" (unrounded: results._decision_rows). In an
    added comparison (`new` given) round 2 also needs the top two to be a pair it schedules (pair_allowed)."""
    if len(ranking) < 2 or ranking[0]["lo"] > ranking[1]["hi"]:
        return False
    if new is None:
        return True
    rivals = None if opponents is None else _names(opponents, "opponents")
    return pair_allowed(ranking[0]["entrant"], ranking[1]["entrant"], _names(new, "new entrants"), rivals)


def round2_batch(ranked: Sequence[str], pages: Sequence[SchedPage], existing: Sequence[Mapping[str, Any]],
                 seed: int, batch: int, room: int, *, only_with: Collection[str] | None = None,
                 opponents: Collection[str] | None = None) -> list[dict[str, Any]]:
    """The next round-2 duels: 3 for each adjacent pair among the top four (`ranked` best first), on
    three page types, numbered after `existing`; at most `room` of them (the 75-duel cap). With only_with
    (an added comparison's new entrants) and opponents, only the pairs pair_allowed() accepts."""
    fresh = rivals = None
    if only_with is not None:
        fresh = _names(only_with, "new entrants")
        if not fresh:
            raise ValueError("an added comparison needs at least one new entrant")
        rivals = None if opponents is None else _names(opponents, "opponents")
    elif opponents is not None:
        raise ValueError("opponents restrict an added comparison; name its new entrants too")
    pages = _pages(pages)
    rng = random.Random(seed * 1000 + batch)
    page_use: Counter = Counter(d["page"] for d in existing)
    type_use: Counter = Counter(d["type"] for d in existing)
    tool_type: Counter = Counter()
    for d in existing:
        tool_type[d["a"], d["type"]] += 1
        tool_type[d["b"], d["type"]] += 1
    top = list(ranked[:TOP])
    duels = []
    pairs = [(x, y) for x, y in zip(top, top[1:]) if pair_allowed(x, y, fresh, rivals)]
    for x, y in pairs:
        a, b = sorted((x, y))
        for key, t in _place(a, b, pages, rng, page_use, type_use, tool_type):
            duels.append(_duel(a, b, key, t, 2))
    rng.shuffle(duels)
    duels = duels[: max(0, room)]
    _balance_sides(duels, rng)
    for i, d in enumerate(duels, start=len(existing)):
        d["duel"] = i
    return duels
