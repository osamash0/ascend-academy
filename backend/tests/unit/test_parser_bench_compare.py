import json
import re
import threading
import time

import pytest

from backend.eval.parser_bench import compare, pageset, sources, store
from backend.tests.unit.parser_bench_compare_fixtures import (SESSION, bench_pages_of, make_comparison, make_extract_run, make_pooled,
                                                                    vote_all)
from backend.tests.unit.parser_bench_fixtures import make_deck


@pytest.fixture
def cmp(tmp_path):
    return make_comparison(tmp_path / "data", tmp_path)


def test_a_comparison_is_a_judging_record_with_its_schedule(cmp, tmp_path):
    m = cmp.meta
    assert re.fullmatch(r"cmp-\d{4}-\d{2}-\d{2}_[0-9a-f]{4}", cmp.run_id)
    assert (m["kind"], m["purpose"], m["status"], m["anchor"], m["protocol_commit"]) == ("compare", "benchmark", "judging", "current", "abc123")
    assert sorted(m["entrants"]) == ["alphatool", "betatool", "current"] and len(m["pages"]) == 6
    assert len(m["schedule"]) == 10 and m["seed"] == 1 and m["rounds"] == 1
    assert cmp.votes_path.read_text() == ""
    assert cmp.run_id in [r["run_id"] for r in store.list_runs(tmp_path / "data")]


def test_a_vote_is_one_appended_line_with_the_sides_from_the_schedule(cmp):
    first = cmp.next_duel()
    line = cmp.vote(duel=first["duel"], choice="left", seconds=4.26, session=SESSION, note="  footer twice  ")
    [stored] = [json.loads(x) for x in cmp.votes_path.read_text().splitlines()]
    assert stored == line
    assert (line["left"], line["right"], line["page"], line["seconds"], line["note"]) == (
        first["left"], first["right"], first["page"], 4.3, "footer twice")
    assert cmp.next_duel()["duel"] == first["duel"] + 1 and cmp.progress() == (1, 10)


@pytest.mark.parametrize(("change", "message"), [
    ({"duel": 5}, "not the next duel"),
    ({"choice": "both"}, "choice"),
    ({"session": "abc"}, "session"),
    ({"session": None}, "session"),
    ({"session": 12345}, "session"),
    ({"seconds": -1}, "seconds"),
    ({"seconds": True}, "must be a number"),
    ({"seconds": None}, "must be a number"),
    ({"seconds": "4"}, "must be a number"),
])
def test_a_bad_vote_is_refused_and_writes_nothing(cmp, change, message):
    vote = {"duel": 0, "choice": "left", "seconds": 1.0, "session": SESSION, **change}
    with pytest.raises(ValueError, match=message):
        cmp.vote(**vote)
    assert cmp.votes_path.read_text() == ""


def test_undo_appends_a_retraction_and_the_duel_comes_back(cmp):
    first = cmp.next_duel()
    cmp.vote(duel=first["duel"], choice="right", seconds=2, session=SESSION)
    second = cmp.next_duel()
    cmp.vote(duel=second["duel"], choice="same", seconds=2, session=SESSION)
    retraction = cmp.undo(session=SESSION)
    assert retraction["duel"] == second["duel"] and cmp.next_duel()["duel"] == second["duel"]
    assert [e["type"] for e in cmp.events()] == ["vote", "vote", "retract"]  # nothing deleted
    cmp.vote(duel=second["duel"], choice="left", seconds=2, session=SESSION)
    assert cmp.active_votes()[second["duel"]]["choice"] == "left"
    assert cmp.undo(session=SESSION)["duel"] == second["duel"]
    assert cmp.undo(session=SESSION)["duel"] == first["duel"]
    assert cmp.undo(session=SESSION) is None


def test_an_empty_note_is_stored_as_none(cmp):
    assert cmp.vote(duel=0, choice="same", seconds=1, session=SESSION, note="   ")["note"] is None


def test_a_finished_comparison_refuses_votes_undo_and_round2(cmp):
    vote_all(cmp)
    cmp.finish()
    with pytest.raises(store.RunFinishedError):
        cmp.undo(session=SESSION)
    with pytest.raises(store.RunFinishedError):
        cmp.extend([])
    assert cmp.next_duel() is None and cmp.meta["finished_at"]


def test_the_output_of_an_entrant_for_a_page(cmp, tmp_path):
    assert cmp.output("alphatool", "d-p2", tmp_path / "data").startswith("# alphatool heading 2")
    with pytest.raises(FileNotFoundError):
        cmp.output("alphatool", "nope", tmp_path / "data")


