"""Characterization tests against the user's real lecture decks.

These are skipped when the PDFs are absent (CI). They pin what the
2026-09-17 review measured by hand: the DBS deck repeats template lines on
all 66 pages, which used to leak into every per-slide prompt."""
import os
from pathlib import Path

import pytest

from backend.services.parser.deck_plan import SlideRole, build_deck_skeleton

DECK_DIR = Path(os.environ.get("DECK_LAB_DIR", Path.home() / "Downloads"))


def real_deck_pages(name: str):
    path = DECK_DIR / name
    if not path.exists():
        return None
    import fitz
    with fitz.open(path) as doc:
        return [page.get_text("text") for page in doc]


@pytest.fixture
def dbs():
    pages = real_deck_pages("00 DBS Introduction.pdf")
    if pages is None:
        pytest.skip("real DBS deck not available")
    return pages


@pytest.fixture
def sr_prozesse():
    # The leading space is part of the real filename.
    pages = real_deck_pages(" 03__SR_Prozesse_v07_27.04.2025.pdf")
    if pages is None:
        pytest.skip("real SR deck not available")
    return pages


def test_dbs_deck_has_template_boilerplate(dbs):
    sk = build_deck_skeleton(dbs)
    assert len(dbs) == 66
    assert len(sk.boilerplate) >= 3


def test_dbs_deck_stripping_removes_less_than_half_the_text(dbs):
    sk = build_deck_skeleton(dbs)
    raw = sum(len(p) for p in dbs)
    kept = sum(len(s.text) for s in sk.slides)
    assert 0.5 * raw < kept < raw


def test_dbs_deck_is_mostly_content(dbs):
    sk = build_deck_skeleton(dbs)
    content = sum(1 for s in sk.slides if s.role is SlideRole.CONTENT)
    assert content >= 0.5 * len(dbs)


def test_sr_deck_footer_is_stripped_and_deck_is_mostly_content(sr_prozesse):
    sk = build_deck_skeleton(sr_prozesse)
    assert any("koldehofe" in line for line in sk.boilerplate)
    footer = "Systemsoftware und Rechnerkommunikation by Boris Koldehofe"
    assert all(footer not in s.text for s in sk.slides)
    content = sum(1 for s in sk.slides if s.role is SlideRole.CONTENT)
    assert content >= 0.5 * len(sr_prozesse)
