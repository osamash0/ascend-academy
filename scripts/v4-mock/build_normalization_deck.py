#!/usr/bin/env python3
"""Render the demo Normalization deck and the Studio fixture built on it.

Usage:
  .venv/bin/python -I scripts/v4-mock/build_normalization_deck.py

Reads  src/features/spaces/mocks/normalization-deck.json (the deck's words)
Writes public/v4-mock/normalization.pdf (720x405 pt, one page per entry)
       public/v4-mock/studio/normalization-p1..pN.webp and
       src/features/spaces/mocks/studio-normalization.json (scripts/studio/build_fixture.py)

The deck is written for Learnstation; nothing in it comes from a course. The
fonts are PyMuPDF's built-in Helvetica (Nimbus Sans), embedded and subset, so
the script runs the same on any machine with PyMuPDF and the PDF needs none.
A line that does not fit, or a glyph the font lacks, stops the build rather
than shipping a page that silently lost words.
"""
import json
import sys
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.studio.build_fixture import main as build_fixture  # noqa: E402

DECK = ROOT / "src/features/spaces/mocks/normalization-deck.json"
PDF = ROOT / "public/v4-mock/normalization.pdf"
STUDIO_DIR = ROOT / "public/v4-mock/studio"
STUDIO_JSON = ROOT / "src/features/spaces/mocks/studio-normalization.json"

W, H = 720, 405
LEFT, RIGHT = 48, 672
INK, RULE, QUIET = (0.1, 0.1, 0.1), (0.6, 0.6, 0.6), (0.45, 0.45, 0.45)
REGULAR, BOLD, ITALIC = fitz.Font("helv"), fitz.Font("hebo"), fitz.Font("heit")


def _write(tw: fitz.TextWriter, font: fitz.Font, size: float, x: float, y: float, text: str, limit: float = RIGHT) -> None:
    missing = sorted({c for c in text if not font.has_glyph(ord(c))})
    if missing:
        sys.exit(f"no glyph for {missing!r} in {text!r}")
    if x + font.text_length(text, fontsize=size) > limit:
        sys.exit(f"does not fit: {text!r}")
    tw.append((x, y), text, font=font, fontsize=size)


def _table(page: fitz.Page, tw: fitz.TextWriter, top: float, table: dict) -> float:
    size, pad, row_h = 12, 8, 22
    rows = [table["columns"], *table["rows"]]
    fonts = [BOLD] + [REGULAR] * (len(rows) - 1)
    widths = [max(f.text_length(r[i], fontsize=size) for f, r in zip(fonts, rows)) + 2 * pad for i in range(len(rows[0]))]
    xs = [LEFT]
    for w in widths:
        xs.append(xs[-1] + w)
    bottom = top + row_h * len(rows)
    if xs[-1] > RIGHT or bottom > H - 40:
        sys.exit(f"table does not fit: {table['columns']}")
    for i, row in enumerate(rows):
        y = top + row_h * i
        for j, cell in enumerate(row):
            _write(tw, fonts[i], size, xs[j] + pad, y + 15, cell)
    for i in range(len(rows) + 1):
        page.draw_line((xs[0], top + row_h * i), (xs[-1], top + row_h * i), color=RULE, width=0.6)
    for x in xs:
        page.draw_line((x, top), (x, bottom), color=RULE, width=0.6)
    return bottom


def render(deck: dict, path: Path) -> int:
    doc = fitz.open()
    total = len(deck["pages"])
    for n, spec in enumerate(deck["pages"], 1):
        if spec["page"] != n:
            sys.exit(f"pages must run 1..{total} in order; found {spec['page']} at {n}")
        page = doc.new_page(width=W, height=H)
        tw = fitz.TextWriter(page.rect, color=INK)
        _write(tw, BOLD, 24, LEFT, 70, spec["title"])
        y = 120
        for bullet in spec["bullets"]:
            _write(tw, REGULAR, 15, LEFT + 4, y, "•")
            _write(tw, REGULAR, 15, LEFT + 22, y, bullet)
            y += 30
        if "formula" in spec:
            _write(tw, ITALIC, 14, LEFT + 22, y + 12, spec["formula"]["plain"])
            y += 42
        if "table" in spec:
            y = _table(page, tw, y - 6, spec["table"])
        tw.write_text(page)
        # A running footer, quieter than the page: the parser's furniture rules need one to find.
        foot, number = fitz.TextWriter(page.rect, color=QUIET), str(n)
        _write(foot, REGULAR, 9, LEFT, H - 17, deck["footer"])
        _write(foot, REGULAR, 9, RIGHT - REGULAR.text_length(number, fontsize=9), H - 17, number)
        foot.write_text(page)
    doc.set_metadata({
        "title": deck["title"],
        "author": "Learnstation",
        "subject": "Learnstation sample deck",
        "creator": "scripts/v4-mock/build_normalization_deck.py",
        "producer": "PyMuPDF",
        "creationDate": "",
        "modDate": "",
    })
    doc.subset_fonts()
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path, garbage=4, deflate=True, clean=True, no_new_id=True)
    doc.close()
    return total


if __name__ == "__main__":
    deck = json.loads(DECK.read_text())
    pages = render(deck, PDF)
    print(f"{PDF.relative_to(ROOT)}: {pages} pages, {PDF.stat().st_size // 1024} KB")
    build_fixture(str(PDF), f"1-{pages}", str(STUDIO_DIR), str(STUDIO_JSON))
