"""deck_plan.synthesis_text: what per-slide synthesis sends the model (Arc 7).

Fixture rules (deck_plan.normalize_line folds digit runs to '#'): lines differ
by letters, the deck has >= 4 pages, and FOOTER is on every page so it is
stripped as boilerplate."""
from backend.services.parser.deck_plan import build_deck_skeleton, synthesis_text

FOOTER = "Course Footer Line"
PAGES = [
    f"Lecture Title Alpha\n{FOOTER}",
    f"Heading bravo\nThis slide explains the bravo concept in enough words.\n{FOOTER}",
    f"Heading charlie\nThis slide explains the charlie concept in enough words.\n{FOOTER}",
    f"Heading delta\nThis slide explains the delta concept in enough words.\n{FOOTER}",
]


def test_sends_stripped_text_when_enough_remains():
    sk = build_deck_skeleton(PAGES)
    assert sk.boilerplate == frozenset({"course footer line"})
    assert synthesis_text(PAGES[1], sk, 1, 25) == (
        "Heading bravo\nThis slide explains the bravo concept in enough words."
    )


def test_falls_back_to_raw_when_stripping_leaves_too_little():
    sk = build_deck_skeleton(PAGES)
    assert sk.slides[0].text == "Lecture Title Alpha"  # 19 chars < 25
    assert synthesis_text(PAGES[0], sk, 0, 25) is PAGES[0]


def test_threshold_is_inclusive():
    sk = build_deck_skeleton(PAGES)
    assert synthesis_text(PAGES[0], sk, 0, 19) == "Lecture Title Alpha"
    assert synthesis_text(PAGES[0], sk, 0, 20) is PAGES[0]


def test_raw_without_a_skeleton():
    assert synthesis_text(PAGES[1], None, 1, 25) is PAGES[1]


def test_raw_when_the_deck_has_no_boilerplate():
    pages = PAGES[:3]  # < 4 pages: boilerplate detection does not run
    sk = build_deck_skeleton(pages)
    assert sk.boilerplate == frozenset()
    assert synthesis_text(pages[1], sk, 1, 25) is pages[1]


def test_raw_for_an_index_outside_the_skeleton():
    sk = build_deck_skeleton(PAGES)
    extra = "An extra page that the skeleton never saw at all."
    assert synthesis_text(extra, sk, 9, 25) is extra
    assert synthesis_text(extra, sk, -1, 25) is extra
