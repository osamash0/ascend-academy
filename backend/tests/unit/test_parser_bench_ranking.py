import math
import random
import time

import pytest

from backend.eval.parser_bench import ranking

TRUE = {"current": 1.0, "b": 2.0, "c": 4.0, "d": 0.5}


def true_points(anchor="current"):
    return {e: 1000 + 400 * math.log10(s / TRUE[anchor]) for e, s in TRUE.items()}


def synthetic(n, seed, tie_share=0.0, strengths=None):
    """Votes drawn from known strengths: a beats b with probability p_a / (p_a + p_b).

    With a tie share, a "same" vote is drawn first and the rest are drawn so that each pair's
    expected score stays q = p_a / (p_a + p_b) (a draw counts half). The model is then exact,
    so the fit can be checked against the true strengths.
    """
    strengths = TRUE if strengths is None else strengths
    rng = random.Random(seed)
    names = sorted(strengths)
    out = []
    for _ in range(n):
        a, b = rng.sample(names, 2)
        q = strengths[a] / (strengths[a] + strengths[b])
        if rng.random() < tie_share:
            out.append(ranking.outcome(a, b, "same"))
            continue
        left_given_decided = (q - tie_share / 2) / (1 - tie_share)
        if not 0 <= left_given_decided <= 1:
            raise ValueError("tie share is too large for these strengths")
        out.append(ranking.outcome(a, b, "left" if rng.random() < left_given_decided else "right"))
    return out


def test_the_fit_recovers_known_strengths():
    est = ranking.points(ranking.fit(synthetic(6000, seed=1), sorted(TRUE)), "current")
    for e, want in true_points().items():
        assert abs(est[e] - want) < 20, (e, est[e], want)


def test_the_bootstrap_intervals_cover_the_true_strengths():
    # One fixed dataset: a 95% interval misses about one time in twenty, so the data are not redrawn.
    rows = ranking.rate(synthetic(600, seed=11), sorted(TRUE), "current", resamples=200, seed=3)
    truth = true_points()
    for row in rows:
        assert row["lo"] <= truth[row["entrant"]] <= row["hi"], row
    anchor = next(r for r in rows if r["entrant"] == "current")
    assert (anchor["points"], anchor["lo"], anchor["hi"]) == (1000.0, 1000.0, 1000.0)
    assert [r["entrant"] for r in rows] == ["c", "b", "current", "d"]


def test_intervals_narrow_as_votes_accumulate():
    def width(n):
        rows = ranking.rate(synthetic(n, seed=12), sorted(TRUE), "current", resamples=100, seed=1)
        return sum(r["hi"] - r["lo"] for r in rows)

    assert width(1200) < width(150)


def test_draws_are_half_a_win_each():
    votes = [ranking.outcome("current", "x", c) for c in ("same", "both_bad", "same", "both_bad")]
    est = ranking.points(ranking.fit(votes, ["current", "x"]), "current")
    assert est["x"] == pytest.approx(1000.0, abs=1e-6)
    one_each = [ranking.outcome("current", "x", "left"), ranking.outcome("current", "x", "right")]
    assert ranking.points(ranking.fit(one_each, ["current", "x"]), "current")["x"] == pytest.approx(1000.0, abs=1e-6)


def test_an_entrant_that_never_wins_keeps_a_finite_rating():
    votes = [ranking.outcome("current", "loser", "left") for _ in range(10)]
    est = ranking.points(ranking.fit(votes, ["current", "loser"]), "current")
    assert math.isfinite(est["loser"]) and est["loser"] < 800


def test_the_same_votes_and_seed_give_the_same_intervals():
    votes = synthetic(150, seed=4)
    assert ranking.rate(votes, sorted(TRUE), "current", resamples=50, seed=9) == ranking.rate(votes, sorted(TRUE), "current", resamples=50, seed=9)


def test_a_thousand_resamples_by_default_and_fast_enough():
    assert ranking.RESAMPLES == 1000
    votes = synthetic(150, seed=5)
    started = time.monotonic()
    ranking.rate(votes, sorted(TRUE), "current")
    assert time.monotonic() - started < 30


def test_unknown_choices_and_anchors_are_refused():
    with pytest.raises(ValueError, match="choice"):
        ranking.outcome("a", "b", "both")
    with pytest.raises(ValueError, match="anchor"):
        ranking.rate([ranking.outcome("a", "b", "left")], ["a", "b"], "current")


def test_no_votes_no_ranking():
    assert ranking.rate([], ["current", "x"], "current") == []


EQUAL5 = {"current": 1.0, "b": 1.0, "c": 1.0, "d": 1.0, "e": 1.0}


