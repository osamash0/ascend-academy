import hashlib
import json
import random
import statistics
from collections import Counter

import pytest

from backend.eval.parser_bench import pageset, schedule

TYPES = ("layout", "lists", "table_formula", "diagram", "dense_text")
PAGES = [schedule.SchedPage(f"p{i}", TYPES[i % 5]) for i in range(24)]
TEN = ["current", "pymupdf4llm", "pdfjs", "markitdown", "opendataloader", "ai_vision", "docling", "marker", "mineru", "paddleocr"]
FIVE = TEN[:5]


def test_ten_entrants_make_135_duels_and_15_hidden_repeats():
    duels = schedule.round1(TEN, PAGES, seed=1)
    assert len(duels) == 150
    assert sum(d["repeat_of"] is None for d in duels) == 135
    assert [d["duel"] for d in duels] == list(range(150))


def test_five_entrants_make_30_duels_and_3_hidden_repeats():
    duels = schedule.round1(FIVE, PAGES, seed=1)
    assert len(duels) == 33 and sum(d["repeat_of"] is not None for d in duels) == 3


@pytest.mark.parametrize("entrants", [TEN, FIVE])
def test_every_pair_meets_three_times_on_three_page_types(entrants):
    first = [d for d in schedule.round1(entrants, PAGES, seed=3) if d["repeat_of"] is None]
    by_pair: dict = {}
    for d in first:
        by_pair.setdefault((d["a"], d["b"]), []).append(d["type"])
    assert len(by_pair) == len(entrants) * (len(entrants) - 1) // 2
    assert all(len(types) == 3 and len(set(types)) == 3 for types in by_pair.values())
    appearances = Counter(t for d in first for t in (d["a"], d["b"]))
    assert set(appearances.values()) == {3 * (len(entrants) - 1)}  # 27 each for ten entrants


def test_pages_of_one_type_are_used_evenly():
    first = [d for d in schedule.round1(TEN, PAGES, seed=5) if d["repeat_of"] is None]
    use = Counter(d["page"] for d in first)
    for t in TYPES:
        counts = [use[p.key] for p in PAGES if p.type == t]
        assert max(counts) - min(counts) <= 1, t


@pytest.mark.parametrize("entrants", [TEN, FIVE])
def test_a_repeat_swaps_sides_and_comes_long_after_its_original(entrants):
    duels = schedule.round1(entrants, PAGES, seed=9)
    gap = schedule.repeat_gap(len(duels))
    for d in duels:
        if d["repeat_of"] is None:
            continue
        original = duels[d["repeat_of"]]
        assert original["repeat_of"] is None
        assert (d["left"], d["right"], d["page"]) == (original["right"], original["left"], original["page"])
        assert d["duel"] - original["duel"] >= gap


def test_the_repeat_gap_is_20_or_a_third_of_a_short_schedule():
    assert (schedule.repeat_gap(150), schedule.repeat_gap(33), schedule.repeat_gap(10)) == (20, 11, 3)


def test_the_same_seed_gives_the_same_schedule_and_another_seed_a_different_one():
    assert schedule.round1(TEN, PAGES, seed=42) == schedule.round1(TEN, PAGES, seed=42)
    assert schedule.round1(TEN, PAGES, seed=42) != schedule.round1(TEN, PAGES, seed=43)


@pytest.mark.parametrize("entrants", [TEN, FIVE])
def test_each_tool_is_on_the_left_within_one_of_half_its_round_one_appearances(entrants):
    for seed in range(30):
        first = [d for d in schedule.round1(entrants, PAGES, seed=seed) if d["repeat_of"] is None]
        appear = Counter(t for d in first for t in (d["a"], d["b"]))
        lefts = Counter(d["left"] for d in first)
        for t in entrants:
            assert abs(lefts[t] - appear[t] / 2) <= 1, (seed, t)


