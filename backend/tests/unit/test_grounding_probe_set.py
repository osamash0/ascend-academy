"""Integrity of the hand-written probe set. The real-deck half checks the
writing rule (no three-word copy from the cited slide) and skips without
the PDFs. Nothing here scores a pair: scoring is the Deck Lab's job."""
import re

import pytest

from backend.eval.data.grounding_probe import (
    CALIBRATION_DECKS,
    PROBE_DECK_DE,
    PROBE_DECK_EN,
    PROBE_DECKS,
    PROBE_PAIRS,
)
from backend.eval.decks import real_deck_pages
from backend.services.parser.deck_plan import build_deck_skeleton

_WORD = re.compile(r"[^\W_]+")


def _trigrams(text: str) -> set[tuple[str, ...]]:
    words = _WORD.findall(text.casefold())
    return {tuple(words[i:i + 3]) for i in range(len(words) - 2)}


def test_set_is_modest_and_balanced():
    assert 12 <= len(PROBE_PAIRS) <= 20
    en = sum(p.deck == PROBE_DECK_EN for p in PROBE_PAIRS)
    de = sum(p.deck == PROBE_DECK_DE for p in PROBE_PAIRS)
    assert en == de == len(PROBE_PAIRS) // 2


def test_probe_decks_are_not_the_calibration_decks():
    assert not set(PROBE_DECKS) & set(CALIBRATION_DECKS)
    assert {p.deck for p in PROBE_PAIRS} == set(PROBE_DECKS)


def test_language_matches_deck():
    for p in PROBE_PAIRS:
        assert p.language == ("en" if p.deck == PROBE_DECK_EN else "de")


def test_hallucinations_carry_no_digits():
    assert not [p for p in PROBE_PAIRS if any(ch.isdigit() for ch in p.hallucinated)]


def test_one_pair_per_cited_slide_and_answers_differ():
    keys = [(p.deck, p.slide) for p in PROBE_PAIRS]
    assert len(keys) == len(set(keys))
    assert all(p.paraphrased != p.hallucinated for p in PROBE_PAIRS)


@pytest.fixture(scope="module")
def skeletons():
    out = {}
    for deck in PROBE_DECKS:
        pages = real_deck_pages(deck)
        if pages is None:
            pytest.skip("real probe decks not available")
        out[deck] = build_deck_skeleton(pages)
    return out


@pytest.mark.parametrize("pair", PROBE_PAIRS, ids=lambda p: f"{p.language}-slide{p.slide}")
def test_answers_do_not_copy_three_words_from_the_cited_slide(pair, skeletons):
    sk = skeletons[pair.deck]
    assert 1 <= pair.slide <= len(sk.slides)
    slide = _trigrams(sk.slides[pair.slide - 1].text)
    assert slide, "cited slide is empty"
    assert not _trigrams(pair.paraphrased) & slide
    assert not _trigrams(pair.hallucinated) & slide