def bench_pages(deck):
    sha = sources.sha256_file(deck)
    return [pageset.BenchPage(f"d-p{n}", "swt", deck.name, sha, n, t, "chosen", "r")
            for n, t in zip(range(1, 7), ("layout", "lists", "table_formula", "diagram", "dense_text", "lists"))]


def test_the_latest_matching_benchmark_run_of_each_tool_is_used(tmp_path):
    root = tmp_path / "data"
    deck = make_deck(tmp_path / "deck.pdf")
    pages = bench_pages(deck)
    make_extract_run(root, "current", deck, purpose="explore")
    make_extract_run(root, "current", deck, commit="old")
    wanted = make_extract_run(root, "current", deck)
    make_extract_run(root, "alphatool", deck, pages=range(1, 4))  # not the page set's pages
    with pytest.raises(ValueError, match="alphatool on deck.pdf"):
        compare.latest_benchmark_runs(["current", "alphatool"], pages, "abc123", root)
    assert compare.latest_benchmark_runs(["current"], pages, "abc123", root) == {"current": {pages[0].sha256: wanted.run_id}}


def test_a_benchmark_comparison_needs_a_committed_protocol(tmp_path):
    with pytest.raises(RuntimeError, match="PROTOCOL.md"):
        compare.create_benchmark(["current"], seed=1, commit=None, pages=[], root=tmp_path)


def test_create_benchmark_schedules_round_one(tmp_path):
    root = tmp_path / "data"
    deck = make_deck(tmp_path / "deck.pdf")
    for tool in ("current", "alphatool", "betatool"):
        make_extract_run(root, tool, deck)
    cmp = compare.create_benchmark(["current", "alphatool", "betatool"], seed=4, commit="abc123", pages=bench_pages(deck), root=root)
    m = cmp.meta
    assert len(m["schedule"]) == 10 and m["seed"] == 4 and "reason" not in m["pages"][0]


def test_a_vote_after_finish_is_refused_and_writes_nothing(cmp):
    vote_all(cmp)
    cmp.finish()
    before = cmp.votes_path.read_text()
    with pytest.raises(store.RunFinishedError):
        cmp.vote(duel=0, choice="left", seconds=1, session=SESSION)
    assert cmp.votes_path.read_text() == before


def test_a_vote_for_a_duel_not_in_the_schedule_is_refused(cmp):
    with pytest.raises(ValueError, match="not in the schedule"):
        cmp.vote(duel=999, choice="left", seconds=1, session=SESSION)
    assert cmp.votes_path.read_text() == ""


def test_a_note_is_truncated_at_note_max(cmp):
    line = cmp.vote(duel=0, choice="same", seconds=1, session=SESSION, note="  " + "x" * (compare.NOTE_MAX + 100))
    assert len(line["note"]) == compare.NOTE_MAX


def test_a_note_with_a_unicode_line_separator_stays_on_its_line(cmp):
    note = "a\u2028b"  # U+2028 LINE SEPARATOR, written as an escape so it stays visible in review
    assert len(note) == 3 and ord(note[1]) == 0x2028
    cmp.vote(duel=0, choice="same", seconds=1, session=SESSION, note=note)
    assert cmp.events()[0]["note"] == note
    assert cmp.active_votes()[0]["note"] == note


def test_a_tear_inside_a_multibyte_character_is_skipped(cmp):
    first = cmp.next_duel()
    with open(cmp.votes_path, "ab") as f:
        f.write(b'{"type": "vote", "note": "\xc3')  # a crash after the lead byte of "ü"
    assert cmp.active_votes() == {} and cmp.progress() == (0, 10)
    assert cmp.next_duel()["duel"] == first["duel"]
    line = cmp.vote(duel=first["duel"], choice="left", seconds=1, session=SESSION, note="ü")
    assert json.loads(cmp.votes_path.read_bytes().rstrip(b"\n").split(b"\n")[-1]) == line
    assert cmp.active_votes()[first["duel"]]["note"] == "ü"