@pytest.mark.parametrize("entrants", [TEN, FIVE])
def test_round2_sides_are_balanced_per_tool_as_well(entrants):
    for seed in range(30):
        existing = schedule.round1(entrants, PAGES, seed=seed)
        batch = schedule.round2_batch(list(entrants), PAGES, existing, seed=seed, batch=1, room=75)
        appear = Counter(t for d in batch for t in (d["a"], d["b"]))
        lefts = Counter(d["left"] for d in batch)
        for t in entrants:
            assert abs(lefts[t] - appear[t] / 2) <= 1, (seed, t)


def test_repeats_do_not_cluster_at_the_end():
    positions = []
    for seed in range(500):
        duels = schedule.round1(TEN, PAGES, seed=seed)
        gap = schedule.repeat_gap(len(duels))
        for d in duels:
            if d["repeat_of"] is None:
                continue
            original = duels[d["repeat_of"]]
            assert d["duel"] - original["duel"] >= gap
            positions.append(d["duel"] / len(duels))
    assert statistics.median(positions) < 0.70


def test_the_schedule_does_not_depend_on_the_order_of_the_pages():
    shuffled = list(PAGES)
    random.Random(0).shuffle(shuffled)
    assert schedule.round1(TEN, shuffled, seed=7) == schedule.round1(TEN, PAGES, seed=7)
    existing = schedule.round1(FIVE, PAGES, seed=1)
    ranked = ["opendataloader", "pymupdf4llm", "current", "pdfjs", "markitdown"]
    assert (schedule.round2_batch(ranked, shuffled, existing, seed=1, batch=1, room=75)
            == schedule.round2_batch(ranked, PAGES, existing, seed=1, batch=1, room=75))


def test_duplicate_page_keys_are_refused():
    dup = PAGES + [schedule.SchedPage("p0", "layout")]
    existing = schedule.round1(FIVE, PAGES, seed=1)
    with pytest.raises(ValueError, match="duplicate"):
        schedule.round1(TEN, dup, seed=1)
    with pytest.raises(ValueError, match="duplicate"):
        schedule.round2_batch(["current", "pdfjs"], dup, existing, seed=1, batch=1, room=75)


def test_too_few_page_types_are_refused():
    with pytest.raises(ValueError, match="page types"):
        schedule.round1(FIVE, [schedule.SchedPage("a", "lists"), schedule.SchedPage("b", "layout")], seed=1)


def test_round2_is_needed_only_while_the_top_two_overlap():
    assert schedule.needs_round2([{"lo": 1050, "hi": 1200}, {"lo": 990, "hi": 1060}])
    assert not schedule.needs_round2([{"lo": 1070, "hi": 1200}, {"lo": 990, "hi": 1060}])
    assert not schedule.needs_round2([{"lo": 1070, "hi": 1200}])


def test_a_round2_batch_pairs_neighbours_among_the_top_four():
    existing = schedule.round1(FIVE, PAGES, seed=1)
    ranked = ["opendataloader", "pymupdf4llm", "current", "pdfjs", "markitdown"]
    batch = schedule.round2_batch(ranked, PAGES, existing, seed=1, batch=1, room=75)
    assert len(batch) == 9 and [d["duel"] for d in batch] == list(range(33, 42))
    pairs = Counter(tuple(sorted((d["a"], d["b"]))) for d in batch)
    assert pairs == {("opendataloader", "pymupdf4llm"): 3, ("current", "pymupdf4llm"): 3, ("current", "pdfjs"): 3}
    assert all(d["round"] == 2 and d["repeat_of"] is None for d in batch)
    assert schedule.round2_batch(ranked, PAGES, existing, seed=1, batch=1, room=4)[-1]["duel"] == 36


SEVEN = ["current", "pymupdf4llm", "pdfjs", "markitdown", "opendataloader", "ai_vision", "ai_vision_strong"]
NEW = {"ai_vision", "ai_vision_strong"}


