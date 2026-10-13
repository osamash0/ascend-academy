import pytest

from backend.eval.deck_lab import (
    SYNTH_MIN_CHARS,
    boilerplate_tokens_removed,
    corpus_totals,
    deck_span,
    eligible_sections,
    legacy_meta_selection,
    legacy_quiz_selection,
    new_meta_selection,
    new_quiz_selection,
    page_visibility,
    role_histogram,
    score_deck,
    section_coverage,
    synthesis_tokens_saved,
    text_routed,
)
from backend.services.parser.deck_plan import build_deck_skeleton
from backend.tests.support.deck_lab_decks import LONG_DECK, SHORT_DECK


@pytest.fixture
def long_sk():
    return build_deck_skeleton(LONG_DECK)


def test_fixture_structure_is_what_the_docstring_claims(long_sk):
    assert len(LONG_DECK) == 18 and len(SHORT_DECK) == 4
    assert long_sk.boilerplate == frozenset({"course footer line"})
    assert [(s.start, s.end) for s in long_sk.sections] == [(0, 0), (1, 11), (12, 17)]


def test_legacy_quiz_selection_reproduces_the_old_expression():
    picked = legacy_quiz_selection(LONG_DECK)
    assert [LONG_DECK[i] for i in picked] == [s for s in LONG_DECK if len(s) > 50][:10]
    assert picked == list(range(2, 12))


def test_legacy_quiz_threshold_is_strictly_more_than_fifty_raw_chars():
    assert legacy_quiz_selection(["x" * 50, "y" * 51, "z" * 49, "w" * 80]) == [1, 3]


def test_legacy_meta_selection_is_the_first_fifteen_pages():
    assert legacy_meta_selection(LONG_DECK) == list(range(15))
    assert legacy_meta_selection(SHORT_DECK) == [0, 1, 2, 3]


def test_new_selections_match_hand_checked_answers(long_sk):
    assert new_quiz_selection(long_sk) == [2, 4, 6, 8, 10, 13, 14, 15, 16, 17]
    assert new_meta_selection(long_sk) == [0, 1, 2, 3, 5, 6, 7, 9, 10, 12, 13, 14, 15, 16, 17]


def test_section_coverage_counts_only_eligible_sections(long_sk):
    assert eligible_sections(long_sk) == frozenset({1, 2})
    assert section_coverage(long_sk, legacy_quiz_selection(LONG_DECK)) == (1, 2)
    assert section_coverage(long_sk, new_quiz_selection(long_sk)) == (2, 2)
    # The title slide sits in section 0, which holds nothing a quiz can use.
    assert section_coverage(long_sk, [0, 2]) == (1, 2)
    assert section_coverage(long_sk, []) == (0, 2)


def test_deck_span():
    assert deck_span(list(range(2, 12)), 18) == pytest.approx(9 / 18)
    assert deck_span([2, 17], 18) == pytest.approx(15 / 18)
    assert deck_span([], 18) == 0.0
    assert deck_span([3], 18) == 0.0


def test_page_visibility():
    assert page_visibility(list(range(15)), 18) == (pytest.approx(15 / 18), 15)
    assert page_visibility([0, 17, 17], 18) == (pytest.approx(2 / 18), 18)
    assert page_visibility([], 18) == (0.0, 0)


def test_boilerplate_tokens_removed(long_sk):
    assert boilerplate_tokens_removed(LONG_DECK, long_sk) == 54
    assert boilerplate_tokens_removed(SHORT_DECK, build_deck_skeleton(SHORT_DECK)) == 12


def test_role_histogram_lists_every_role(long_sk):
    assert role_histogram(long_sk) == {
        "title": 1, "agenda": 2, "section": 0, "content": 15,
        "exercise": 0, "summary": 0, "references": 0, "empty": 0,
    }


def test_score_deck_long():
    r = score_deck("00 DBS Syn.pdf", LONG_DECK)
    assert (r.pages, r.sections, r.eligible_sections, r.boilerplate_lines) == (18, 3, 2, 1)
    assert (r.quiz_covered_old, r.quiz_covered_new) == (1, 2)
    assert r.span_old == pytest.approx(0.5)
    assert r.span_new == pytest.approx(15 / 18)
    assert r.meta_share_old == pytest.approx(15 / 18)
    assert r.meta_share_new == pytest.approx(15 / 18)
    assert (r.meta_last_old, r.meta_last_new) == (15, 18)
    assert r.boilerplate_removed == 54
    assert r.tokens_saved_per_slide == pytest.approx(3.0)


def test_corpus_totals_pool_counts_and_average_spans():
    t = corpus_totals([score_deck("a", LONG_DECK), score_deck("b", SHORT_DECK)])
    assert (t.decks, t.pages, t.sections, t.eligible_sections) == (2, 22, 4, 3)
    assert (t.quiz_covered_old, t.quiz_covered_new) == (2, 3)
    assert t.mean_span_old == pytest.approx(0.5)
    assert t.mean_span_new == pytest.approx((15 / 18 + 0.5) / 2)
    assert (t.meta_seen_old, t.meta_seen_new) == (19, 19)
    assert t.meta_share_new == pytest.approx(19 / 22)
    assert (t.meta_reaches_end_old, t.meta_reaches_end_new) == (1, 2)
    assert (t.boilerplate_lines, t.boilerplate_removed) == (2, 66)
    assert t.tokens_saved_per_slide == pytest.approx(3.0)
    roles = dict(t.roles)
    assert (roles["title"], roles["agenda"], roles["content"]) == (2, 2, 18)


def test_corpus_totals_of_nothing_is_zero_not_a_crash():
    t = corpus_totals([])
    assert t.decks == 0
    assert t.mean_span_new == 0.0 and t.meta_share_new == 0.0 and t.tokens_saved_per_slide == 0.0


def test_synth_min_chars_matches_the_orchestrator():
    from backend.services.parser import unified_orchestrator as uo
    assert SYNTH_MIN_CHARS == uo._MIN_TEXT_FOR_SYNTH


def test_text_routed_skips_image_only_pages():
    assert text_routed(["", "tiny", "  " + "x" * 24 + "  ", "y" * 25]) == [3]
    assert text_routed(LONG_DECK) == list(range(18))


def test_synthesis_tokens_saved_uses_the_production_fallback(long_sk):
    # 15 content pages x 3 footer tokens; title (19 chars) and both agendas
    # (24 chars) fall back to raw and save nothing.
    assert synthesis_tokens_saved(LONG_DECK, long_sk) == (45, 18)
    assert synthesis_tokens_saved(SHORT_DECK, build_deck_skeleton(SHORT_DECK)) == (9, 4)


def test_score_deck_reports_realized_saving():
    r = score_deck("00 DBS Syn.pdf", LONG_DECK)
    assert (r.synth_tokens_saved, r.synth_slides) == (45, 18)
    assert r.realized_saved_per_synth_slide == pytest.approx(2.5)


def test_corpus_totals_pool_realized_saving():
    t = corpus_totals([score_deck("a", LONG_DECK), score_deck("b", SHORT_DECK)])
    assert (t.synth_tokens_saved, t.synth_slides) == (54, 22)
    assert t.realized_saved_per_synth_slide == pytest.approx(54 / 22)
    assert corpus_totals([]).realized_saved_per_synth_slide == 0.0
