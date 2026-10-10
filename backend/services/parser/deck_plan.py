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
