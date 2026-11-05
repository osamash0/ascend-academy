"""Story tests for "How it's landing": plain situations, and what the owner's view must say.

Each test is one story from `docs/superpowers/specs/2026-11-05-landing-story-tests.md`.
They run at the highest pure level: `v4_landing_service.landing_from(SpaceData, lang)`,
the function that turns a Space's activity into the payload the door draws. No HTTP,
no database; only the model call (themes) and its cache are stood in for. Two stories
go one level down (`load_space_data` with a fake connection, `rank`), where the rule lives.

A story that fails today is a strict xfail naming the Plan 3 task that fixes it
(`docs/superpowers/plans/2026-11-05-how-its-landing-plan-3-door-in-v4.md`). When that
fix lands, the story passes, strict xfail turns the run red, and the marker comes off.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest

import backend.services.insights.sources.space as source
import backend.services.v4_landing_service as service
from backend.services.insights.landing_map import rank
from backend.services.insights.sources.space import Event, LessonRow, SpaceData

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=timezone.utc)
OWNER = "owner-0000-0000"
NORM, JOINS, TX = "l-normalization", "l-joins", "l-transactions"
#: The question member 0 asks on a hotspot, word for word.
ASKED = "Why does the BCNF split lose a dependency?"


# ── builders: people and what they did ──────────────────────────────────────

def member(i: int) -> str:
    """A member id that cannot occur by accident anywhere else in a payload."""
    return f"member-{i:02d}"


def at(days_ago: float, second: int = 0) -> datetime:
    return NOW - timedelta(days=days_ago) + timedelta(seconds=second)


def read(i, lesson, page, seconds=40, days_ago=1):
    return Event(member(i), "slide_view",
                 {"lectureId": lesson, "page": page, "duration_seconds": seconds, "sessionId": f"s{i}-{days_ago}"},
                 at(days_ago))


def reads(people, lesson, pages, seconds=40, days_ago=1):
    return [read(i, lesson, p, seconds, days_ago) for i in people for p in pages]


def rate(i, lesson, page, rating, idea=None, second=1):
    data = {"lectureId": lesson, "page": page, "rating": rating, **({"idea": idea} if idea else {})}
    return Event(member(i), "confidence_rating", data, at(1, second))


def ask(i, lesson, page, text, second=2):
    return Event(member(i), "ai_tutor_query", {"lectureId": lesson, "page": page, "kind": "ask", "query": text},
                 at(1, second))


def back(i, lesson, frm, to, second=3):
    return Event(member(i), "slide_back_navigation", {"lectureId": lesson, "fromPage": frm, "toPage": to},
                 at(1, second))


def practice(i, lesson, question, correct, second=4):
    return Event(member(i), "quiz_attempt", {"lectureId": lesson, "questionId": question, "correct": correct},
                 at(1, second))


def checkpoint(i, lesson, page, idea, question, correct, second=5):
    return Event(member(i), "checkpoint_attempt",
                 {"lectureId": lesson, "page": page, "idea": idea, "kind": "choice",
                  "questionId": question, "correct": correct},
                 at(1, second))


def hotspot(people, lesson, page, askers=7, foggy=8):
    """Everyone in `people` says how `page` read: the first `foggy` confused, the rest clicked;
    the first `askers` also ask about it (member 0 asks `ASKED`)."""
    people = list(people)
    out = [rate(i, lesson, page, "confused" if k < foggy else "got_it") for k, i in enumerate(people)]
    out += [ask(i, lesson, page, ASKED if k == 0 else f"{ASKED} ({k})", second=10 + k)
            for k, i in enumerate(people[:askers])]
    return out


def space(lessons, events, question_pages=None):
    return SpaceData(
        space_id="space-0000", name="Database Systems", owner_id=OWNER,
        members=frozenset(member(i) for i in range(40)),
        lessons=tuple(lessons), events=tuple(sorted(events, key=lambda e: e.at)),
        slide_pages={}, question_pages=question_pages or {}, now=NOW,
    )


def lesson(lesson_id, pages, order=1, title=None):
    return LessonRow(lesson_id, title or lesson_id, order, pages)


def kinds(body, kind):
    return [i for i in body["insights"] if i["kind"] == kind]


def entry(body, lesson_id):
    return next(lesson for lesson in body["lessons"] if lesson["id"] == lesson_id)


# ── the door, with the model and its cache stood in for ─────────────────────

@pytest.fixture
def door(monkeypatch):
    """`door.look(data)` is the payload; `door.prompts` what the model was sent;
    `door.reply` what it answers (a list of themes, or a function of the prompt)."""
    import backend.services.v4_reader_service as reader

    class Door:
        prompts: list[str] = []
        reply = ["Why a split can lose a dependency"]
        cache: dict | None = None  # None: nothing is kept between looks

        def look(self, data, lang="en"):
            return asyncio.run(service.landing_from(data, lang))

    d = Door()
    d.prompts = []

    async def cached(key, view, compute, **kw):
        if d.cache is None:
            return await compute()
        k = (key, view, json.dumps(kw.get("params"), sort_keys=True))
        if k not in d.cache:
            d.cache[k] = await compute()
        return d.cache[k]

    async def model(prompt, **kw):
        d.prompts.append(prompt)
        return {"themes": d.reply(prompt) if callable(d.reply) else list(d.reply)}

    monkeypatch.setattr(service.analytics_cache, "get_or_compute_async", cached)
    monkeypatch.setattr(reader, "_generate_json", model)
    return d


# ═══ Floors and privacy ═════════════════════════════════════════════════════

def test_four_people_reading_closely_get_lunas_floor_line_and_nothing_else(door):
    """Four people read Normalization, all foggy on page 3 and most asking: Luna's floor line, no map, no figures."""
    four = range(4)
    data = space([lesson(NORM, 4)], reads(four, NORM, [1, 2, 3, 4]) + hotspot(four, NORM, 3, askers=4, foggy=4))
    body = door.look(data)
    assert (body["readers"], body["floor"]) == (4, 5)
    assert body["insights"] == [] and body["themes"] == [] and door.prompts == []
    assert [lesson["light"] for lesson in body["lessons"]] == ["few"]
    assert all("help" not in lesson for lesson in body["lessons"])
    assert body["figures"]["landing"] == {"value": None, "history": []}
    assert body["figures"]["cleared"] == {"value": None, "history": []}


