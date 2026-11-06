import hashlib
import itertools
import json
from collections import Counter

import pytest

from backend.eval.parser_bench import compare, ranking, results, schedule, store
from backend.tests.unit.parser_bench_compare_fixtures import SESSION, make_comparison, make_pooled, prefer, vote_all

FAST = 60  # bootstrap resamples in tests


@pytest.fixture
def cmp(tmp_path):
    return make_comparison(tmp_path / "data", tmp_path)


def test_the_preferred_tool_ranks_first_and_current_is_1000(cmp, tmp_path):
    vote_all(cmp, prefer("alphatool"))
    data = results.summarize(cmp, resamples=FAST, root=tmp_path / "data")
    top, *_ = data["ranking"]
    assert top["entrant"] == "alphatool" and top["points"] > 1000 and top["wins"] == top["duels"] > 0
    anchor = next(r for r in data["ranking"] if r["entrant"] == "current")
    assert (anchor["points"], anchor["lo"], anchor["hi"]) == (1000.0, 1000.0, 1000.0)
    assert data["votes"] == 10 and data["median_seconds"] == 3.0
    assert data["bootstrap"] == {"resamples": FAST, "seed": 1}


def test_above_anchor_is_the_h1_above_list_from_analyse(cmp, tmp_path):
    vote_all(cmp, prefer("alphatool"))
    data = results.summarize(cmp, resamples=FAST, root=tmp_path / "data")
    active = cmp.active_votes()
    verdict = ranking.analyse([ranking.outcome(v["left"], v["right"], v["choice"]) for v in active.values()],
                              sorted(cmp.meta["entrants"]), cmp.meta["anchor"], resamples=FAST, seed=cmp.meta["seed"])
    assert data["h1"]["above_anchor"] == verdict["h1_above"]
    assert data["h1"]["holds"] == verdict["h1"] == bool(data["h1"]["above_anchor"])
    assert data["h1_k"] == verdict["h1_k"] == 2


def test_self_consistency_counts_repeats_judged_alike(cmp, tmp_path):
    vote_all(cmp, prefer("alphatool"))  # the same tool wins whichever side it is on
    assert results.summarize(cmp, resamples=FAST, root=tmp_path / "data")["self_consistency"] == {"agree": 1, "total": 1, "share": 1.0}


def test_always_left_disagrees_with_itself_on_a_swapped_repeat(tmp_path):
    cmp = make_comparison(tmp_path / "data", tmp_path)
    vote_all(cmp, lambda duel: "left")
    assert results.summarize(cmp, resamples=FAST, root=tmp_path / "data")["self_consistency"]["agree"] == 0


def test_win_rates_by_page_type_and_both_unusable_on_their_own(cmp, tmp_path):
    vote_all(cmp, lambda duel: "both_bad")
    data = results.summarize(cmp, resamples=FAST, root=tmp_path / "data")
    assert all(cell["score"] == 0.5 for by_type in data["win_rate_by_type"].values() for cell in by_type.values())
    assert sum(r["both_bad"] for r in data["ranking"]) == 20  # 10 duels, two sides each


def test_the_check_table_marks_the_reference_bias(cmp, tmp_path):
    table = results.summarize(cmp, resamples=FAST, root=tmp_path / "data")["checks"]
    assert table["current"]["footer_leaks"] > 0 and table["alphatool"]["footer_leaks"] == 0
    assert table["current"]["reference_biased"] and not table["alphatool"]["reference_biased"]
    assert table["current"]["peak_memory_mb"] is None and table["current"]["pages"] == 6


def test_results_are_a_function_of_the_votes(cmp, tmp_path):
    vote_all(cmp)
    root = tmp_path / "data"
    results.write_results(cmp, resamples=FAST, root=root)
    first = (cmp.path / "results.json").read_bytes()
    results.write_results(cmp, resamples=FAST, root=root)
    assert (cmp.path / "results.json").read_bytes() == first
    assert results.current_results(cmp, resamples=FAST, root=root)["votes_digest"] == results.votes_digest(cmp)


def test_stale_results_are_recomputed(cmp, tmp_path):
    root = tmp_path / "data"
    results.write_results(cmp, resamples=FAST, root=root)
    cmp.vote(duel=0, choice="left", seconds=1, session=SESSION)
    assert results.current_results(cmp, resamples=FAST, root=root)["votes"] == 1
    assert json.loads((cmp.path / "results.json").read_text())["votes"] == 1


