"""From engine findings to what the door is told (the `Landing` wire shape).

The engine speaks in its own metric names and in slides; the door's copy
(`v4Landing.json`) interpolates a few numbers per kind and says "page". This
is the one place that translates, and it adds no words: the backend sends
kinds and numbers only (spec B5). It never passes on a finding about people.
"""
from __future__ import annotations

from typing import Any, Optional

from backend.services.insights.space_engine import MIN_READERS, pages_of
from backend.services.insights.space_facts import LessonFacts, PageFacts

#: A page is fully lit when half its readers needed it (or it is the Space's most-needed page).
HELP_FULL = 0.5

_BAND = {"act": 2, "watch": 1, "calm": 0}

#: People said the page had clicked, then missed its checkpoint. Nobody asks about a page they
#: think they understood, so within a band these lead: the owner is the only one who can catch them.
TRAPS = frozenset({"calibration_gap", "silent_misleader"})

#: The kinds the door is told; any other finding maps to None. `silent_misleader` is not one:
#: its "then N% of them missed" is over clicked pairs, and with the people gate (`page_row`) it
#: fires only on fewer than five of them; five or more is a `calibration_gap`, honestly paired.
_KINDS = {
    "confusion_hotspot", "skipped_slide", "speed_bump", "overpacked",
    "leaky_bucket", "confusion_block", "quiz_misalignment", "calibration_gap", "healthy",
}


def help_share(f: PageFacts) -> Optional[float]:
    """Of the people who read this page, the share who needed it.

    None while fewer than `MIN_READERS` people read it: such a page says nothing, and
    nothing is not 0, which the door draws as landing (story 5; Abi, 2026-11-06)."""
    if len(f.readers) < MIN_READERS:
        return None
    return len(f.helped & f.readers) / len(f.readers)


def help_index(facts: dict[str, LessonFacts]) -> dict[str, list[Optional[float]]]:
    """Per Lesson, one value per page: its help share, normalised over the Space to 0–1, or
    None for a page fewer than `MIN_READERS` people read (the door draws it as an outline).

    As long as the Lesson has pages (else the highest page seen), so a page number
    beyond them never lengthens the list, and normalised over those shown pages only,
    so a page no one is shown never sets the scale."""
    shares: dict[str, list[Optional[float]]] = {}
    for lid, lf in facts.items():
        # The Lesson's own page count when it has one; else the highest page seen (never above MAX_PAGE).
        length = lf.lesson.pages if lf.lesson.pages > 0 else max(lf.pages, default=0)
        shares[lid] = [help_share(lf.pages.get(n, PageFacts())) for n in range(1, length + 1)]
    scale = max(HELP_FULL, max((v for s in shares.values() for v in s if v is not None), default=0.0))
    return {lid: [None if v is None else round(min(1.0, v / scale), 2) for v in s] for lid, s in shares.items()}


def grid(f: PageFacts) -> Optional[dict[str, Optional[int]]]:
    """Check-in against checkpoint, paired per reader (as `page_row` pairs them); only once
    the floor's worth of pairs exist. A cell of 1 to `MIN_READERS - 1` people is None: in a small
    cell the few people are findable, and a count beside it would say so. A cell of 0 names
    nobody and stays 0."""
    pairs = [pair for user, pair in f.pairs.items() if user in f.readers]
    if len(pairs) < MIN_READERS:
        return None
    g: dict[str, int] = {"clickedCleared": 0, "clickedMissed": 0, "foggyCleared": 0, "foggyMissed": 0}
    for rating, cleared in pairs:
        said = "clicked" if rating == "got_it" else "foggy"
        g[f"{said}{'Cleared' if cleared else 'Missed'}"] += 1
    return {cell: None if 0 < n < MIN_READERS else n for cell, n in g.items()}


def _pct(value: Any) -> int:
    return int(round(float(value or 0)))


