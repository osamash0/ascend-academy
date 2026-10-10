"""Deck Cartographer — deterministic deck structure before any LLM call.

The pipeline used to read the first 15 slides for lecture meta and the
first 10 for the quiz (constants inherited from v4 and never chosen). This
module computes structure for the WHOLE deck instead: boilerplate lines
repeated by the export template, a role for each slide, and section
boundaries. It is pure: no I/O, no network, deterministic for a given input.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from enum import Enum
from typing import Iterable

_WS = re.compile(r"\s+")
_DIGITS = re.compile(r"\d+")


def normalize_line(line: str) -> str:
    """Case-fold, collapse whitespace, and replace digit runs with '#', so
    'Seite 3 / 66' and 'Seite 41 / 66' count as the same template line."""
    return _DIGITS.sub("#", _WS.sub(" ", line).strip().lower())


def _lines(page: str) -> Iterable[str]:
    return (ln for ln in page.splitlines() if ln.strip())


def find_boilerplate(pages: list[str], min_share: float = 0.6, min_pages: int = 4) -> frozenset[str]:
    """Normalized lines present on at least ``min_share`` of pages.

    Each line is counted at most once per page. Decks shorter than
    ``min_pages`` have too little evidence, so they report nothing."""
    if len(pages) < min_pages:
        return frozenset()
    counts: Counter[str] = Counter()
    for page in pages:
        counts.update({normalize_line(ln) for ln in _lines(page)})
    threshold = min_share * len(pages)
    return frozenset(line for line, c in counts.items() if line and c >= threshold)


def strip_boilerplate(page: str, boilerplate: frozenset[str]) -> str:
    return "\n".join(ln for ln in _lines(page) if normalize_line(ln) not in boilerplate)


class SlideRole(str, Enum):
    TITLE = "title"
    AGENDA = "agenda"
    SECTION = "section"
    CONTENT = "content"
    EXERCISE = "exercise"
    SUMMARY = "summary"
    REFERENCES = "references"
    EMPTY = "empty"


# Matched against the slide's FIRST non-empty line only. Lecture decks here
# are German or English, so each pattern covers both.
_HEADING_ROLES: tuple[tuple[re.Pattern[str], SlideRole], ...] = (
    (re.compile(r"^(agenda|outline|overview|inhalt|gliederung|übersicht|kapitelübersicht)\b", re.I), SlideRole.AGENDA),
    (re.compile(r"^(übung|uebung|aufgabe|exercise|quiz|task)\b", re.I), SlideRole.EXERCISE),
    (re.compile(r"^(zusammenfassung|summary|fazit|recap|conclusion|takeaways?)\b", re.I), SlideRole.SUMMARY),
    (re.compile(r"^(literatur|references|quellen|bibliography|further reading)\b", re.I), SlideRole.REFERENCES),
)
_SECTION_MAX_WORDS = 6
# A short slide is a chapter divider only if it is numbered. Across 20 real
# decks every unnumbered short slide was a figure slide with just a title.
# A bare number ("10 Gbit Ethernet", "2024 Ergebnisse", "1 / 66") is a
# quantity or page counter, so the number needs a trailing dot ("2. X") or
# several levels ("3.1 X"). Components are capped at two digits so that
# "802.11 WLAN" does not read as chapter 802.11.
_SECTION_NUMBERING = re.compile(
    r"^(\d{1,2}\.\s|\d{1,2}(\.\d{1,2})+\.?\s|(kapitel|chapter|teil|part|abschnitt|section)\s+(\d+|[ivx]+)\b)", re.I
)


@dataclass(frozen=True)
class SlidePlan:
    index: int
    role: SlideRole
    text: str
    section: int


@dataclass(frozen=True)
class Section:
    index: int
    title: str
    start: int
    end: int  # inclusive


@dataclass(frozen=True)
class DeckSkeleton:
    boilerplate: frozenset[str]
    slides: tuple[SlidePlan, ...]
    sections: tuple[Section, ...]


def classify_role(index: int, text: str) -> SlideRole:
    """Role of one slide. ``text`` must already have boilerplate stripped."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines or len(" ".join(lines)) < 3:
        return SlideRole.EMPTY
    if index == 0:
        return SlideRole.TITLE
    for pattern, role in _HEADING_ROLES:
        if pattern.match(lines[0]):
            return role
    if (len(lines) <= 2 and len(" ".join(lines).split()) <= _SECTION_MAX_WORDS
            and _SECTION_NUMBERING.match(lines[0])):
        return SlideRole.SECTION
    return SlideRole.CONTENT


def _first_line(text: str) -> str:
    return next((ln.strip() for ln in text.splitlines() if ln.strip()), "")


_TITLE_ROLES = frozenset({SlideRole.CONTENT, SlideRole.SUMMARY, SlideRole.EXERCISE})


def _section_title(texts: list[str], roles: list[SlideRole], start: int, end: int) -> str:
    """An agenda slide only says "Inhalt", so its section is named after the
    first real slide that follows it."""
    if roles[start] is SlideRole.AGENDA:
        for i in range(start + 1, end + 1):
            if roles[i] in _TITLE_ROLES:
                return _first_line(texts[i])
    return _first_line(texts[start])


def build_deck_skeleton(pages: list[str]) -> DeckSkeleton:
    boilerplate = find_boilerplate(pages)
    texts = [strip_boilerplate(p, boilerplate) for p in pages]
    roles = [classify_role(i, t) for i, t in enumerate(texts)]

    # Real decks have no numbered dividers; their chapter markers are the
    # progress-agenda slides that recur. One agenda alone is just a table of
    # contents, so agendas delimit sections only when there are two or more.
    agenda_starts = roles.count(SlideRole.AGENDA) >= 2
    start_roles = {SlideRole.SECTION} | ({SlideRole.AGENDA} if agenda_starts else set())
    starts = [0] + [i for i, r in enumerate(roles) if i != 0 and r in start_roles]
    sections = tuple(
        Section(index=k, title=_section_title(texts, roles, s, end), start=s, end=end)
        for k, s in enumerate(starts)
        for end in [starts[k + 1] - 1 if k + 1 < len(starts) else len(pages) - 1]
    ) if pages else ()

    section_of = {i: s.index for s in sections for i in range(s.start, s.end + 1)}
    slides = tuple(
        SlidePlan(index=i, role=roles[i], text=texts[i], section=section_of[i])
        for i in range(len(pages))
    )
    return DeckSkeleton(boilerplate=boilerplate, slides=slides, sections=sections)