def test_a_clear_winner_finishes_after_round_one(cmp, tmp_path):
    vote_all(cmp, prefer("alphatool"))
    assert results.advance(cmp, resamples=FAST, root=tmp_path / "data") == {"added": 0, "finished": True}
    assert cmp.meta["status"] == "finished" and (cmp.path / "results.json").exists()


def test_overlapping_leaders_get_round_two_until_the_cap(cmp, tmp_path):
    root = tmp_path / "data"
    assert results.advance(cmp, resamples=FAST, root=root) == {"added": 0, "finished": False}  # nothing judged yet
    rounds = 0
    while cmp.meta["status"] == "judging":
        vote_all(cmp, lambda duel: "same")
        results.advance(cmp, resamples=FAST, root=root)
        rounds += 1
        assert rounds < 30
    m = cmp.meta
    assert m["round2_duels"] == schedule.ROUND2_CAP == 75
    assert all(d["round"] == 2 for d in m["schedule"][10:]) and len(m["schedule"]) == 85


def test_results_written_before_a_round_two_extension_are_not_reused(cmp, tmp_path):
    root = tmp_path / "data"
    vote_all(cmp, lambda duel: "same")
    results.write_results(cmp, resamples=FAST, root=root)
    before = results.current_results(cmp, resamples=FAST, root=root)
    assert before["scheduled"] == 10 and before["rounds"] == 1
    assert results.advance(cmp, resamples=FAST, root=root)["added"] > 0  # the overlapping leaders get round 2
    after = results.current_results(cmp, resamples=FAST, root=root)
    assert after["scheduled"] == len(cmp.meta["schedule"]) > 10
    assert after["rounds"] == 2 and after["round2_duels"] == cmp.meta["round2_duels"] > 0


def test_an_undo_between_summary_and_finish_leaves_the_comparison_judging(cmp, tmp_path, monkeypatch):
    vote_all(cmp, prefer("alphatool"))  # a clear winner: advance would finish here
    real_summarize = results._summarize

    undone = []

    def summarize_then_undo(*args, **kwargs):
        data = real_summarize(*args, **kwargs)
        if not undone:  # once: the first summary, taken before advance's lock
            undone.append(cmp.undo(session=SESSION))  # a vote is withdrawn after the summary was taken
        return data

    monkeypatch.setattr(results, "_summarize", summarize_then_undo)
    assert results.advance(cmp, resamples=FAST, root=tmp_path / "data") == {"added": 0, "finished": False}
    assert cmp.meta["status"] == "judging" and not (cmp.path / "results.json").exists()
    assert cmp.progress() == (9, 10)


def test_advance_on_an_incomplete_comparison_does_not_summarize(cmp, tmp_path, monkeypatch):
    cmp.vote(duel=0, choice="left", seconds=1, session=SESSION)  # one of the scheduled duels is judged
    monkeypatch.setattr(results, "_summarize", lambda *a, **k: pytest.fail("summarize must not run before the round is complete"))
    assert results.advance(cmp, resamples=FAST, root=tmp_path / "data") == {"added": 0, "finished": False}
    assert cmp.meta["status"] == "judging" and not (cmp.path / "results.json").exists()


def fake_verdict(figures):
    """What ranking.analyse returns, built from {entrant: (points, lo, hi)} given unrounded."""
    rows = sorted(({"entrant": e, "points": round(p, 1), "lo": round(lo, 1), "hi": round(hi, 1),
                    "h1_lower": None if e == "current" else round(lo, 1)} for e, (p, lo, hi) in figures.items()),
                  key=lambda r: (-r["points"], r["entrant"]))
    return {"rows": rows, "h1": False, "h1_above": [], "h1_k": len(figures) - 1,
            "raw": {e: {"points": p, "lo": lo, "hi": hi} for e, (p, lo, hi) in figures.items()}}


def test_the_stopping_rule_reads_unrounded_intervals(cmp, tmp_path, monkeypatch):
    vote_all(cmp, prefer("alphatool"))
    fake = fake_verdict({"alphatool": (1100.0, 1050.04, 1150.0), "betatool": (1000.1, 950.0, 1049.96),
                         "current": (1000.0, 1000.0, 1000.0)})
    assert schedule.needs_round2(fake["rows"])  # rounded to 0.1 point, the two would seem to overlap
    monkeypatch.setattr(results.ranking, "analyse", lambda *a, **k: fake)
    assert results.advance(cmp, resamples=FAST, root=tmp_path / "data") == {"added": 0, "finished": True}


