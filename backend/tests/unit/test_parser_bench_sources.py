import hashlib

import fitz
import pytest

from backend.eval.parser_bench import normalize, sources
from backend.tests.unit.parser_bench_fixtures import make_deck


def test_sha256_matches_hashlib(tmp_path):
    f = tmp_path / "x.bin"
    f.write_bytes(b"lecture" * 1000)
    assert sources.sha256_file(f) == hashlib.sha256(b"lecture" * 1000).hexdigest()


def test_page_count_and_two_page_sample(tmp_path):
    deck = make_deck(tmp_path / "deck.pdf")
    assert sources.page_count(deck) == 6
    sample = sources.two_page_sample(deck, tmp_path / "warm.pdf")
    assert sources.page_count(sample) == 2
    one = make_deck(tmp_path / "one.pdf", n=1)
    assert sources.page_count(sources.two_page_sample(one, tmp_path / "warm1.pdf")) == 1


def test_render_png_is_a_png(tmp_path):
    png = sources.render_png(make_deck(tmp_path / "deck.pdf"), 3)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


@pytest.mark.parametrize("page", [0, -1, 7])
def test_render_png_refuses_a_page_outside_the_file(tmp_path, page):
    # page 0 used to render the last page (doc[-1]) without a word
    with pytest.raises(ValueError, match="outside"):
        sources.render_png(make_deck(tmp_path / "deck.pdf"), page)


CANDIDATES = [("a.pdf", n) for n in range(1, 21)]


def test_select_pages_is_reproducible_and_keeps_chosen_first():
    chosen = [("a.pdf", 15), ("a.pdf", 3)]
    first = sources.select_pages(CANDIDATES, chosen, 2, seed=20261030)
    assert first == sources.select_pages(CANDIDATES, chosen, 2, seed=20261030)
    assert first[:2] == chosen and len(set(first)) == 4
    assert not set(first[2:]) & set(chosen)


def test_select_pages_refuses_pages_from_elsewhere():
    with pytest.raises(ValueError, match="not in this source"):
        sources.select_pages(CANDIDATES, [("b.pdf", 1)], 2, seed=1)
    with pytest.raises(ValueError, match="only"):
        sources.select_pages(CANDIDATES[:3], [("a.pdf", 1)], 5, seed=1)


def test_benchmark_sources_exclude_the_demo_deck():
    ids = [s.id for s in sources.BENCHMARK_SOURCES]
    assert ids == ["swt", "dbs", "sr", "sheets"]
    files = [f for s in sources.BENCHMARK_SOURCES for f in s.files]
    assert "Course SWT/Slides/1.pdf" not in files


def test_candidates_cover_every_file_of_a_source(tmp_path):
    make_deck(tmp_path / "s1.pdf", n=2)
    make_deck(tmp_path / "s2.pdf", n=3)
    src = sources.Source("sheets", "two files", ("s1.pdf", "s2.pdf"))
    assert sources.candidates_of(src, tmp_path) == [("s1.pdf", 1), ("s1.pdf", 2), ("s2.pdf", 1), ("s2.pdf", 2), ("s2.pdf", 3)]


@pytest.mark.parametrize("raw", ["![logo](img/1.png)", '<img src="a.png" alt="x">', "<!-- image -->"])
def test_every_image_becomes_a_figure_marker(raw):
    assert normalize.normalize_figures(f"Title\n{raw}\nText") == "Title\n[figure]\nText"
