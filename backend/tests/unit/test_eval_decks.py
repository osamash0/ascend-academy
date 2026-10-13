import pytest

from backend.eval import decks
from backend.eval.decks import discover_decks, is_lecture_deck, load_pdf_pages, real_deck_pages
from backend.tests.support.deck_lab_decks import write_pdf


@pytest.mark.parametrize("name", [
    "00 DBS Introduction.pdf",
    "09 DBS Index Structures.pdf",
    " 03__SR_Prozesse_v07_27.04.2025.pdf",
    "14__SR_Internet_v02_16.06.2026.pdf",
])
def test_lecture_deck_names_are_recognised(name):
    assert is_lecture_deck(name)


@pytest.mark.parametrize("name", [
    "09 DBS Index Structures-2.pdf",
    " 03__SR_Prozesse_v07_27.04.2025-2.pdf",
    "02__SR_Aufgaben_BS_v01_20.04.2025 Kopie.pdf",
    "00 DBS Introduction.pptx",
    "DBS26_Uebung1.pdf",
    "notes.pdf",
])
def test_duplicates_and_non_decks_are_skipped(name):
    assert not is_lecture_deck(name)


def test_discover_decks_lists_only_lecture_decks_sorted(tmp_path):
    for name in ["01 DBS Basics.pdf", " 03__SR_Prozesse_v07_27.04.2025.pdf",
                 "01 DBS Basics-2.pdf", "notes.pdf", "00 DBS Introduction.pdf"]:
        (tmp_path / name).write_bytes(b"")
    assert discover_decks(tmp_path) == [
        "00 DBS Introduction.pdf", "01 DBS Basics.pdf", " 03__SR_Prozesse_v07_27.04.2025.pdf",
    ]


def test_discover_decks_on_missing_dir_is_empty(tmp_path):
    assert discover_decks(tmp_path / "absent") == []


def test_real_deck_pages_reads_page_text(tmp_path):
    write_pdf(tmp_path / "00 DBS Mini.pdf", ["Heading alpha", "Heading bravo"])
    pages = real_deck_pages("00 DBS Mini.pdf", tmp_path)
    assert [p.strip() for p in pages] == ["Heading alpha", "Heading bravo"]
    assert load_pdf_pages(tmp_path / "00 DBS Mini.pdf") == pages


def test_real_deck_pages_is_none_when_absent(tmp_path):
    assert real_deck_pages("00 DBS Missing.pdf", tmp_path) is None


def test_default_dir_is_read_at_call_time(tmp_path, monkeypatch):
    write_pdf(tmp_path / "00 DBS Mini.pdf", ["Heading alpha"])
    monkeypatch.setattr(decks, "DECK_DIR", tmp_path)
    assert real_deck_pages("00 DBS Mini.pdf") is not None
