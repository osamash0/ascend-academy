from backend.services.parser.deck_plan import (
    META_ROLES,
    build_deck_skeleton,
    select_meta_slides,
    select_slides,
)
from backend.tests.support.deck_lab_decks import LONG_DECK

BODY = "A relational schema decomposes into BCNF when every determinant is a key of the relation."


def tag(i: int) -> str:
    # Letters, not digits: normalize_line folds digit runs to '#'.
    return "".join(chr(97 + int(d)) for d in str(i))


def _numbered_deck(n_sections: int, per_section: int) -> list[str]:
    pages = ["Course Title"]
    for s in range(n_sections):
        pages.append(f"{s + 1}. Chapter")
        pages += [f"Case {tag(s * 100 + k)}: {BODY}" for k in range(per_section)]
    return pages


def test_hand_checked_selection_on_the_long_fixture():
    sk = build_deck_skeleton(LONG_DECK)
    assert select_meta_slides(sk) == [0, 1, 2, 3, 5, 6, 7, 9, 10, 12, 13, 14, 15, 16, 17]


def test_title_is_kept_and_budget_holds_when_sections_outnumber_the_budget():
    sk = build_deck_skeleton(_numbered_deck(20, 2))
    spread = select_slides(sk, 15, META_ROLES, min_chars=1)
    assert 0 not in spread  # 21 sections, budget 15: the title section loses its slot
    picked = select_meta_slides(sk)
    assert picked == [0] + spread[:14]
    assert len(picked) == 15


def test_zero_budget_selects_nothing():
    assert select_meta_slides(build_deck_skeleton(LONG_DECK), 0) == []


def test_empty_deck_selects_nothing():
    assert select_meta_slides(build_deck_skeleton([])) == []
