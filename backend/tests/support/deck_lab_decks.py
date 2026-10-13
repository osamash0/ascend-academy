"""Synthetic decks with hand-checked Deck Lab answers.

Rules the fixtures obey (see deck_plan.py):
  - lines differ by LETTERS, never only by digits (normalize_line folds digit
    runs to '#', so "Point 3" and "Point 7" would be one boilerplate line);
  - every deck has >= 4 pages, so boilerplate detection runs;
  - FOOTER is on every page (>= 60%), so it is stripped as boilerplate.

LONG_DECK (18 pages): title, agenda, 10 content, agenda, 5 content.
Two agendas -> three sections: 0 = [0], 1 = [1..11], 2 = [12..17].
Eligible quiz sections: {1, 2}.
  legacy quiz  [2..11]                          -> covers 1/2, span 9/18 = 0.50
  new quiz     [2,4,6,8,10,13,14,15,16,17]      -> covers 2/2, span 15/18 = 0.83
  legacy meta  [0..14]                          -> 15/18 seen, last page 15
  new meta     [0,1,2,3,5,6,7,9,10,12..17]      -> 15/18 seen, last page 18
  boilerplate  3 footer tokens x 18 pages = 54 removed, 3.0 per slide

SHORT_DECK (4 pages): title + 3 content, one section.
  legacy = new quiz [1,2,3] -> 1/1, span 2/4 = 0.50
  legacy = new meta [0..3]  -> 4/4 seen, last page 4
  boilerplate 3 x 4 = 12 removed
"""
from __future__ import annotations

from pathlib import Path

FOOTER = "Course Footer Line"
_WORDS = (
    "alpha bravo charlie delta echo foxtrot golf hotel india juliet "
    "kilo lima mike november oscar papa quebec romeo"
).split()
_AGENDA = f"Agenda\nPart one\nPart two\n{FOOTER}"


def content_page(word: str) -> str:
    return f"Heading {word}\nThis slide explains the {word} concept in enough words to pass.\n{FOOTER}"


LONG_DECK: list[str] = (
    [f"Lecture Title Alpha\n{FOOTER}", _AGENDA]
    + [content_page(w) for w in _WORDS[:10]]
    + [_AGENDA]
    + [content_page(w) for w in _WORDS[10:15]]
)
SHORT_DECK: list[str] = [f"Lecture Title Bravo\n{FOOTER}"] + [content_page(w) for w in _WORDS[15:18]]


def write_pdf(path: Path, pages: list[str]) -> None:
    """Tiny real PDF, one text block per page (PyMuPDF; no network)."""
    import fitz

    doc = fitz.open()
    for text in pages:
        doc.new_page().insert_text((72, 72), text, fontsize=9)
    doc.save(path)
    doc.close()