def _digest(duels) -> str:
    return hashlib.sha256(json.dumps(duels, sort_keys=True).encode()).hexdigest()


def _page_set():
    return [schedule.SchedPage(p.key, p.type) for p in pageset.load()]


def test_the_first_comparison_is_scheduled_exactly_as_before():
    duels = schedule.round1(FIVE, _page_set(), 20261031)
    assert _digest(duels) == "ba9b16d9db19374d35430723770381090bf46b209c8886a0cc26bcb5c78687ca"
    assert schedule.round1(FIVE, _page_set(), 20261031, new=None) == duels


def test_the_second_comparison_schedule_is_fixed_before_any_vote():
    duels = schedule.round1(SEVEN, _page_set(), 20261101, new=NEW)
    assert len(duels) == 37 and sum(d["repeat_of"] is not None for d in duels) == 4
    assert _digest(duels) == "b9808242c21fe8cd02869770116561873f66c1b89ddabd5bb97c377bde9a1997"


def test_an_added_comparison_pairs_only_new_methods():
    # the spec's "every pair 3× on 3 page types" applies here only to pairs with a new entrant: Deviation 2
    duels = schedule.round1(SEVEN, PAGES, seed=5, new=NEW)
    first = [d for d in duels if d["repeat_of"] is None]
    assert len(first) == 33 and all({d["a"], d["b"]} & NEW for d in duels)
    pairs = Counter(tuple(sorted((d["a"], d["b"]))) for d in first)
    assert len(pairs) == 11 and set(pairs.values()) == {3}  # 2 new × 5 old + the new pair, 3 each
    seen = Counter(x for d in first for x in (d["a"], d["b"]))
    assert all(seen[t] == 18 for t in NEW) and all(seen[t] == 6 for t in FIVE)
    left = Counter(d["left"] for d in first)
    assert all(abs(left[t] - seen[t] / 2) <= 1 for t in SEVEN)
    gap = schedule.repeat_gap(len(duels))
    assert all(d["duel"] - d["repeat_of"] >= gap for d in duels if d["repeat_of"] is not None)


def test_new_entrants_must_be_entrants():
    with pytest.raises(ValueError, match="not among the entrants"):
        schedule.round1(FIVE, PAGES, seed=1, new={"docling"})
    with pytest.raises(ValueError, match="at least one new"):
        schedule.round1(FIVE, PAGES, seed=1, new=set())


def test_round2_of_an_added_comparison_needs_a_new_method_in_the_top_two():
    old_top = [{"entrant": "pymupdf4llm", "lo": 1050, "hi": 1200}, {"entrant": "opendataloader", "lo": 990, "hi": 1060}]
    assert schedule.needs_round2(old_top) and not schedule.needs_round2(old_top, new=NEW)
    new_top = [{"entrant": "ai_vision", "lo": 1050, "hi": 1200}, {"entrant": "pymupdf4llm", "lo": 990, "hi": 1060}]
    assert schedule.needs_round2(new_top, new=NEW)
    apart = [{"entrant": "ai_vision", "lo": 1070, "hi": 1200}, {"entrant": "pymupdf4llm", "lo": 990, "hi": 1060}]
    assert not schedule.needs_round2(apart, new=NEW)


def test_a_round2_batch_of_an_added_comparison_keeps_only_pairs_with_a_new_method():
    existing = schedule.round1(SEVEN, PAGES, seed=5, new=NEW)
    ranked = ["pymupdf4llm", "ai_vision", "opendataloader", "pdfjs", "current", "markitdown", "ai_vision_strong"]
    batch = schedule.round2_batch(ranked, PAGES, existing, seed=5, batch=1, room=75, only_with=NEW)
    pairs = Counter(tuple(sorted((d["a"], d["b"]))) for d in batch)
    assert pairs == {("ai_vision", "pymupdf4llm"): 3, ("ai_vision", "opendataloader"): 3}
    assert [d["duel"] for d in batch] == list(range(37, 43))
    same = schedule.round2_batch(ranked, PAGES, existing, seed=5, batch=1, room=75)
    assert len(same) == 9  # without only_with: Plan 2's rule, all three neighbour pairs