def test_a_lesson_three_people_read_says_nothing_while_its_neighbour_speaks(door):
    """Ten read Normalization (a hotspot on page 3); three read Joins, all foggy: Joins gets no light, no help, no finding."""
    data = space(
        [lesson(NORM, 4), lesson(JOINS, 6, order=2)],
        reads(range(10), NORM, [1, 2, 3, 4]) + hotspot(range(10), NORM, 3)
        + reads(range(3), JOINS, [1, 2]) + [rate(i, JOINS, 1, "confused") for i in range(3)],
    )
    body = door.look(data)
    assert kinds(body, "confusion_hotspot") and "help" in entry(body, NORM)
    joins = entry(body, JOINS)
    assert joins["light"] == "few" and "help" not in joins
    assert all(i["lessonId"] != JOINS for i in body["insights"])


@pytest.mark.xfail(strict=True, reason="lessons[].readers is still on the wire (3 for Joins) — Plan 3 Task 14")
def test_a_lesson_three_people_read_does_not_say_how_many_read_it(door):
    """Three people read Joins: the owner is not told it was three (in a small group, that is who)."""
    data = space(
        [lesson(NORM, 4), lesson(JOINS, 6, order=2)],
        reads(range(10), NORM, [1, 2, 3, 4]) + reads(range(3), JOINS, [1, 2]),
    )
    assert "readers" not in entry(door.look(data), JOINS)


def test_a_page_four_people_reached_says_nothing_even_if_all_four_were_foggy(door):
    """Ten read pages 1 to 4; four go on to page 5, all confused and all asking: nothing is said about page 5."""
    data = space(
        [lesson(NORM, 5)],
        reads(range(10), NORM, [1, 2, 3, 4]) + reads(range(4), NORM, [5]) + hotspot(range(4), NORM, 5, askers=4, foggy=4),
    )
    body = door.look(data)
    assert all(5 not in (i.get("page"), i.get("last")) for i in body["insights"])
    assert body["themes"] == [] and door.prompts == []


@pytest.mark.xfail(strict=True, reason="help_share() returns 0.0 under the page floor, the same value as a landing page "
                                       "— not in Plan 3")
def test_one_member_opening_page_one_does_not_make_pages_four_people_read_look_like_landing(door):
    """Four read all of Normalization, all foggy on page 3; a fifth opens only page 1. Pages 2 to 4 still say nothing (null), never 'landing' (0)."""
    four = range(4)
    data = space(
        [lesson(NORM, 4)],
        reads(four, NORM, [1, 2, 3, 4]) + hotspot(four, NORM, 3, askers=4, foggy=4) + reads([4], NORM, [1]),
    )
    norm = entry(door.look(data), NORM)
    assert norm["help"][0] == 0.0  # five read page 1 and nobody needed it: that is landing
    assert norm["help"][1:] == [None, None, None]


