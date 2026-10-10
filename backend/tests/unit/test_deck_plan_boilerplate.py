import random

from hypothesis import given, settings
from backend.services.parser.deck_plan import find_boilerplate, normalize_line, strip_boilerplate
from backend.tests.support.deck_strategies import decks, FOOTER_LINES


def test_page_numbers_normalize_to_one_line():
    assert normalize_line("Seite 3 / 66") == normalize_line("  Seite 41 /  66 ")


def test_repeated_footer_is_found_and_unique_lines_are_not():
    pages = [f"Topic {c}\nUnique body {c}\nUni Marburg | DBS\nSeite {i}" for i, c in enumerate("abcdef")]
    bp = find_boilerplate(pages)
    assert normalize_line("Uni Marburg | DBS") in bp
    assert normalize_line("Seite 1") in bp
    assert not any("unique body" in line for line in bp)


def test_short_decks_never_report_boilerplate():
    pages = ["Same\nA", "Same\nB", "Same\nC"]
    assert find_boilerplate(pages) == frozenset()


def test_a_line_repeated_on_one_page_counts_once():
    pages = ["x\nx\nx\nx\nx"] + [f"page {i}" for i in range(5)]
    assert normalize_line("x") not in find_boilerplate(pages)


def test_strip_keeps_order_of_remaining_lines():
    bp = frozenset({normalize_line("Footer")})
    assert strip_boilerplate("a\nFooter\nb\nc", bp) == "a\nb\nc"


@settings(max_examples=60)
@given(decks())
def test_property_generated_footer_is_always_detected_and_removed(pages):
    bp = find_boilerplate(pages)
    for line in FOOTER_LINES:
        assert normalize_line(line.replace("{n}", "7")) in bp
    for page in pages:
        stripped = strip_boilerplate(page, bp)
        assert "Datenbanksysteme" not in stripped


@settings(max_examples=40)
@given(decks())
def test_metamorphic_page_order_does_not_change_boilerplate(pages):
    shuffled = pages[:]
    random.Random(0).shuffle(shuffled)
    assert find_boilerplate(shuffled) == find_boilerplate(pages)