ELEVEN = [*SEVEN, "docling", "marker", "mineru", "paddleocr"]
HEAVY = {"docling", "marker", "mineru", "paddleocr"}
OPPONENTS = {"ai_vision_strong", "ai_vision", "pymupdf4llm", "current"}
OTHERS = ["mineru", "paddleocr", "pymupdf4llm", "ai_vision_strong", "current", "pdfjs", "markitdown"]


def test_the_third_comparison_schedule_is_fixed_before_any_vote():
    duels = schedule.round1(ELEVEN, _page_set(), 20261102, new=HEAVY, opponents=OPPONENTS)
    assert len(duels) == 73 and sum(d["repeat_of"] is not None for d in duels) == 7
    assert _digest(duels) == "05e4a3b4c1dd0f980f495401892280ce36a58b55d65d445c83fa98d8d73aed35"
    five = schedule.round1([*ELEVEN, "paddleocr_vl"], _page_set(), 20261102, new=HEAVY | {"paddleocr_vl"},
                           opponents=OPPONENTS)
    assert len(five) == 100
    assert _digest(five) == "fca9e8916172d42b0019a1b1392de0b5892d4185d1ad05b6adbed0f9d895dee6"



def test_the_third_comparison_schedule_for_the_three_methods_that_ran():
    # paddleocr and paddleocr_vl did not run here (8 GB of memory; PROTOCOL.md deviation 3): the entrants are three
    three = {"docling", "marker", "mineru"}
    duels = schedule.round1([*SEVEN, *sorted(three)], _page_set(), 20261102, new=three, opponents=OPPONENTS)
    assert len(duels) == 50 and sum(d["repeat_of"] is not None for d in duels) == 5
    assert _digest(duels) == "dee5c66225f8f4b7fa2f50adf0e7b6cc500b370bc2fe523224608f279d0b5fac"

def test_new_methods_meet_each_other_and_only_the_chosen_opponents():
    duels = schedule.round1(ELEVEN, PAGES, seed=5, new=HEAVY, opponents=OPPONENTS)
    first = [d for d in duels if d["repeat_of"] is None]
    pairs = Counter(tuple(sorted((d["a"], d["b"]))) for d in first)
    assert len(first) == 66 and len(pairs) == 22 and set(pairs.values()) == {3}  # 6 new pairs + 4 × 4
    for pair in pairs:
        assert set(pair) <= HEAVY or (len(set(pair) & HEAVY) == 1 and set(pair) - HEAVY <= OPPONENTS), pair
    seen = Counter(x for d in first for x in (d["a"], d["b"]))
    assert all(seen[t] == 21 for t in HEAVY) and all(seen[t] == 12 for t in OPPONENTS)
    assert not {"pdfjs", "markitdown", "opendataloader"} & set(seen)
    left = Counter(d["left"] for d in first)
    assert all(abs(left[t] - seen[t] / 2) <= 1 for t in seen)
    gap = schedule.repeat_gap(len(duels))
    assert len(duels) == 73 and all(d["duel"] - d["repeat_of"] >= gap for d in duels if d["repeat_of"] is not None)


@pytest.mark.parametrize("n, total", [(1, 13), (2, 30), (3, 50), (4, 73), (5, 100)])
def test_the_duel_count_follows_from_the_number_of_new_methods(n, total):
    new = ["docling", "marker", "mineru", "paddleocr", "paddleocr_vl"][:n]
    assert len(schedule.round1([*SEVEN, *new], PAGES, seed=5, new=set(new), opponents=OPPONENTS)) == total