# summarize() of the recipe below, computed with Plan 2's code at b417d218, before Plan 3a. Plan 3a must not change
# it: a finished Plan 2 comparison (cmp-2026-10-30_8825 on disk) must recompute to the same results.json.
PLAN2_GOLDEN = "c45ca0747ca631b58eb177029992f126499a505b88f4935e81256b1562463656"


def plan2_digest(tmp_path, monkeypatch) -> str:
    counter = itertools.count()
    monkeypatch.setattr(compare.secrets, "token_hex", lambda n=2: f"{next(counter):0{2 * n}x}")
    monkeypatch.setattr(store, "now_iso", lambda: "2026-10-30T12:00:00+00:00")
    root = tmp_path / "data"
    cmp = make_comparison(root, tmp_path, seed=7)
    while (duel := cmp.next_duel()) is not None:
        cmp.vote(duel=duel["duel"], choice=("left", "right", "same", "both_bad")[duel["duel"] % 4],
                 seconds=1.0 + duel["duel"], session="s-0123456789abcdef")
    cmp.finish()
    data = results.summarize(cmp, resamples=60, root=root)
    data.pop("run_id")  # the comparison id holds today's date
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode("utf-8")).hexdigest()


def test_a_plan2_comparison_summarizes_exactly_as_before(tmp_path, monkeypatch):
    assert plan2_digest(tmp_path, monkeypatch) == PLAN2_GOLDEN


def test_an_export_of_votes_without_notes_keeps_the_results_digest(tmp_path):
    root = tmp_path / "data"
    cmp = make_comparison(root, tmp_path)
    vote_all(cmp)
    cmp.finish()
    data = results.write_results(cmp, resamples=20, root=root)
    out = store.export_run(cmp.run_id, root=root, dest=tmp_path / "export")
    assert hashlib.sha256((out / "votes.jsonl").read_bytes()).hexdigest() == data["votes_digest"]
    report = json.loads((out / "export.json").read_text(encoding="utf-8"))
    assert report == {"votes_digest": data["votes_digest"], "exported_digest": data["votes_digest"], "identical": True,
                      "notes_blanked": 0, "lines_rewritten": 0, "torn_lines_blanked": 0}


PLAN2_KEYS = ["run_id", "status", "votes_digest", "votes", "retracted", "scheduled", "rounds", "round2_duels", "anchor",
              "bootstrap", "ranking", "h1", "h1_k", "self_consistency", "win_rate_by_type", "median_seconds", "checks"]


def test_a_comparison_that_builds_on_none_has_exactly_plan2s_keys(cmp, tmp_path):
    vote_all(cmp)
    assert list(results.summarize(cmp, resamples=FAST, root=tmp_path / "data")) == PLAN2_KEYS


def test_pooled_ratings_use_both_comparisons_votes_and_leave_the_first_alone(tmp_path):
    root = tmp_path / "data"
    base = make_comparison(root, tmp_path)
    vote_all(base, prefer("alphatool"))
    base.finish()
    stored = results.write_results(base, resamples=FAST, root=root)
    before = {n: (base.path / n).read_bytes() for n in ("compare.json", "votes.jsonl", "results.json")}
    pooled = make_pooled(root, tmp_path, base)
    vote_all(pooled, prefer("gammatool"))
    data = results.summarize(pooled, resamples=FAST, root=root)
    assert (data["votes"], data["pooled"]["votes"], data["pooled"]["sources"][base.run_id]["votes"]) == (23, 33, 10)
    assert data["pooled"]["sources"][base.run_id]["votes_digest"] == stored["votes_digest"]
    assert data["pooled"]["sources"][base.run_id]["unlocked_early"] is False
    ranked = [r["entrant"] for r in data["ranking"]]
    assert ranked[0] == "gammatool" and ranked.index("alphatool") < ranked.index("betatool")
    assert next(r for r in data["ranking"] if r["entrant"] == "current")["points"] == 1000.0
    assert data["h1_k"] == 4 and data["sensitivity"]["round1_only"]["votes"] == 33
    alpha = next(r for r in data["ranking"] if r["entrant"] == "alphatool")
    assert sum(c["duels"] for c in data["win_rate_by_type"]["alphatool"].values()) == alpha["duels"]
    assert "vote" not in data["win_rate_by_type"]["alphatool"]
    assert {n: (base.path / n).read_bytes() for n in before} == before
    assert results.current_results(base, resamples=FAST, root=root) == stored


