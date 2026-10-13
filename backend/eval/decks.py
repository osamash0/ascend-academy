"""Real lecture decks on disk, for the offline Deck Lab and the real-deck
characterization tests. No network and no LLM: it only reads PDFs.

Two series live in ~/Downloads (override with $DECK_LAB_DIR):
  "00 DBS Introduction.pdf"                  English DBS series
  " 03__SR_Prozesse_v07_27.04.2025.pdf"      German SR series
Some SR names start with a space; that space is part of the real name.
Copies the OS made on re-download ("...-2.pdf", "... Kopie.pdf") are
skipped so no deck is counted twice.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

DECK_DIR = Path(os.environ.get("DECK_LAB_DIR", Path.home() / "Downloads"))

_DECK_NAME = re.compile(r"^\s*\d{2}(?: DBS |__SR_).+\.pdf$")
_DUPLICATE_MARKERS = ("-2", "Kopie")


def is_lecture_deck(name: str) -> bool:
    return bool(_DECK_NAME.match(name)) and not any(m in name for m in _DUPLICATE_MARKERS)


def discover_decks(deck_dir: Path | None = None) -> list[str]:
    """Lecture-deck file names in ``deck_dir``, ordered by name ignoring the
    leading space some SR files carry."""
    root = deck_dir if deck_dir is not None else DECK_DIR
    if not root.is_dir():
        return []
    names = [p.name for p in root.iterdir() if p.is_file() and is_lecture_deck(p.name)]
    return sorted(names, key=lambda n: n.strip())


def load_pdf_pages(path: Path) -> list[str]:
    import fitz  # PyMuPDF; lazy so importing this module stays cheap

    with fitz.open(path) as doc:
        return [page.get_text("text") for page in doc]


def real_deck_pages(name: str, deck_dir: Path | None = None) -> list[str] | None:
    path = (deck_dir if deck_dir is not None else DECK_DIR) / name
    if not path.exists():
        return None
    return load_pdf_pages(path)