def test_the_owners_own_reading_is_never_read(monkeypatch):
    """The owner is enrolled in their own Space (their rows say so) and reads every page: only members' events are asked for."""
    calls: dict[str, tuple] = {}

    class Conn:
        async def fetch(self, sql, *args):
            if sql is source._MEMBERS_SQL:
                return [{"user_id": OWNER}] + [{"user_id": member(i)} for i in range(6)]
            if sql is source._LESSONS_SQL:
                return [{"id": NORM, "title": "Normalization", "pages": 4}]
            if sql is source._EVENTS_SQL:
                calls["events"] = args
            return []

    class Ctx:
        async def __aenter__(self):
            return Conn()

        async def __aexit__(self, *exc):
            return False

    async def connect():
        return Ctx()

    monkeypatch.setattr(source, "get_db_connection", connect)
    data = asyncio.run(source.load_space_data("space-0000", "Database Systems", OWNER, now=NOW))
    assert OWNER not in data.members and len(data.members) == 6
    who = calls["events"][3]
    assert OWNER not in who and sorted(who) == sorted(member(i) for i in range(6))


def test_nothing_the_owner_is_sent_names_a_member_or_quotes_a_question(door):
    """Seven people ask on a hotspot and the model echoes one of them word for word: the owner gets a theme, no question, no id."""
    door.reply = [ASKED, "Why a split can lose a dependency"]
    data = space([lesson(NORM, 4)], reads(range(10), NORM, [1, 2, 3, 4]) + hotspot(range(10), NORM, 3))
    body = door.look(data)
    assert body["themes"] == [{"lessonId": NORM, "page": 3, "askers": 7, "themes": ["Why a split can lose a dependency"]}]
    sent = json.dumps(body)
    assert ASKED not in sent and "BCNF" not in sent
    assert "member-" not in sent and OWNER not in sent


def test_read_easily_is_never_said_when_no_one_said_how_the_page_read(door):
    """Six read page 3 and five of them missed its question, but nobody said how it read: no 'it read easily, yet…' finding."""
    six = range(6)
    data = space(
        [lesson(NORM, 4)],
        reads(six, NORM, [1, 2, 3, 4]) + [practice(i, NORM, "q3", i == 0) for i in six],
        question_pages={"q3": 3},
    )
    assert kinds(door.look(data), "quiz_misalignment") == []


# ═══ Counting people ════════════════════════════════════════════════════════

def test_one_member_answering_ten_questions_does_not_outweigh_four_who_missed_one(door):
    """Five said page 3 left them unsure; one gets ten questions right, four miss their one: 20% passed (people), so it is a finding."""
    ten = range(10)
    tries = [practice(0, NORM, f"q{k}", True, second=20 + k) for k in range(1, 11)]
    tries += [practice(i, NORM, "q11", False, second=40 + i) for i in range(1, 5)]
    data = space(
        [lesson(NORM, 4)],
        reads(ten, NORM, [1, 2, 3, 4]) + [rate(i, NORM, 3, "unsure") for i in range(5)] + tries,
        question_pages={f"q{k}": 3 for k in range(1, 12)},
    )
    found = kinds(door.look(data), "quiz_misalignment")
    assert [(i["page"], i["metrics"]) for i in found] == [(3, {"pct": 20})]


def test_cleared_counts_each_person_once_however_many_questions_they_answered(door):
    """One member clears ten checkpoint questions, four miss their one: cleared is 20%, not 71%."""
    tries = [checkpoint(0, NORM, 4, "Keys", q, True, second=20 + q) for q in range(1, 11)]
    tries += [checkpoint(i, NORM, 4, "Keys", 1, False, second=40 + i) for i in range(1, 5)]
    data = space([lesson(NORM, 4)], reads(range(6), NORM, [1, 2, 3, 4]) + tries)
    assert door.look(data)["figures"]["cleared"]["value"] == 20


def test_one_person_turning_back_twelve_times_is_no_speed_bump_three_people_are(door):
    """Page 2 holds people long; one reader turns back to it from page 3 twelve times: no finding. Three readers once each: a speed bump."""
    ten = range(10)
    base = reads(ten, NORM, [1, 3, 4]) + reads(ten, NORM, [2], seconds=80)
    one = space([lesson(NORM, 4)], base + [back(0, NORM, 3, 2, second=s) for s in range(12)])
    three = space([lesson(NORM, 4)], base + [back(i, NORM, 3, 2) for i in range(3)])
    assert kinds(door.look(one), "speed_bump") == []
    assert [(i["page"], i["metrics"]) for i in kinds(door.look(three), "speed_bump")] == [(2, {"backs": 3})]