def test_h1_is_rarely_declared_when_all_tools_are_equal():
    # Bonferroni over the k challengers keeps the family-wise false H1 rate near 2.5%.
    hits = 0
    for seed in range(200):
        votes = synthetic(150, seed=1000 + seed, strengths=EQUAL5)
        result = ranking.analyse(votes, sorted(EQUAL5), "current", seed=seed)
        assert result["h1"] == bool(result["h1_above"])
        if result["h1"]:
            hits += 1
    assert hits / 200 <= 0.04, hits


def test_h1_is_declared_for_a_clearly_stronger_tool():
    result = ranking.analyse(synthetic(600, seed=11), sorted(TRUE), "current")
    assert result["h1"] is True
    assert result["h1_k"] == 3
    assert result["h1"] == bool(result["h1_above"])
    assert "c" in result["h1_above"] and result["h1_above"] == sorted(result["h1_above"])
    assert "current" not in result["h1_above"]


def test_h1_above_lists_the_challengers_whose_unrounded_lower_bound_clears_the_anchor():
    result = ranking.analyse(synthetic(600, seed=11), sorted(TRUE), "current", resamples=200, seed=3)
    assert result["h1"] == bool(result["h1_above"])
    assert set(result["h1_above"]) <= {"b", "c", "d"}
    assert result["h1_above"] == sorted(result["h1_above"])
    assert ranking.analyse([], ["current", "x"], "current")["h1_above"] == []


def test_h1_lower_bounds_are_per_challenger_and_unrounded_in_the_decision():
    result = ranking.analyse(synthetic(600, seed=11), sorted(TRUE), "current")
    rows = {r["entrant"]: r for r in result["rows"]}
    assert rows["current"]["h1_lower"] is None
    for e in ("b", "c", "d"):
        assert rows[e]["h1_lower"] <= rows[e]["lo"] <= rows[e]["points"]
    assert all(set(r) == {"entrant", "points", "lo", "hi", "h1_lower"} for r in result["rows"])


def test_rate_returns_the_same_rows_as_analyse():
    votes = synthetic(150, seed=6)
    assert ranking.rate(votes, sorted(TRUE), "current", resamples=50, seed=2) == \
        ranking.analyse(votes, sorted(TRUE), "current", resamples=50, seed=2)["rows"]


def test_the_fit_refuses_self_duels_duplicates_and_unknown_entrants():
    with pytest.raises(ValueError, match="self-duel"):
        ranking.outcome("a", "a", "left")
    with pytest.raises(ValueError, match="self-duel"):
        ranking.fit([ranking.Outcome("a", "a", 1.0)], ["a", "b"])
    with pytest.raises(ValueError, match="duplicate"):
        ranking.fit([], ["a", "a", "b"])
    with pytest.raises(ValueError, match="unknown entrant"):
        ranking.fit([ranking.outcome("a", "zz", "left")], ["a", "b"])


def test_a_fit_that_does_not_converge_is_an_error(monkeypatch):
    monkeypatch.setattr(ranking, "MAX_ITERATIONS", 2)
    with pytest.raises(RuntimeError, match="did not converge"):
        ranking.fit(synthetic(150, seed=8), sorted(TRUE))


def test_perfect_separation_stays_finite():
    votes = [ranking.outcome("current", "x", "left") for _ in range(50)]
    est = ranking.points(ranking.fit(votes, ["current", "x"]), "current")
    assert all(math.isfinite(v) for v in est.values())
    assert 0 < est["x"] < 400


def test_ties_recover_the_strengths():
    # Half-wins keep the model exact: measured max error is about 18 points here, 11–13 without ties.
    est = ranking.points(ranking.fit(synthetic(6000, seed=2, tie_share=0.2), sorted(TRUE)), "current")
    for e, want in true_points().items():
        assert abs(est[e] - want) < 25, (e, est[e], want)


def test_analyse_also_returns_the_unrounded_figures():
    outcomes = ([ranking.outcome("a", "b", "left")] * 6 + [ranking.outcome("b", "a", "left")] * 2
                + [ranking.outcome("a", "current", "same")] * 4)
    v = ranking.analyse(outcomes, ["a", "b", "current"], "current", resamples=50, seed=3)
    for row in v["rows"]:
        raw = v["raw"][row["entrant"]]
        assert (round(raw["points"], 1), round(raw["lo"], 1), round(raw["hi"], 1)) == (row["points"], row["lo"], row["hi"])
    assert ranking.analyse([], ["a", "current"], "current")["raw"] == {}