def test_a_torn_last_line_is_ignored_and_the_next_vote_lands_on_its_own_line(cmp):
    first = cmp.next_duel()
    with open(cmp.votes_path, "a", encoding="utf-8") as f:
        f.write('{"type": "vote", "vote_id": "v-dead", "du')  # a crash mid-write, no newline
    assert cmp.active_votes() == {} and cmp.progress() == (0, 10)
    assert cmp.next_duel()["duel"] == first["duel"]
    line = cmp.vote(duel=first["duel"], choice="left", seconds=1, session=SESSION)
    assert cmp.progress() == (1, 10)
    assert json.loads(cmp.votes_path.read_text(encoding="utf-8").splitlines()[-1]) == line
    assert cmp.active_votes()[first["duel"]]["vote_id"] == line["vote_id"]


@pytest.mark.parametrize("junk", ["42", "null", '["vote"]', '{"no": "type"}', '{"type": "bogus"}'])
def test_lines_that_are_not_vote_records_are_skipped(cmp, junk):
    with open(cmp.votes_path, "a", encoding="utf-8") as f:
        f.write(junk + "\n")
    assert cmp.events() == [] and cmp.progress() == (0, 10)


def test_a_second_counting_vote_for_a_duel_never_counts(cmp):
    first = cmp.vote(duel=0, choice="left", seconds=1, session=SESSION)
    dup = dict(first, vote_id="v-dup00001", choice="right")
    with open(cmp.votes_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(dup) + "\n")
    assert cmp.active_votes()[0]["vote_id"] == first["vote_id"]
    assert cmp.undo(session=SESSION)["vote_id"] == first["vote_id"]
    assert cmp.active_votes() == {} and cmp.next_duel()["duel"] == 0