# ═══ Drop-off and skipping ══════════════════════════════════════════════════

def test_six_readers_who_all_stop_after_page_three_of_thirty_are_a_drop_off(door):
    """Six read pages 1 to 3 of a 30-page Lesson and nobody reads on: a drop-off finding after page 3, never 'calm'."""
    data = space([lesson(NORM, 30)], reads(range(6), NORM, [1, 2, 3]))
    body = door.look(data)
    assert [i["page"] for i in kinds(body, "leaky_bucket")] == [3]
    assert entry(body, NORM)["light"] != "calm"


def test_a_skipped_page_does_not_hide_a_real_drop_off_later(door):
    """Readers per page 10, 10, 10, 10, 3, 9, 9, 9, 6: page 5 was skipped, not left; the one drop-off is after page 8 (33%)."""
    counts = [10, 10, 10, 10, 3, 9, 9, 9, 6]
    events = [read(i, NORM, n) for n, c in enumerate(counts, start=1) for i in range(c)]
    found = kinds(door.look(space([lesson(NORM, 9)], events)), "leaky_bucket")
    assert [(i["page"], i["metrics"]) for i in found] == [(8, {"pct": 33})]


def test_a_page_most_people_skip_and_then_read_on_is_not_a_drop_off(door):
    """Ten read pages 1 to 3, only two open page 4, all ten read page 5: no drop-off finding."""
    counts = [10, 10, 10, 2, 10]
    events = [read(i, NORM, n) for n, c in enumerate(counts, start=1) for i in range(c)]
    assert kinds(door.look(space([lesson(NORM, 5)], events)), "leaky_bucket") == []


def test_one_member_jumping_to_the_last_page_does_not_hide_that_everyone_else_stopped(door):
    """Seven read pages 1 to 3 of 30; six stop there and one jumps to page 30: still a drop-off after page 3."""
    data = space([lesson(NORM, 30)], reads(range(7), NORM, [1, 2, 3]) + [read(6, NORM, 30)])
    assert [i["page"] for i in kinds(door.look(data), "leaky_bucket")] == [3]


# ═══ Ranking ════════════════════════════════════════════════════════════════

def _trap(people, missed, lesson_id=TX):
    """Everyone in `people` says page 2's idea clicked, then the first `missed` of them miss its checkpoint."""
    people = list(people)
    out = reads(people, lesson_id, [1, 2, 3, 4])
    out += [rate(i, lesson_id, 2, "got_it", idea="Isolation") for i in people]
    out += [checkpoint(i, lesson_id, 2, "Isolation", 1, k >= missed) for k, i in enumerate(people)]
    return out


def test_a_trap_leads_its_band_even_against_a_louder_hotspot_on_more_readers(door):
    """Six said Transactions p.2 clicked and all missed it; ten knew they were stuck on Normalization p.3: the door opens on the trap."""
    data = space(
        [lesson(TX, 4), lesson(NORM, 4, order=2)],
        _trap(range(10, 16), missed=6) + reads(range(10), NORM, [1, 2, 3, 4]) + hotspot(range(10), NORM, 3),
    )
    body = door.look(data)
    (trap,), (hot,) = kinds(body, "calibration_gap"), kinds(body, "confusion_hotspot")
    assert trap["attention"] == hot["attention"] == "act"
    assert body["insights"][0] == trap


def test_a_trap_never_jumps_a_band(door):
    """Five said Transactions p.2 clicked and three missed it (watch); Normalization p.3 needs the owner (act): the door opens on p.3."""
    data = space(
        [lesson(TX, 4), lesson(NORM, 4, order=2)],
        _trap(range(10, 15), missed=3) + reads(range(10), NORM, [1, 2, 3, 4]) + hotspot(range(10), NORM, 3),
    )
    body = door.look(data)
    (trap,), (hot,) = kinds(body, "calibration_gap"), kinds(body, "confusion_hotspot")
    assert (trap["attention"], hot["attention"]) == ("watch", "act")
    assert body["insights"][0] == hot


def test_a_question_that_tests_something_else_is_not_a_trap():
    """In one band, a page that read easily but whose question few passed does not jump a hotspot: nobody said it clicked."""
    hot = {"kind": "confusion_hotspot", "lessonId": NORM, "attention": "watch", "severity": 0.6}
    misaligned = {"kind": "quiz_misalignment", "lessonId": NORM, "attention": "watch", "severity": 0.5}
    assert rank([misaligned, hot], {NORM: 50}) == [hot, misaligned]


# ═══ Figures ════════════════════════════════════════════════════════════════