def test_opponents_are_checked():
    with pytest.raises(ValueError, match="not among the entrants"):
        schedule.round1(ELEVEN, PAGES, seed=1, new=HEAVY, opponents={"tesseract"})
    with pytest.raises(ValueError, match="are new entrants"):
        schedule.round1(ELEVEN, PAGES, seed=1, new=HEAVY, opponents={"docling", "current"})
    with pytest.raises(ValueError, match="at least one earlier entrant"):
        schedule.round1(ELEVEN, PAGES, seed=1, new=HEAVY, opponents=set())
    with pytest.raises(ValueError, match="name its new entrants"):
        schedule.round1(ELEVEN, PAGES, seed=1, opponents=OPPONENTS)
    with pytest.raises(ValueError, match="not one string"):
        schedule.round1(ELEVEN, PAGES, seed=1, new="docling")
    with pytest.raises(ValueError, match="not one string"):
        schedule.round1(ELEVEN, PAGES, seed=1, new=HEAVY, opponents="current")


def test_round2_batch_refuses_what_round1_refuses():
    with pytest.raises(ValueError, match="at least one new"):
        schedule.round2_batch(SEVEN, PAGES, [], seed=5, batch=1, room=75, only_with=set())
    with pytest.raises(ValueError, match="not one string"):
        schedule.round2_batch(SEVEN, PAGES, [], seed=5, batch=1, room=75, only_with="ai_vision")
    with pytest.raises(ValueError, match="name its new entrants"):
        schedule.round2_batch(SEVEN, PAGES, [], seed=5, batch=1, room=75, opponents={"current"})


def _top(a, b):
    return [{"entrant": a, "lo": 1050, "hi": 1200}, {"entrant": b, "lo": 990, "hi": 1060}]


def test_round2_with_opponents_needs_the_top_two_to_be_a_scheduled_pair():
    assert schedule.needs_round2(_top("docling", "ai_vision"), new=HEAVY, opponents=OPPONENTS)
    assert schedule.needs_round2(_top("docling", "marker"), new=HEAVY, opponents=OPPONENTS)
    assert not schedule.needs_round2(_top("docling", "opendataloader"), new=HEAVY, opponents=OPPONENTS)
    assert not schedule.needs_round2(_top("ai_vision", "pymupdf4llm"), new=HEAVY, opponents=OPPONENTS)
    assert schedule.needs_round2(_top("docling", "opendataloader"), new=HEAVY)  # without opponents: Plan 3a's rule


def test_a_round2_batch_with_opponents_keeps_only_scheduled_pairs():
    existing = schedule.round1(ELEVEN, PAGES, seed=5, new=HEAVY, opponents=OPPONENTS)
    ranked = ["docling", "opendataloader", "ai_vision", "marker", *OTHERS]
    batch = schedule.round2_batch(ranked, PAGES, existing, seed=5, batch=1, room=75, only_with=HEAVY,
                                  opponents=OPPONENTS)
    pairs = Counter(tuple(sorted((d["a"], d["b"]))) for d in batch)
    assert pairs == {("ai_vision", "marker"): 3}  # docling–opendataloader and opendataloader–ai_vision are not scheduled
    assert [d["duel"] for d in batch] == list(range(73, 76))
    plan3a = schedule.round2_batch(ranked, PAGES, existing, seed=5, batch=1, room=75, only_with=HEAVY)
    assert len(plan3a) == 6  # without opponents: every adjacent pair with a new method


def test_pair_allowed_is_the_one_rule():
    assert schedule.pair_allowed("pdfjs", "current", None, None)
    assert schedule.pair_allowed("docling", "pdfjs", HEAVY, None)
    assert not schedule.pair_allowed("pdfjs", "current", HEAVY, None)
    assert not schedule.pair_allowed("docling", "pdfjs", HEAVY, OPPONENTS)
    assert schedule.pair_allowed("pdfjs", "docling", HEAVY, {"pdfjs"})
    assert schedule.pair_allowed("docling", "marker", HEAVY, set())