def test_two_posts_of_one_duel_at_once_let_exactly_one_count(cmp, monkeypatch):
    real_now = store.now_iso

    def slow_now() -> str:  # widens the check-then-append window so an unlocked vote() would double-post
        time.sleep(0.2)
        return real_now()

    monkeypatch.setattr(store, "now_iso", slow_now)
    runs = [compare.CompareRun(cmp.path), compare.CompareRun(cmp.path)]
    barrier = threading.Barrier(2)
    results: list = [None, None]

    def post(i: int) -> None:
        barrier.wait()
        try:
            results[i] = runs[i].vote(duel=0, choice="left", seconds=1, session=SESSION)
        except ValueError as exc:
            results[i] = exc

    threads = [threading.Thread(target=post, args=(i,)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    counted = [r for r in results if isinstance(r, dict)]
    refused = [r for r in results if isinstance(r, ValueError)]
    assert len(counted) == 1 and len(refused) == 1
    assert "not the next duel" in str(refused[0])
    assert [e["type"] for e in cmp.events()] == ["vote"]
    monkeypatch.undo()
    assert cmp.undo(session=SESSION)["duel"] == 0
    assert cmp.next_duel()["duel"] == 0


@pytest.mark.parametrize("bad", [None, 12345, b"s-0123456789abcdef"])
def test_undo_refuses_a_session_that_is_not_a_string(cmp, bad):
    cmp.vote(duel=0, choice="left", seconds=1, session=SESSION)
    with pytest.raises(ValueError, match="session"):
        cmp.undo(session=bad)
    assert cmp.progress() == (1, 10)


def test_active_votes_and_digest_come_from_one_read_of_the_log(cmp):
    import hashlib

    vote_all(cmp, lambda duel: "left")
    cmp.undo(session=SESSION)
    active, digest = cmp.active_votes_and_digest()
    assert active == cmp.active_votes()
    assert digest == hashlib.sha256(cmp.votes_path.read_bytes()).hexdigest()


def test_extend_if_and_finish_if_act_only_when_the_guard_holds(cmp):
    duel = cmp.meta["schedule"][0]
    extra = [dict(duel, duel=len(cmp.meta["schedule"]), round=2, repeat_of=None)]
    assert cmp.extend_if(lambda: False, extra) is False
    assert len(cmp.meta["schedule"]) == 10 and cmp.meta["rounds"] == 1
    assert cmp.finish_if(lambda: False) is False and cmp.meta["status"] == "judging"
    assert cmp.extend_if(lambda: True, extra) is True  # the lock is taken once: no nested acquisition
    assert len(cmp.meta["schedule"]) == 11 and cmp.meta["rounds"] == 2 and cmp.meta["round2_duels"] == 1
    assert cmp.finish_if(lambda: True) is True and cmp.meta["status"] == "finished"


def _ticking_clock(monkeypatch):
    """store.now_iso has 1-second resolution; give every call a later time so "newest run" is never a tie."""
    ticks = iter(f"2026-10-30T12:00:{n:02d}+00:00" for n in range(60))
    monkeypatch.setattr(store, "now_iso", lambda: next(ticks))


def test_create_benchmark_refuses_runs_made_with_different_bench_trees(tmp_path, monkeypatch):
    _ticking_clock(monkeypatch)
    root = tmp_path / "data"
    deck = make_deck(tmp_path / "deck.pdf")
    make_extract_run(root, "current", deck)
    make_extract_run(root, "alphatool", deck, tree="t2")
    with pytest.raises(ValueError, match="different bench trees"):
        compare.create_benchmark(["current", "alphatool"], seed=1, commit="abc123", tree="t2", pages=bench_pages(deck), root=root)
    make_extract_run(root, "current", deck, tree="t2")
    cmp = compare.create_benchmark(["current", "alphatool"], seed=1, commit="abc123", tree="t2", pages=bench_pages(deck), root=root)
    assert cmp.meta["bench_tree"] == "t2"
    assert cmp.meta["provenance"]["alphatool"] == {"protocol_commit": "abc123", "bench_tree": "t2"}


def test_create_benchmark_needs_the_gate_tree_to_equal_the_runs_tree(tmp_path):
    root = tmp_path / "data"
    deck = make_deck(tmp_path / "deck.pdf")
    for tool in ("current", "alphatool"):
        make_extract_run(root, tool, deck, tree="t2")
    for wrong in ("t3", None):
        with pytest.raises(ValueError, match="do not match the benchmark's current tree"):
            compare.create_benchmark(["current", "alphatool"], seed=1, commit="abc123", tree=wrong, pages=bench_pages(deck), root=root)
    assert compare.list_comparisons(root) == []


def finished_base(root, tmp_path):
    base = make_comparison(root, tmp_path)
    vote_all(base)
    base.finish()
    return base


def test_a_pooled_comparison_adds_new_methods_against_a_finished_one(tmp_path):
    root = tmp_path / "data"
    base = finished_base(root, tmp_path)
    before = {name: (base.path / name).read_bytes() for name in ("compare.json", "votes.jsonl")}
    pooled = make_pooled(root, tmp_path, base)
    m = pooled.meta
    assert (m["builds_on"], m["new_entrants"], m["anchor"], m["status"]) == ([base.run_id], ["deltatool", "gammatool"], "current", "judging")
    assert all(m["entrants"][t] == base.meta["entrants"][t] for t in ("current", "alphatool", "betatool"))
    first = [d for d in m["schedule"] if d["repeat_of"] is None]
    assert len(first) == 21 and len(m["schedule"]) == 23  # (2 × 3 + 1) pairs × 3, plus round(21 / 9) = 2 repeats
    assert all({d["a"], d["b"]} & {"gammatool", "deltatool"} for d in m["schedule"])
    assert {name: (base.path / name).read_bytes() for name in before} == before


def test_the_earlier_runs_are_kept_by_id_under_their_own_protocol_commit(tmp_path):
    root = tmp_path / "data"
    base = finished_base(root, tmp_path)  # its runs were made under "abc123"
    pooled = make_pooled(root, tmp_path, base, commit="def456")  # the new runs under a later protocol commit
    prov = pooled.meta["provenance"]
    assert prov["alphatool"]["protocol_commit"] == "abc123" and prov["gammatool"]["protocol_commit"] == "def456"
    assert pooled.meta["protocol_commit"] == "def456"


def test_a_pooled_comparison_is_refused_when_it_cannot_share_the_scale(tmp_path):
    root = tmp_path / "data"
    base = make_comparison(root, tmp_path)
    for tool in ("gammatool", "alphatool"):
        make_extract_run(root, tool, tmp_path / "deck.pdf")
    pages = bench_pages_of(base)

    def pooled(tools, *, commit="abc123", using=pages):
        return compare.create_pooled(tools, against=[base.run_id], seed=5, commit=commit, pages=using, root=root)

    with pytest.raises(ValueError, match="not a finished"):
        pooled(["gammatool"])
    vote_all(base)
    base.finish()
    with pytest.raises(ValueError, match="already rated"):
        pooled(["gammatool", "alphatool"])
    with pytest.raises(ValueError, match="other pages"):
        pooled(["gammatool"], using=pages[:5])
    with pytest.raises(ValueError, match="deltatool on deck.pdf"):
        pooled(["deltatool"])
    with pytest.raises(RuntimeError, match="PROTOCOL.md"):
        pooled(["gammatool"], commit=None)


def test_a_legacy_earlier_comparison_is_not_refused_for_lacking_a_tree(tmp_path):
    """The earlier runs (no bench_tree, like the fast methods') keep their own provenance; only the new runs'
    tree must be the benchmark's current tree (M15), and the comparison records that tree."""
    root = tmp_path / "data"
    base = finished_base(root, tmp_path)
    for tool in ("gammatool", "deltatool"):
        make_extract_run(root, tool, tmp_path / "deck.pdf", tree="tree-new")
    pages = bench_pages_of(base)
    pooled = compare.create_pooled(["gammatool", "deltatool"], against=[base.run_id], seed=5, commit="abc123",
                                   tree="tree-new", pages=pages, root=root)
    m = pooled.meta
    assert m["bench_tree"] == "tree-new" and m["provenance"]["alphatool"]["bench_tree"] is None
    assert m["provenance"]["gammatool"]["bench_tree"] == "tree-new" and m["builds_on"] == [base.run_id]
    with pytest.raises(ValueError, match="do not match the benchmark's current tree"):
        compare.create_pooled(["gammatool", "deltatool"], against=[base.run_id], seed=5, commit="abc123",
                              tree="tree-other", pages=pages, root=root)


def test_a_pooled_comparison_refuses_a_builds_on_that_is_still_judging(tmp_path):
    root = tmp_path / "data"
    base = make_comparison(root, tmp_path)  # still judging
    make_extract_run(root, "gammatool", tmp_path / "deck.pdf")
    with pytest.raises(ValueError, match="not a finished"):
        compare.create_pooled(["gammatool"], against=[base.run_id], seed=5, commit="abc123",
                              pages=bench_pages_of(base), root=root)
    assert base.meta["status"] == "judging"


def finished_second(root, tmp_path):
    base = finished_base(root, tmp_path)
    second = make_pooled(root, tmp_path, base)
    vote_all(second)
    second.finish()
    return base, second


def test_a_third_comparison_meets_only_the_chosen_opponents(tmp_path):
    root = tmp_path / "data"
    base, second = finished_second(root, tmp_path)
    before = {c.run_id: {n: (c.path / n).read_bytes() for n in ("compare.json", "votes.jsonl")} for c in (base, second)}
    third = make_pooled(root, tmp_path, second, new=("epsilontool", "zetatool"), opponents=("gammatool", "current"))
    m = third.meta
    assert m["builds_on"] == [base.run_id, second.run_id] and m["opponents"] == ["current", "gammatool"]
    assert m["new_entrants"] == ["epsilontool", "zetatool"] and len(m["entrants"]) == 7
    first = [d for d in m["schedule"] if d["repeat_of"] is None]
    assert len(first) == 15 and len(m["schedule"]) == 17  # (1 + 2 × 2) pairs × 3, plus round(15 / 9) = 2 repeats
    assert {x for d in m["schedule"] for x in (d["a"], d["b"])} == {"epsilontool", "zetatool", "gammatool", "current"}
    assert {c.run_id: {n: (c.path / n).read_bytes() for n in ("compare.json", "votes.jsonl")} for c in (base, second)} == before
    assert "opponents" not in second.meta  # a comparison without opponents keeps Plan 3a's shape


def test_opponents_must_be_methods_already_rated(tmp_path):
    root = tmp_path / "data"
    _, second = finished_second(root, tmp_path)
    make_extract_run(root, "epsilontool", tmp_path / "deck.pdf")

    def third(opponents):
        return compare.create_pooled(["epsilontool"], against=[second.run_id], seed=5, commit="abc123",
                                     pages=bench_pages_of(second), opponents=opponents, root=root)

    with pytest.raises(ValueError, match="opponents must be methods rated in"):
        third(["thetatool"])
    with pytest.raises(ValueError, match="opponents must be methods rated in"):
        third([])
    assert third(["current"]).meta["opponents"] == ["current"]


def test_the_earlier_comparison_is_named_when_its_runs_disagree(tmp_path, monkeypatch):
    root = tmp_path / "data"
    base = finished_base(root, tmp_path)  # recorded no provenance, so create_pooled works it out from the runs
    make_extract_run(root, "gammatool", tmp_path / "deck.pdf")

    def disagree(entrants, root=None):
        raise ValueError(f"{next(iter(entrants))}'s runs were made under different protocol commits or bench trees")

    monkeypatch.setattr(compare, "_provenance", disagree)
    with pytest.raises(ValueError, match=f"^{base.run_id}: "):
        compare.create_pooled(["gammatool"], against=[base.run_id], seed=5, commit="abc123",
                              pages=bench_pages_of(base), root=root)
