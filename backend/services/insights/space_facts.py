"""What happened on each page of a Space, person by person, folded into facts.

Pure: takes the `SpaceData` the source read and returns, per Lesson and per
page, sets of people and lists of numbers. Every rule about *which* event
counts lives here, once:

- a sitting is one person's time on one page in one reading session, the
  session's reports added up (a phone tab reports when hidden, and again when
  left); a sitting over 30 minutes is a tab left open, not reading;
- a person's latest check-in on a page, or on an idea, is the one that counts;
- only the first try at a question counts — a practice question or one
  checkpoint question; replays and retries do not; the teach-back is not a try;
- the old reader names slides, not pages: its events are placed by slide.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional

from backend.services.insights.sources.space import Event, LessonRow, SpaceData

#: A sitting longer than this (30 min) is a tab left open, not reading (as `bundle._DWELL_OUTLIER_CEIL`).
DWELL_CEIL = 1800.0
#: A sitting shorter than this is a glance (the engine's "short view").
SHORT_VIEW = 4.0

_RATINGS = ("got_it", "unsure", "confused")


@dataclass(frozen=True)
class Try:
    user_id: str
    lesson_id: str
    page: int
    #: The checkpoint's idea; None for a practice question.
    idea: Optional[str]
    correct: bool
    at: datetime
    #: "practice" or "checkpoint".
    source: str


@dataclass
class PageFacts:
    readers: set[str] = field(default_factory=set)
    #: Seconds per sitting (one person, one session), each ≤ DWELL_CEIL.
    sittings: list[float] = field(default_factory=list)
    explain: set[str] = field(default_factory=set)
    ask: set[str] = field(default_factory=set)
    #: What was asked here, oldest first: for themes only, never sent to anyone.
    ask_texts: list[str] = field(default_factory=list)
    #: Each person's latest check-in on this page.
    ratings: dict[str, str] = field(default_factory=dict)
    returners: set[str] = field(default_factory=set)
    #: People who turned back to this page from the page right after it (people, not turns).
    from_next: set[str] = field(default_factory=set)
    tries: list[Try] = field(default_factory=list)
    #: Per person: (latest check-in on an idea anchored here, cleared every first try at its checkpoint).
    pairs: dict[str, tuple[str, bool]] = field(default_factory=dict)

    @property
    def helped(self) -> set[str]:
        """People who needed this page: opened Explain, asked, said foggy, or came back to it."""
        foggy = {u for u, r in self.ratings.items() if r in ("unsure", "confused")}
        return self.explain | self.ask | foggy | self.returners


@dataclass
class LessonFacts:
    lesson: LessonRow
    readers: set[str] = field(default_factory=set)
    pages: dict[int, PageFacts] = field(default_factory=dict)

    def page(self, n: int) -> PageFacts:
        return self.pages.setdefault(n, PageFacts())


def _page(value: Any) -> Optional[int]:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 1 else None


def page_of(event: Event, data: SpaceData, page_key: str = "page", slide_key: str = "slideId") -> Optional[int]:
    """The page an event is about: its own page, else the page of the slide it names."""
    d = event.data
    return _page(d.get(page_key)) or data.slide_pages.get(str(d.get(slide_key) or ""))


def first_tries(data: SpaceData) -> list[Try]:
    """The first try at every question, per person: practice questions and checkpoint questions."""
    seen: dict[tuple, Try] = {}
    for e in sorted(data.events, key=lambda e: e.at):
        d = e.data
        lesson = str(d.get("lectureId") or "")
        if e.type == "quiz_attempt":
            qid = str(d.get("questionId") or "")
            page = data.question_pages.get(qid) or page_of(e, data)
            key: tuple = (e.user_id, lesson, "q", qid)
            idea, source = None, "practice"
        elif e.type == "checkpoint_attempt" and d.get("kind") != "teach":
            page = _page(d.get("page"))
            idea = str(d.get("idea") or "")
            # A served checkpoint numbers its questions only 1 and 2, so the
            # number alone names no question: the page always goes in the key.
            question = d.get("questionId") if d.get("questionId") is not None else d.get("kind")
            key = (e.user_id, lesson, "c", idea, page, str(question))
            source = "checkpoint"
        else:
            continue
        if page is None or not lesson or key in seen:
            continue
        seen[key] = Try(e.user_id, lesson, page, idea, d.get("correct") is True, e.at, source)
    return list(seen.values())


def lesson_facts(data: SpaceData) -> dict[str, LessonFacts]:
    """Per Lesson, per page: who read it, for how long, who needed it, who tried what."""
    facts = {lesson.id: LessonFacts(lesson) for lesson in data.lessons}
    sittings: dict[tuple[str, str, str, int], float] = defaultdict(float)
    idea_ratings: dict[tuple[str, str, str], tuple[str, int]] = {}

    for e in sorted(data.events, key=lambda e: e.at):
        lf = facts.get(str(e.data.get("lectureId") or ""))
        if lf is None:
            continue
        d = e.data
        if e.type == "slide_view":
            page = page_of(e, data)
            secs = d.get("duration_seconds")
            if page is None or isinstance(secs, bool) or not isinstance(secs, (int, float)) or secs <= 0:
                continue
            lf.readers.add(e.user_id)
            lf.page(page).readers.add(e.user_id)
            sittings[(lf.lesson.id, e.user_id, str(d.get("sessionId") or ""), page)] += float(secs)
        elif e.type == "ai_tutor_query":
            page = page_of(e, data)
            if page is None:
                continue
            pf = lf.page(page)
            if d.get("kind") == "explain":
                pf.explain.add(e.user_id)
            else:
                pf.ask.add(e.user_id)
                text = str(d.get("query") or "").strip()
                if text:
                    pf.ask_texts.append(text)
        elif e.type == "confidence_rating":
            page = page_of(e, data)
            rating = d.get("rating")
            if page is None or rating not in _RATINGS:
                continue
            lf.page(page).ratings[e.user_id] = rating
            if d.get("idea"):
                idea_ratings[(lf.lesson.id, e.user_id, str(d["idea"]))] = (rating, page)
        elif e.type == "slide_back_navigation":
            to = page_of(e, data, "toPage", "toSlideId")
            if to is None:
                continue
            pf = lf.page(to)
            pf.returners.add(e.user_id)
            if page_of(e, data, "fromPage", "fromSlideId") == to + 1:
                pf.from_next.add(e.user_id)

    for (lesson_id, _user, _session, page), secs in sittings.items():
        if secs <= DWELL_CEIL:
            facts[lesson_id].page(page).sittings.append(secs)

    tries = first_tries(data)
    cleared: dict[tuple[str, str, str], list[bool]] = defaultdict(list)
    for t in tries:
        if t.lesson_id in facts:
            facts[t.lesson_id].page(t.page).tries.append(t)
        if t.source == "checkpoint":
            cleared[(t.lesson_id, t.user_id, t.idea or "")].append(t.correct)
    for (lesson_id, user, idea), (rating, page) in idea_ratings.items():
        results = cleared.get((lesson_id, user, idea))
        if results:
            facts[lesson_id].page(page).pairs[user] = (rating, all(results))
    return facts
