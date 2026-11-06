import json

import pytest

from backend.eval.parser_bench import pageset, sources
from backend.tests.unit.parser_bench_fixtures import TITLES, make_deck

TYPES = pageset.PAGE_TYPES


@pytest.fixture
def decks(tmp_path):
    """Every benchmark source file, as a synthetic deck at its real relative path."""
    for source in sources.BENCHMARK_SOURCES:
        for path in source.paths(tmp_path):
            path.parent.mkdir(parents=True, exist_ok=True)
            make_deck(path, n=8)
    return tmp_path


def chosen_for_all():
    return {
        s.id: [{"file": s.files[0], "page": n, "type": TYPES[n % len(TYPES)], "reason": f"structure {n}"} for n in (1, 2, 3, 4)]
        for s in sources.BENCHMARK_SOURCES
    }


def tagged(data):
    for p in data["pages"]:
        p["type"] = p["type"] or "dense_text"
    return data


def test_draw_keeps_the_chosen_pages_and_draws_two_more_per_source(decks):
    data = pageset.draw(chosen_for_all(), seed=7, deck_dir=decks)
    assert data["seed"] == 7 and len(data["pages"]) == 24
    swt = [p for p in data["pages"] if p["source"] == "swt"]
    assert [p["page"] for p in swt[:4]] == [1, 2, 3, 4] and all(p["how"] == "chosen" for p in swt[:4])
    assert [p["how"] for p in swt[4:]] == ["random", "random"] and all(p["type"] is None for p in swt[4:])
    assert {p["key"] for p in swt[:1]} == {"swt-p1"}
    assert {p["key"][:7] for p in data["pages"] if p["source"] == "sheets"} <= {"sheets1", "sheets2"}
    assert all(len(p["sha256"]) == 64 for p in data["pages"])


def test_draw_is_reproducible_and_the_seed_matters(decks):
    def drawn(seed):
        return [(p["file"], p["page"]) for p in pageset.draw(chosen_for_all(), seed=seed, deck_dir=decks)["pages"] if p["how"] == "random"]

    assert drawn(7) == drawn(7)
    assert any(drawn(7) != drawn(s) for s in range(8, 20))


def test_draw_refuses_the_wrong_number_of_chosen_pages_and_untyped_ones(decks):
    picks = chosen_for_all()
    picks["dbs"] = picks["dbs"][:3]
    with pytest.raises(ValueError, match="dbs: 3 chosen"):
        pageset.draw(picks, seed=1, deck_dir=decks)
    picks = chosen_for_all()
    picks["sr"][0]["type"] = "slides"
    with pytest.raises(ValueError, match="type 'slides'"):
        pageset.draw(picks, seed=1, deck_dir=decks)


def test_load_refuses_untagged_drawn_pages_then_accepts_them_tagged(decks, tmp_path):
    data = pageset.draw(chosen_for_all(), seed=7, deck_dir=decks)
    path = pageset.write(data, tmp_path / "pages.json")
    with pytest.raises(ValueError, match="page type None"):
        pageset.load(path)
    pageset.write(tagged(data), path)
    pages = pageset.load(path)
    assert len(pages) == 24 and pageset.seed_of(path) == 7
    sha = pages[0].sha256
    assert pageset.pages_for(sha, pages) == sorted(p.page for p in pages if p.sha256 == sha)
    assert pageset.pages_for("0" * 64, pages) == []
    assert "reason" not in pageset.as_entry(pages[0])


def test_load_or_empty_before_the_protocol_step(tmp_path):
    assert pageset.load_or_empty(tmp_path / "missing.json") == []


def test_validate_names_every_problem(decks, tmp_path):
    data = tagged(pageset.draw(chosen_for_all(), seed=7, deck_dir=decks))
    data["pages"][0]["reason"] = " "
    data["pages"][1]["key"] = data["pages"][2]["key"]
    problems = pageset.validate([pageset.BenchPage(**p) for p in data["pages"]])
    assert any("needs its reason" in p for p in problems) and any("appears twice" in p for p in problems)


def test_describe_lists_every_page_with_its_title(tmp_path):
    rows = pageset.describe(make_deck(tmp_path / "deck.pdf"))
    assert [r["title"] for r in rows] == list(TITLES)
    assert set(rows[0]) == {"page", "title", "lines", "words", "images", "drawings", "symbol_font"}
