"""Hypothesis strategies that generate lecture-deck-shaped page texts.

Each generated deck has a title page and content pages, and every page carries
the same footer — just like a real export,
where '{n}' becomes the page number. That gives tests a known ground truth
for boilerplate and roles.
"""
from __future__ import annotations

from hypothesis import strategies as st

FOOTER_LINES = ("Prof. Dr. Example | Datenbanksysteme", "Seite {n}")

_WORD = st.text(alphabet="abcdefghijklmnopqrstuvwxyzäöü", min_size=3, max_size=10)
_SENTENCE = st.lists(_WORD, min_size=6, max_size=14).map(lambda ws: " ".join(ws).capitalize() + ".")
_CONTENT = st.lists(_SENTENCE, min_size=2, max_size=6).map("\n".join)


def _with_footer(body: str, n: int) -> str:
    return body + "\n" + "\n".join(line.replace("{n}", str(n)) for line in FOOTER_LINES)


@st.composite
def decks(draw, min_pages: int = 4, max_pages: int = 40) -> list[str]:
    n = draw(st.integers(min_value=min_pages, max_value=max_pages))
    bodies = ["Lecture Title\nWinter 2026"]
    for _ in range(n - 1):
        bodies.append(draw(_CONTENT))
    return [_with_footer(b, i + 1) for i, b in enumerate(bodies)]
