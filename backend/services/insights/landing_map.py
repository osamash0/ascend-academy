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

_KINDS = {
    "confusion_hotspot", "silent_misleader", "skipped_slide", "speed_bump", "overpacked",
    "leaky_bucket", "confusion_block", "quiz_misalignment", "calibration_gap", "healthy",
}


def help_share(f: PageFacts) -> float:
    """Of the people who read this page, the share who needed it; 0 under the floor."""
    if len(f.readers) < MIN_READERS:
        return 0.0
    return len(f.helped & f.readers) / len(f.readers)


def help_index(facts: dict[str, LessonFacts]) -> dict[str, list[float]]:
    """Per Lesson, one 0–1 value per page: its help share, normalised over the Space.

    As long as the Lesson has pages (else the highest page seen), so a page number
    beyond them never lengthens the list, and normalised over those shown pages only,
    so a page no one is shown never sets the scale."""
    shares: dict[str, list[float]] = {}
    for lid, lf in facts.items():
        # The Lesson's own page count when it has one; else the highest page seen (never above MAX_PAGE).
        length = lf.lesson.pages if lf.lesson.pages > 0 else max(lf.pages, default=0)
        shares[lid] = [help_share(lf.pages[n]) if n in lf.pages else 0.0 for n in range(1, length + 1)]
    scale = max(HELP_FULL, max((v for s in shares.values() for v in s), default=0.0))
    return {lid: [round(min(1.0, v / scale), 2) for v in s] for lid, s in shares.items()}


def grid(f: PageFacts) -> Optional[dict[str, int]]:
    """Check-in against checkpoint, paired per reader (as `page_row` pairs them); only once
    the floor's worth of pairs exist."""
    pairs = [pair for user, pair in f.pairs.items() if user in f.readers]
    if len(pairs) < MIN_READERS:
        return None
    g = {"clickedCleared": 0, "clickedMissed": 0, "foggyCleared": 0, "foggyMissed": 0}
    for rating, cleared in pairs:
        said = "clicked" if rating == "got_it" else "foggy"
        g[f"{said}{'Cleared' if cleared else 'Missed'}"] += 1
    return g


def _pct(value: Any) -> int:
    return int(round(float(value or 0)))


def _metrics(kind: str, m: dict[str, Any], f: PageFacts, g: Optional[dict[str, int]]) -> dict[str, float]:
    if kind == "confusion_hotspot":
        # Readers only, as `page_row` and `help_share` count: someone who asked without a counted read is no reader here.
        return {"askers": len((f.explain | f.ask) & f.readers), "foggy": _pct(m.get("confusionRate"))}
    if kind == "silent_misleader" and g:
        # "of them": the clicked row of the grid the card carries (`to_landing` tells no trap without one).
        missed = 100 * g["clickedMissed"] / (g["clickedCleared"] + g["clickedMissed"])
        return {"clicked": _pct(m.get("gotItPct")), "missed": _pct(missed)}
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
    f = lf.pages.get(pages[0]) or PageFacts()
    g = grid(f) if kind in ("silent_misleader", "calibration_gap") else None
    if kind == "silent_misleader" and not (g and g["clickedCleared"] + g["clickedMissed"]):
        # Its "then N% of them missed" is about people who said clicked and then tried: no pairs, no "them".
        return None
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
    out["metrics"] = _metrics(kind, insight.get("metrics") or {}, f, g)
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
    """Loudest first: by band, then by severity × the Lesson's readers, then severity.
    The door reads `insights[0]` as the one page to open."""
    return sorted(
        insights,
        key=lambda i: (
            _BAND[i["attention"]],
            i["severity"] * readers_by_lesson.get(i["lessonId"], 0),
            i["severity"],
        ),
        reverse=True,
    )