def test_the_round1_only_line_leaves_out_round2_votes():
    votes = [{"left": "a", "right": "current", "choice": "left", "round": 1},
             {"left": "a", "right": "current", "choice": "left", "round": 2}]
    line = results._round1_h1(votes, ["a", "current"], "current", 20, 1)
    assert line["votes"] == 1 and line["h1_k"] == 1 and set(line["h1_lower"]) == {"a"}


def _judged_pooled(root, tmp_path):
    base = make_comparison(root, tmp_path)
    vote_all(base)
    base.finish()
    pooled = make_pooled(root, tmp_path, base)
    vote_all(pooled)
    return pooled


def test_an_added_comparison_ends_when_only_old_methods_overlap_at_the_top(tmp_path, monkeypatch):
    root = tmp_path / "data"
    pooled = _judged_pooled(root, tmp_path)
    fake = fake_verdict({"alphatool": (1100.0, 1040.0, 1160.0), "betatool": (1090.0, 1030.0, 1150.0),
                         "gammatool": (1000.5, 950.0, 1050.0), "deltatool": (990.0, 940.0, 1040.0),
                         "current": (1000.0, 1000.0, 1000.0)})
    monkeypatch.setattr(results.ranking, "analyse", lambda *a, **k: fake)
    assert results.advance(pooled, resamples=FAST, root=root) == {"added": 0, "finished": True}


def test_an_added_comparison_gets_round2_pairs_with_a_new_method_only(tmp_path, monkeypatch):
    root = tmp_path / "data"
    pooled = _judged_pooled(root, tmp_path)
    fake = fake_verdict({"gammatool": (1100.0, 1040.0, 1160.0), "alphatool": (1090.0, 1030.0, 1150.0),
                         "betatool": (1050.0, 1000.0, 1100.0), "deltatool": (1000.2, 950.0, 1050.0),
                         "current": (1000.0, 1000.0, 1000.0)})
    monkeypatch.setattr(results.ranking, "analyse", lambda *a, **k: fake)
    assert results.advance(pooled, resamples=FAST, root=root) == {"added": 6, "finished": False}
    added = pooled.meta["schedule"][23:]
    pairs = Counter(tuple(sorted((d["a"], d["b"]))) for d in added)
    assert pairs == {("alphatool", "gammatool"): 3, ("betatool", "deltatool"): 3}  # not alphatool-betatool


def test_a_pooled_result_is_stale_when_an_earlier_comparisons_log_changes(tmp_path):
    root = tmp_path / "data"
    base = make_comparison(root, tmp_path)
    vote_all(base)
    base.finish()
    pooled = make_pooled(root, tmp_path, base)
    vote_all(pooled)
    first = results.current_results(pooled, resamples=FAST, root=root)
    assert first["pooled"]["sources"][base.run_id]["unlocked_early"] is False
    with base.votes_path.open("ab") as f:  # the earlier log's bytes change (a torn line); the votes do not
        f.write(b'{"torn":')
    again = results.current_results(pooled, resamples=FAST, root=root)
    assert again["pooled"]["sources"][base.run_id]["votes"] == 10
    assert again["pooled"]["sources"][base.run_id]["votes_digest"] != first["pooled"]["sources"][base.run_id]["votes_digest"]
    assert json.loads((pooled.path / "results.json").read_text()) == again


# summarize() of a pooled comparison (the recipe below), computed with Plan 3a's code at 363ae44b, before Plan 3b.
# Plan 3b must not change it: cmp-2026-10-31_04de on disk must recompute to the same results.json.
PLAN3A_POOLED_GOLDEN = "fa22cf97b2bd79f58e158f6f40cef1ed9ed983e3a749d413f20964cc0439142c"


def plan3a_pooled_digest(tmp_path, monkeypatch) -> str:
    counter = itertools.count()
    monkeypatch.setattr(compare.secrets, "token_hex", lambda n=2: f"{next(counter):0{2 * n}x}")
    ids = itertools.count()
    monkeypatch.setattr(compare, "new_compare_id", lambda **k: f"cmp-2026-10-31_{next(ids):04x}")
    monkeypatch.setattr(store, "now_iso", lambda: "2026-10-31T12:00:00+00:00")
    root = tmp_path / "data"
    choices = ("left", "right", "same", "both_bad")
    base = make_comparison(root, tmp_path, seed=7)
    while (duel := base.next_duel()) is not None:
        base.vote(duel=duel["duel"], choice=choices[duel["duel"] % 4], seconds=1.0 + duel["duel"], session=SESSION)
    base.finish()
    pooled = make_pooled(root, tmp_path, base, seed=5)
    while (duel := pooled.next_duel()) is not None:
        pooled.vote(duel=duel["duel"], choice=choices[(duel["duel"] + 1) % 4], seconds=2.0 + duel["duel"],
                    session=SESSION)
    pooled.finish()
    data = results.summarize(pooled, resamples=60, root=root)
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode("utf-8")).hexdigest()


