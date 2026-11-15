"""Synthetic persona study for the owner's view ("How it's landing"), thesis chapter 5.

What this is: a test of the analytics machinery, not of learners. Five scripted reader
personas write the same eight event types the v4 reader writes, into one Space with one
30-page Lesson, and the real engine turns them into the owner's payload through the same
call the API makes (`v4_landing_service.landing_from(SpaceData, lang)`). No HTTP, no
database, no model call: the themes model is stood in for exactly as the story tests
stand it in (`backend/tests/unit/test_landing_stories.py`). Nothing here claims anything
about students; it asks whether the aggregation separates the arms and whether the
five-person floor holds.

Pre-registration: EXPECTATIONS below were written before the first run (2026-11-09) and
are not edited afterwards; a mismatch is reported, not tuned away. Every arm is seeded.

Run from the repository root:

    .venv/bin/python -m backend.eval.persona_study --out docs/thesis/experiments/persona-study

It writes one JSON payload per arm, a findings table (RESULTS.md) and a copy of the
expectations, all free of personal data (member ids are `member-NN`).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

import backend.services.v4_landing_service as service
import backend.services.v4_reader_service as reader
from backend.services.insights.sources.space import Event, LessonRow, SpaceData

NOW = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)
OWNER = "owner-0000-0000"
LESSON = "l-persona"
PAGES = 30
#: The idea each check-in and checkpoint is anchored on (page → idea); five ideas over 30 pages.
IDEAS = {5: "keys", 10: "normal forms", 15: "joins", 20: "indexes", 25: "transactions"}
#: The pages the struggling persona struggles on; idea "normal forms" is anchored inside them.
HARD = range(8, 13)
#: What askers ask about, word for word varied, so the theme stub has something to echo.
QUESTIONS = [
    "Why does the BCNF split lose a dependency?",
    "What is the difference between 3NF and BCNF here?",
    "Which functional dependency breaks BCNF on this page?",
    "How do I find the candidate keys from these dependencies?",
    "Why is the decomposition on this page lossless?",
    "Does this table violate second normal form?",
]


def member(i: int) -> str:
    return f"member-{i:02d}"


# ── personas: each writes one person's events for one reading day ───────────

@dataclass
class Sitting:
    """One person reads the Lesson once, on one day, in one session."""
    who: str
    day: datetime
    rng: random.Random
    events: list[Event]
    clock: int = 0

    def at(self, seconds: int = 0) -> datetime:
        self.clock += max(1, seconds)
        return self.day + timedelta(seconds=self.clock)

    def view(self, page: int, seconds: float) -> None:
        secs = int(round(seconds))
        self.events.append(Event(self.who, "slide_view", {
            "lectureId": LESSON, "page": page, "duration_seconds": secs, "sessionId": f"{self.who}-s",
        }, self.at(secs)))

    def rate(self, page: int, rating: str) -> None:
        idea = IDEAS.get(page)
        data = {"lectureId": LESSON, "page": page, "rating": rating, **({"idea": idea} if idea else {})}
        self.events.append(Event(self.who, "confidence_rating", data, self.at(2)))

    def help(self, page: int, kind: str, text: str = "") -> None:
        data = {"lectureId": LESSON, "page": page, "kind": kind, "query": text}
        self.events.append(Event(self.who, "ai_tutor_query", data, self.at(5)))

    def back(self, frm: int, to: int) -> None:
        self.events.append(Event(self.who, "slide_back_navigation",
                                 {"lectureId": LESSON, "fromPage": frm, "toPage": to}, self.at(1)))

    def checkpoint(self, page: int, correct: bool) -> None:
        self.events.append(Event(self.who, "checkpoint_attempt", {
            "lectureId": LESSON, "page": page, "idea": IDEAS[page], "kind": "choice",
            "questionId": 1, "correct": correct,
        }, self.at(20)))


def noisy(rng: random.Random, mean: float, sd: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, rng.gauss(mean, sd)))


def steady(s: Sitting) -> None:
    """Reads every page 20–60 s, no help, says 'got it' at every idea, clears every checkpoint."""
    for p in range(1, PAGES + 1):
        s.view(p, noisy(s.rng, 40, 10, 20, 60))
        if p in IDEAS:
            s.rate(p, "got_it")
            s.checkpoint(p, True)


def struggling(s: Sitting) -> None:
    """Pages 8–12 take three times as long, with Explain and Ask on them; 'confused' at the idea
    anchored there, first checkpoint try wrong; turns back from 13 to 12 twice."""
    for p in range(1, PAGES + 1):
        base = noisy(s.rng, 40, 10, 20, 60)
        s.view(p, base * 3 if p in HARD else base)
        if p in HARD:
            s.help(p, "explain")
            if s.rng.random() < 0.7:
                s.help(p, "ask", s.rng.choice(QUESTIONS))
        if p in IDEAS:
            if p in HARD:
                s.rate(p, "confused")
                s.checkpoint(p, False)
            else:
                s.rate(p, s.rng.choice(["got_it", "got_it", "unsure"]))
                s.checkpoint(p, s.rng.random() < 0.8)
        if p == 13:
            for _ in range(2):
                s.back(13, 12)
                s.view(12, noisy(s.rng, 50, 15, 20, 90))


def asker(s: Sitting) -> None:
    """Normal dwell; asks on every third page, always about normal forms; otherwise steady."""
    for p in range(1, PAGES + 1):
        s.view(p, noisy(s.rng, 40, 10, 20, 60))
        if p % 3 == 0:
            s.help(p, "ask", s.rng.choice(QUESTIONS))
        if p in IDEAS:
            s.rate(p, "got_it" if p != 10 else "unsure")
            s.checkpoint(p, s.rng.random() < 0.85)


def skimmer(s: Sitting) -> None:
    """Glances at pages 1–10 for under five seconds each, no help, no check-ins, stops at 10."""
    for p in range(1, 11):
        s.view(p, noisy(s.rng, 2.5, 1.0, 1, 4.5))


def overconfident(s: Sitting) -> None:
    """Reads normally, says 'got it' everywhere, misses the checkpoint anchored in pages 8–12."""
    for p in range(1, PAGES + 1):
        s.view(p, noisy(s.rng, 35, 8, 20, 60))
        if p in IDEAS:
            s.rate(p, "got_it")
            s.checkpoint(p, False if p in HARD else True)


def confused_asker(s: Sitting) -> None:
    """POST HOC (added after the first run, see RESULTS): asks on pages 8-12 and says 'confused'
    at the idea anchored on page 10, so the page is a hotspot and its askers are its readers."""
    for p in range(1, PAGES + 1):
        s.view(p, noisy(s.rng, 40, 10, 20, 60))
        if p in HARD:
            s.help(p, "ask", s.rng.choice(QUESTIONS))
        if p in IDEAS:
            s.rate(p, "confused" if p == 10 else "got_it")
            s.checkpoint(p, p != 10)


PERSONAS: dict[str, Callable[[Sitting], None]] = {
    "steady": steady, "struggling": struggling, "asker": asker, "skimmer": skimmer, "overconfident": overconfident,
    "confused_asker": confused_asker,
}


# ── arms: who is in the Space ────────────────────────────────────────────────

@dataclass(frozen=True)
class Arm:
    name: str
    mix: dict[str, int]
    why: str
    #: True: everyone reads within the last seven days (the figures' current week).
    recent: bool = False
    #: True: added after the first run; its expectation is in POST_HOC_EXPECTATIONS, not EXPECTATIONS.
    post_hoc: bool = False


ARMS = [
    Arm("A-strugglers-above-floor", {"struggling": 6, "steady": 6},
        "six people struggle on pages 8-12: the hard pages must light up"),
    Arm("B-strugglers-under-floor", {"struggling": 3, "steady": 10},
        "three struggle: nothing may be said about them, the Lesson reads calm"),
    Arm("C-five-askers", {"asker": 5, "steady": 5},
        "five askers who read the page: themes may be made"),
    Arm("D-four-askers", {"asker": 4, "steady": 6},
        "four askers: no themes, whatever else is found"),
    Arm("E-skimmers", {"skimmer": 8, "steady": 4},
        "eight skim and stop at page 10: skipped pages and a leak after 10"),
    Arm("F-overconfident", {"overconfident": 6, "steady": 4},
        "six say 'got it' and miss the checkpoint at page 10: a calibration gap"),
    Arm("G-control-four-members", {"struggling": 2, "steady": 1, "asker": 1},
        "four members in all: under the floor, everything null"),
    Arm("H-everyone", {"steady": 6, "struggling": 6, "asker": 5, "skimmer": 5, "overconfident": 5},
        "a realistic mix of 27: what rises to the top"),
    # Added after the first run of 2026-11-09 (post hoc, labelled as such in RESULTS):
    Arm("I-everyone-this-week", {"steady": 6, "struggling": 6, "asker": 5, "skimmer": 5, "overconfident": 5},
        "the same 27, all reading in the last seven days: the weekly figures get a week with five readers",
        recent=True, post_hoc=True),
    Arm("J-five-confused-askers", {"confused_asker": 5, "steady": 5},
        "five askers who are also confused on page 10: a hotspot with five askers, so themes can be made",
        post_hoc=True),
]

#: Written after the first run, for the two post-hoc arms only.
POST_HOC_EXPECTATIONS: dict[str, dict[str, list[str]]] = {
    "figures_null": {"must": [], "must_not": ["I-everyone-this-week"]},
    "themes": {"must": ["J-five-confused-askers"], "must_not": []},
    "confusion_hotspot": {"must": ["J-five-confused-askers"], "must_not": []},
}

#: Written before the first run. kind → (arms where it must appear, arms where it must not).
EXPECTATIONS: dict[str, dict[str, list[str]]] = {
    "confusion_hotspot": {"must": ["A-strugglers-above-floor"], "must_not": ["B-strugglers-under-floor", "G-control-four-members", "E-skimmers"]},
    "confusion_block": {"must": [], "must_not": ["G-control-four-members"]},  # pages 8-12 in A if five raters per page; ratings are per idea, so uncertain
    "speed_bump": {"must": [], "must_not": ["G-control-four-members"]},  # page 12 in A: needs >= 2 returners and dwell 1.3x median with confusion <= 30; the strugglers also rate confused, so uncertain
    "leaky_bucket": {"must": ["E-skimmers"], "must_not": ["G-control-four-members"]},
    "skipped_slide": {"must": ["E-skimmers"], "must_not": ["A-strugglers-above-floor", "G-control-four-members"]},
    "calibration_gap": {"must": ["F-overconfident"], "must_not": ["A-strugglers-above-floor", "G-control-four-members"]},
    "themes": {"must": ["C-five-askers"], "must_not": ["D-four-askers", "G-control-four-members"]},
    "figures_null": {"must": ["G-control-four-members"], "must_not": ["A-strugglers-above-floor", "H-everyone"]},
    "reach_few": {"must": ["G-control-four-members"], "must_not": ["A-strugglers-above-floor"]},
    "quiet_about_B": {"must": ["B-strugglers-under-floor"], "must_not": []},  # no finding names a page in 8-12
}


def build(arm: Arm, seed: int) -> SpaceData:
    rng = random.Random(seed)
    events: list[Event] = []
    i = 0
    for persona, n in arm.mix.items():
        for _ in range(n):
            who = member(i)
            i += 1
            # Each person reads on one day somewhere in the last eight weeks (not today).
            days = rng.randint(1, 6) if arm.recent else rng.randint(1, 55)
            day = NOW - timedelta(days=days, hours=rng.randint(0, 10))
            s = Sitting(who, day, random.Random(rng.random()), events)
            PERSONAS[persona](s)
    members = frozenset(member(k) for k in range(i))
    return SpaceData(
        space_id=f"space-{arm.name}", name=f"Persona study {arm.name}", owner_id=OWNER,
        members=members, lessons=(LessonRow(LESSON, "Normalization", 1, PAGES),),
        events=tuple(sorted(events, key=lambda e: e.at)), slide_pages={}, question_pages={}, now=NOW,
    )


# ── the model and its cache, stood in for ───────────────────────────────────

def stub_model_and_cache() -> list[str]:
    prompts: list[str] = []

    async def no_cache(key, view, compute, **kw):
        return await compute()

    async def model(prompt, **kw):
        prompts.append(prompt)
        return {"themes": ["Why a BCNF split can lose a dependency", "Telling 3NF from BCNF"]}

    service.analytics_cache.get_or_compute_async = no_cache  # type: ignore[attr-defined]
    reader._generate_json = model  # type: ignore[attr-defined]
    return prompts


# ── reporting ───────────────────────────────────────────────────────────────

def pages_in(insight: dict[str, Any]) -> list[int]:
    if "first" in insight and "last" in insight:
        return list(range(int(insight["first"]), int(insight["last"]) + 1))
    return [int(insight["page"])] if insight.get("page") is not None else []


def summarise(arm: Arm, body: dict[str, Any], prompts_before: int, prompts_after: int) -> dict[str, Any]:
    kinds = sorted({i["kind"] for i in body["insights"]})
    return {
        "arm": arm.name,
        "members": body["members"],
        "reach": body["reach"],
        "figures": {k: body["figures"][k]["value"] for k in ("reading", "landing", "cleared")},
        "figure_weeks_with_value": {k: sum(1 for v in body["figures"][k]["history"] if v is not None)
                                    for k in ("reading", "landing", "cleared")},
        "lights": [lesson["light"] for lesson in body["lessons"]],
        "kinds": kinds,
        "findings": [
            {"kind": i["kind"], "pages": pages_in(i), "band": i.get("band"), "severity": i.get("severity")}
            for i in body["insights"]
        ],
        "themes": [{"page": t["page"], "askers": t["askers"], "themes": t["themes"]} for t in body["themes"]],
        "model_calls": prompts_after - prompts_before,
    }


def check(summary: dict[str, Any]) -> dict[str, str]:
    """Each expectation that names this arm: 'ok' or 'MISS <what happened>'."""
    out: dict[str, str] = {}
    arm = summary["arm"]
    present = set(summary["kinds"])
    if summary["themes"]:
        present.add("themes")
    if summary["figures"]["landing"] is None and summary["figures"]["cleared"] is None:
        present.add("figures_null")
    if summary["reach"] == "few":
        present.add("reach_few")
    hard_pages = set(HARD)
    if not any(hard_pages & set(f["pages"]) for f in summary["findings"]):
        present.add("quiet_about_B")
    rules = {**EXPECTATIONS}
    for kind, rule in POST_HOC_EXPECTATIONS.items():
        rules[kind] = {"must": rules.get(kind, {}).get("must", []) + rule["must"],
                       "must_not": rules.get(kind, {}).get("must_not", []) + rule["must_not"]}
    for kind, rule in rules.items():
        if arm in rule["must"]:
            out[kind] = "ok" if kind in present else f"MISS expected {kind}, not found"
        elif arm in rule["must_not"]:
            out[kind] = "ok" if kind not in present else f"MISS {kind} found, expected absent"
    return out


def table(rows: list[dict[str, Any]]) -> str:
    lines = ["| Arm | Members | Reach | Figures (reading / landing / cleared) | Findings (kind: pages) | Themes | Expectations |",
             "|---|---|---|---|---|---|---|"]
    for r in rows:
        f = r["figures"]
        findings = "; ".join(f"{x['kind']}: {x['pages'][0]}" + (f"–{x['pages'][-1]}" if len(x['pages']) > 1 else "")
                             for x in r["findings"]) or "none"
        themes = "; ".join(f"p{t['page']} ({t['askers']} askers)" for t in r["themes"]) or "none"
        checks = ", ".join(f"{k}: {v}" for k, v in r["checks"].items()) or "none named"
        w = r["figure_weeks_with_value"]
        figs = f"{f['reading']} / {f['landing']} / {f['cleared']} (weeks with a value: {w['reading']}/{w['landing']}/{w['cleared']} of 8)"
        lines.append(f"| {r['arm']} | {r['members']} | {r['reach']} | {figs} | {findings} | {themes} | {checks} |")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", default="docs/thesis/experiments/persona-study", help="output folder")
    ap.add_argument("--seed", type=int, default=20261109)
    ap.add_argument("--lang", default="en")
    args = ap.parse_args()

    prompts = stub_model_and_cache()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, Any]] = []
    for k, arm in enumerate(ARMS):
        data = build(arm, args.seed + k)
        before = len(prompts)
        body = asyncio.run(service.landing_from(data, args.lang))
        summary = summarise(arm, body, before, len(prompts))
        summary["checks"] = check(summary)
        summary["why"] = arm.why
        summary["events"] = len(data.events)
        rows.append(summary)
        (out / f"{arm.name}.json").write_text(json.dumps(body, indent=1, ensure_ascii=False) + "\n")
        (out / f"{arm.name}.summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False) + "\n")

    misses = sum(1 for r in rows for v in r["checks"].values() if v != "ok")
    total = sum(len(r["checks"]) for r in rows)
    head = (
        f"# Persona study run, {NOW.date()} (seed {args.seed})\n\n"
        f"Engine: `v4_landing_service.landing_from` at the working tree's revision; themes model stood in for "
        f"(no model call left the machine). {len(ARMS)} arms, {sum(r['events'] for r in rows)} events in all. "
        f"Expectations met: {total - misses} of {total} (pre-registered and post-hoc together; "
        f"the table says which arm is post hoc).\n\n"
        "This tests the analytics machinery (does the aggregation separate the arms, does the floor hold), "
        "not learners; no claim about students follows from it.\n\n"
    )
    arms_md = "\n".join(
        f"- **{a.name}**{' (post hoc)' if a.post_hoc else ''}: {', '.join(f'{n} {p}' for p, n in a.mix.items())}. {a.why}."
        for a in ARMS
    )
    (out / "RESULTS.md").write_text(head + "## Arms\n\n" + arms_md + "\n\n## Findings per arm\n\n" + table(rows) + "\n")
    (out / "EXPECTATIONS.json").write_text(
        json.dumps({"pre_registered": EXPECTATIONS, "post_hoc": POST_HOC_EXPECTATIONS}, indent=1) + "\n"
    )
    print(head)
    print(table(rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