def test_a_week_fewer_than_five_people_read_is_a_dash_not_a_count(door):
    """Three people read in each of the last two weeks: no weekly count. Eight read last week, two this week: this week is a dash."""
    small = space([lesson(NORM, 4)], reads(range(3), NORM, [1], days_ago=1) + reads(range(3), NORM, [1], days_ago=8))
    assert door.look(small)["figures"]["reading"] == {"value": None, "history": [None] * 8}
    quiet = space([lesson(NORM, 4)], reads(range(8), NORM, [1], days_ago=8) + reads(range(2), NORM, [1], days_ago=1))
    reading = door.look(quiet)["figures"]["reading"]
    assert reading["value"] is None and reading["history"][6:] == [8, None]


def test_a_week_in_which_no_page_reached_five_readers_has_no_landing_figure(door):
    """Six members each read in a different week: past the Space's floor, never five on one page. Landing is a dash every week, not 0%."""
    data = space([lesson(NORM, 4)], [read(i, NORM, 1, days_ago=1 + 7 * i) for i in range(6)])
    assert door.look(data)["figures"]["landing"] == {"value": None, "history": [None] * 8}


# ═══ Themes ═════════════════════════════════════════════════════════════════

def test_themes_need_five_people_who_read_the_page_and_asked(door):
    """On a hotspot, four readers ask and a fifth person who never opened the page asks too: no themes, no model call."""
    ten = range(10)
    data = space(
        [lesson(NORM, 4)],
        reads(ten, NORM, [1, 2, 3, 4]) + hotspot(ten, NORM, 3, askers=4)
        + reads([15], NORM, [1]) + [ask(15, NORM, 3, "Why not?", second=30)],
    )
    body = door.look(data)
    assert kinds(body, "confusion_hotspot") and body["themes"] == [] and door.prompts == []


def test_an_ask_opened_and_left_empty_is_not_a_voice_in_the_themes(door):
    """Four readers ask in words and a fifth opens Ask and writes nothing: four is under the floor, so no themes, no model call."""
    ten = range(10)
    data = space(
        [lesson(NORM, 4)],
        reads(ten, NORM, [1, 2, 3, 4]) + hotspot(ten, NORM, 3, askers=4) + [ask(4, NORM, 3, "   ", second=30)],
    )
    body = door.look(data)
    assert kinds(body, "confusion_hotspot")
    assert body["themes"] == [] and door.prompts == []


@pytest.mark.xfail(strict=True, reason="clean_themes never checks a theme of under four words, so a planted name "
                                       "passes — Plan 3 Task 4f.2")
def test_a_name_planted_in_a_short_theme_never_reaches_the_owner(door):
    """Seven ask on a hotspot, one signs 'Anna here'; the model answers 'Anna's joins': no theme carries the name."""
    ten = range(10)
    asks = [ask(0, NORM, 3, "Anna here: why do my joins drop rows?", second=10)]
    asks += [ask(i, NORM, 3, f"Why do joins drop rows, case {i}?", second=10 + i) for i in range(1, 7)]
    data = space(
        [lesson(NORM, 4)],
        reads(ten, NORM, [1, 2, 3, 4]) + [rate(i, NORM, 3, "confused" if i < 8 else "got_it") for i in ten] + asks,
    )
    door.reply = ["Anna's joins", "Rows lost in a join"]
    (page,) = door.look(data)["themes"]
    assert page["themes"] and not any("anna" in t.casefold() for t in page["themes"])


@pytest.mark.xfail(strict=True, reason="the themes cache is keyed on the number of askers, not who they are — "
                                       "Plan 3 Task 4f.1")
def test_when_the_askers_change_the_owner_is_not_shown_themes_from_the_old_ones(door):
    """Five asked last month and got themes; one has aged out and someone new asked: still five, but the themes are made afresh."""
    ten = range(10)
    base = reads(ten, NORM, [1, 2, 3, 4]) + [rate(i, NORM, 3, "confused" if i < 8 else "got_it") for i in ten]
    before = [ask(i, NORM, 3, f"What is a candidate key, {i}?", second=10 + i) for i in range(5)]
    after = before[1:] + [ask(5, NORM, 3, "A new asker: why keep 2NF at all?", second=20)]
    door.cache = {}
    door.reply = lambda prompt: ["Why 2NF is kept"] if "new asker" in prompt else ["What a candidate key is"]
    assert door.look(space([lesson(NORM, 4)], base + before))["themes"][0]["themes"] == ["What a candidate key is"]
    assert door.look(space([lesson(NORM, 4)], base + after))["themes"][0]["themes"] == ["Why 2NF is kept"]