def _metrics(kind: str, m: dict[str, Any], f: PageFacts) -> dict[str, float]:
    """The numbers a kind's copy reads. Every one is a share (floored by the page's people gate), a
    duration, a ratio or a page, or a count of people sent only from `MIN_READERS` up."""
    if kind == "confusion_hotspot":
        # The detector fires on the foggy share alone, so askers can be 0-4, and in a small group
        # "three asked" says who: the count is told only from `MIN_READERS` up, else only `foggy`.
        # Readers only, as `page_row` and `help_share` count: someone who asked without a counted read is no reader here.
        out = {"foggy": _pct(m.get("confusionRate"))}
        askers = len((f.explain | f.ask) & f.readers)
        if askers >= MIN_READERS:
            out = {"askers": askers, **out}
        return out
    if kind == "skipped_slide":
        return {"seconds": _pct(m.get("medianDwellSeconds"))}
    if kind == "speed_bump":
        return {"backs": int(m.get("backtracksFromNext") or 0)}
    if kind == "overpacked":
        base = float(m.get("lectureMedianDwellSeconds") or 0)
        return {"ratio": round(float(m.get("medianDwellSeconds") or 0) / base, 1) if base else 1.0}
    if kind == "leaky_bucket":
        return {"pct": _pct(m.get("attritionPct"))}
    if kind == "quiz_misalignment":
        return {"pct": _pct(m.get("quizSuccessRate"))}
    if kind == "calibration_gap":
        return {"pct": _pct(m.get("overconfidenceRate"))}
    return {}


def to_landing(insight: dict[str, Any], lf: LessonFacts) -> Optional[dict[str, Any]]:
    """One engine finding as a `LandingInsight`; None for anything the door must not say."""
    kind = insight.get("kind")
    pages = pages_of(insight)
    if kind not in _KINDS or not pages:
        return None
    if kind == "speed_bump" and int((insight.get("metrics") or {}).get("backtracksFromNext") or 0) < MIN_READERS:
        # "Three people turned back" says who in a small group; the detector may still fire on two.
        return None
    f = lf.pages.get(pages[0]) or PageFacts()
    out: dict[str, Any] = {
        "id": f"{lf.lesson.id}:{insight['id']}",
        "kind": kind,
        "attention": insight["attention"],
        "severity": insight["severity"],
        "lessonId": lf.lesson.id,
    }
    if kind == "confusion_block":
        out["first"], out["last"] = pages[0], pages[-1]
    else:
        out["page"] = pages[0]
    out["metrics"] = _metrics(kind, insight.get("metrics") or {}, f)
    if kind == "calibration_gap":
        g = grid(f)
        if g:
            out["grid"] = g
    return out


def collapse_healthy(found: list[dict[str, Any]], lesson_id: str) -> list[dict[str, Any]]:
    """The engine finds a calm page at a time; the door says a Lesson is landing
    once, and only when nothing in it wants the owner."""
    healthy = [i for i in found if i["kind"] == "healthy"]
    rest = [i for i in found if i["kind"] != "healthy"]
    if not healthy or any(i["attention"] != "calm" for i in rest):
        return rest
    top = max(healthy, key=lambda i: i["severity"])
    return rest + [{
        "id": f"{lesson_id}:healthy", "kind": "healthy", "attention": "calm",
        "severity": top["severity"], "lessonId": lesson_id, "metrics": {},
    }]


def lesson_light(found: list[dict[str, Any]], readers: int) -> str:
    """A Lesson's light: its loudest finding, or `few` while under the floor."""
    if readers < MIN_READERS:
        return "few"
    return max((i["attention"] for i in found), key=_BAND.__getitem__, default="calm")


def rank(insights: list[dict[str, Any]], readers_by_lesson: dict[str, int]) -> list[dict[str, Any]]:
    """Loudest first: by band, then traps before the rest, then by severity × the Lesson's
    readers, then severity. The door reads `insights[0]` as the one page to open."""
    return sorted(
        insights,
        key=lambda i: (
            _BAND[i["attention"]],
            i.get("kind") in TRAPS,
            i["severity"] * readers_by_lesson.get(i["lessonId"], 0),
            i["severity"],
        ),
        reverse=True,
    )