def test_a_plan3a_pooled_comparison_summarizes_exactly_as_before(tmp_path, monkeypatch):
    assert plan3a_pooled_digest(tmp_path, monkeypatch) == PLAN3A_POOLED_GOLDEN


def _judged_third(root, tmp_path):
    base = make_comparison(root, tmp_path)
    vote_all(base)
    base.finish()
    second = make_pooled(root, tmp_path, base)
    vote_all(second)
    second.finish()
    third = make_pooled(root, tmp_path, second, new=("epsilontool", "zetatool"), opponents=("gammatool", "current"))
    vote_all(third)
    return base, second, third


def test_a_third_comparison_rates_all_three_on_one_scale(tmp_path):
    root = tmp_path / "data"
    base, second, third = _judged_third(root, tmp_path)
    data = results.summarize(third, resamples=FAST, root=root)
    assert data["pooled"]["builds_on"] == [base.run_id, second.run_id]
    assert data["pooled"]["opponents"] == ["current", "gammatool"]
    assert (data["votes"], data["pooled"]["votes"]) == (17, 10 + 23 + 17)
    assert len(data["ranking"]) == 7 and data["h1_k"] == 6
    assert next(r for r in data["ranking"] if r["entrant"] == "current")["points"] == 1000.0
    assert data["sensitivity"]["round1_only"]["votes"] == 50


def test_a_third_comparison_without_a_scheduled_top_pair_gets_no_round2(tmp_path, monkeypatch):
    root = tmp_path / "data"
    _, _, third = _judged_third(root, tmp_path)
    fake = fake_verdict({"epsilontool": (1100.0, 1040.0, 1160.0), "alphatool": (1090.0, 1030.0, 1150.0),
                         "gammatool": (1050.0, 1000.0, 1100.0), "zetatool": (1000.2, 950.0, 1050.0),
                         "betatool": (990.0, 940.0, 1040.0), "deltatool": (980.0, 930.0, 1030.0),
                         "current": (1000.0, 1000.0, 1000.0)})
    monkeypatch.setattr(results.ranking, "analyse", lambda *a, **k: fake)
    assert results.advance(third, resamples=FAST, root=root) == {"added": 0, "finished": True}


def test_round2_of_a_third_comparison_adds_only_scheduled_pairs(tmp_path, monkeypatch):
    root = tmp_path / "data"
    _, _, third = _judged_third(root, tmp_path)
    fake = fake_verdict({"epsilontool": (1100.0, 1040.0, 1160.0), "gammatool": (1090.0, 1030.0, 1150.0),
                         "zetatool": (1050.0, 1000.0, 1100.0), "alphatool": (1000.2, 950.0, 1050.0),
                         "betatool": (990.0, 940.0, 1040.0), "deltatool": (980.0, 930.0, 1030.0),
                         "current": (1000.0, 1000.0, 1000.0)})
    monkeypatch.setattr(results.ranking, "analyse", lambda *a, **k: fake)
    assert results.advance(third, resamples=FAST, root=root) == {"added": 6, "finished": False}
    pairs = Counter(tuple(sorted((d["a"], d["b"]))) for d in third.meta["schedule"][17:])
    assert pairs == {("epsilontool", "gammatool"): 3, ("gammatool", "zetatool"): 3}  # not zetatool–alphatool


def test_the_pooled_round1_line_leaves_out_an_earlier_comparisons_round2_votes(tmp_path):
    root = tmp_path / "data"
    base = make_comparison(root, tmp_path)
    vote_all(base)
    pages = [schedule.SchedPage(p["key"], p["type"]) for p in base.meta["pages"]]
    base.extend(schedule.round2_batch(["alphatool", "betatool", "current"], pages, base.meta["schedule"], 1, 1, 75))
    vote_all(base)
    base.finish()
    pooled = make_pooled(root, tmp_path, base)
    vote_all(pooled)
    data = results.summarize(pooled, resamples=FAST, root=root)
    assert data["pooled"]["votes"] == 10 + 6 + 23
    assert data["sensitivity"]["round1_only"]["votes"] == 10 + 23
