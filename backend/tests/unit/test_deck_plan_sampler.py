from hypothesis import given, settings, strategies as st

from backend.services.parser.deck_plan import QUIZ_ROLES, build_deck_skeleton, select_slides
from backend.tests.support.deck_strategies import decks

BODY = "A relational schema decomposes into BCNF when every determinant is a key of the relation."


def tag(i: int) -> str:
    # Letters, not digits: normalize_line folds digit runs to '#', so
    # "Point 3" and "Point 7" would be ONE repeated line and get stripped
    # as boilerplate.
    return "".join(chr(97 + int(d)) for d in str(i))


def _deck(n_sections: int, per_section: int) -> list[str]:
    pages = ["Course Title"]
    for s in range(n_sections):
        pages.append(f"{s + 1}. Chapter")
        pages += [f"Case {tag(s * 100 + k)}: {BODY}" for k in range(per_section)]
    return pages


def test_regression_reaches_beyond_the_first_ten_slides():
    sk = build_deck_skeleton(_deck(4, 10))
    picked = select_slides(sk, budget=10)
    assert max(picked) > 20


def test_every_section_is_represented_when_budget_allows():
    sk = build_deck_skeleton(_deck(5, 8))
    picked = select_slides(sk, budget=10)
    assert {sk.slides[i].section for i in picked} == {1, 2, 3, 4, 5}


@settings(max_examples=80)
@given(decks(), st.integers(min_value=0, max_value=30))
def test_property_sampler_contract(pages, budget):
    sk = build_deck_skeleton(pages)
    picked = select_slides(sk, budget=budget)
    eligible = [s.index for s in sk.slides if s.role in QUIZ_ROLES and len(s.text) >= 50]
    assert picked == sorted(set(picked))
    assert set(picked) <= set(eligible)
    assert len(picked) == min(budget, len(eligible))
    assert select_slides(sk, budget=budget) == picked  # deterministic


def test_small_budget_with_many_sections_does_not_crash():
    sk = build_deck_skeleton(_deck(5, 4))
    picked = select_slides(sk, budget=3)
    assert len(picked) == 3
    assert len({sk.slides[i].section for i in picked}) == 3


@settings(max_examples=80)
@given(st.integers(2, 8), st.integers(1, 6), st.integers(1, 7))
def test_property_many_sections_small_budget(n_sections, per_section, budget):
    sk = build_deck_skeleton(_deck(n_sections, per_section))
    picked = select_slides(sk, budget=budget)
    eligible = [s.index for s in sk.slides if s.role in QUIZ_ROLES and len(s.text) >= 50]
    assert picked == sorted(set(picked))
    assert set(picked) <= set(eligible)
    assert len(picked) == min(budget, len(eligible))
    assert select_slides(sk, budget=budget) == picked
