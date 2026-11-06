import hashlib

import fitz
import pytest

from backend.eval.decks import DECK_DIR
from backend.eval.parser_bench import checks
from backend.tests.unit.parser_bench_fixtures import H, TITLES, W, make_deck


@pytest.fixture(scope="module")
def deck(tmp_path_factory):
    return make_deck(tmp_path_factory.mktemp("deck") / "deck.pdf")


@pytest.fixture(scope="module")
def facts(deck):
    return checks.document_facts(deck)


def check(text, facts, page=3):
    return checks.check_page(text, facts.pages[page], facts)


def test_the_footer_is_boilerplate(facts):
    assert facts.boilerplate == {"lecturer", "softwaretechnik", "#"}


def test_the_title_is_the_largest_line(facts):
    assert checks.title_of(facts.pages[3]) == TITLES[2]


def test_every_field_is_reported_in_order(facts):
    assert tuple(check("x", facts)) == checks.CHECK_FIELDS


def test_raw_extraction_leaks_the_footer_but_loses_no_words(deck, facts):
    with fitz.open(deck) as d:
        raw = d[2].get_text("text")
    r = check(raw, facts)
    assert (r["footer_leaks"], r["title_first"]) == (3, True)
    assert (r["dropped_words_pct"], r["invented_words_pct"]) == (0.0, 0.0)


def test_footer_before_the_title_fails_title_first(facts):
    r = check(f"Lecturer\nSoftwaretechnik\n3\n{TITLES[2]}\n", facts)
    assert (r["title_first"], r["footer_leaks"]) == (False, 3)


@pytest.mark.parametrize("layout", ["Lecturer\nSoftwaretechnik\n3", "Lecturer Softwaretechnik 3", "## Lecturer Softwaretechnik 3"])
def test_a_footer_scores_the_same_whether_its_parts_are_split_or_joined(facts, layout):
    # ruling A.2: footer_leaks counts the page's footer parts found in the output, not output lines
    r = check(f"# {TITLES[2]}\n{layout}\n", facts)
    assert (r["footer_leaks"], r["footer_leaked"]) == (3, True)


@pytest.mark.parametrize(("line", "parts"), [
    ("Lecturer Softwaretechnik", 2),
    ("Softwaretechnik 3", 2),
    ("Lecturer 3", 2),
    ("3", 1),
])
def test_a_merged_footer_line_scores_the_parts_it_holds(facts, line, parts):
    assert check(line, facts)["footer_leaks"] == parts


def test_each_footer_part_counts_once(facts):
    r = check("Lecturer\nLecturer Softwaretechnik\nLecturer\n3\n3", facts)
    assert r["footer_leaks"] == 3


def test_a_page_without_footer_parts_leaks_nothing():
    lines = [checks.Line("Welcome", 28.0, 100.0, 130.0), checks.Line("body text", 14.0, 200.0, 214.0)]
    pf = checks.PageFacts(1, 595.0, lines, 14.0)
    doc = checks.DocFacts({1: pf}, frozenset({"lecturer"}), frozenset({"lecturer"}))
    assert checks.is_footer_line("Lecturer", pf, doc)  # the output line looks like the deck's footer ...
    r = checks.check_page("Welcome\nLecturer\n", pf, doc)
    assert (r["footer_leaks"], r["footer_leaked"]) == (0, False)  # ... but this page has none to leak


def test_a_year_is_not_a_page_number(facts):
    assert check("Sommerville\n2016\n", facts)["footer_leaks"] == 0


def test_clean_markdown_scores_clean(facts):
    md = (
        f"# {TITLES[2]}\n\n"
        "- First point about merge conflicts continues here in lower case\n"
        "- Second point.\n"
    )
    r = check(md, facts)
    assert (r["footer_leaks"], r["footer_leaked"], r["title_first"], r["headings"], r["list_items"], r["max_depth"]) == (0, False, True, 1, 2, 1)
    # ruling A.4: no line break inside running text is "not measured" (None), not "nothing broken" (0.0)
    assert (r["line_breaks"], r["broken_lines"], r["broken_line_pct"]) == (0, 0, None)
    assert (r["dropped_words_pct"], r["invented_words_pct"]) == (0.0, 0.0)


def test_a_line_broken_mid_sentence(facts):
    r = check("Software\nengineering is fun.", facts)
    assert (r["line_breaks"], r["broken_lines"], r["broken_line_pct"]) == (1, 1, 100.0)


def test_footer_line_pairs_are_not_line_breaks(facts):
    r = check("Software\nengineering is fun.\nLecturer\nSoftwaretechnik\n3", facts)
    assert (r["line_breaks"], r["broken_lines"], r["broken_line_pct"]) == (1, 1, 100.0)


def test_a_page_with_no_line_breaks_has_no_broken_line_share(facts):
    r = check(f"# {TITLES[2]}", facts)
    assert (r["line_breaks"], r["broken_lines"], r["broken_line_pct"]) == (0, 0, None)


def test_the_checks_have_a_version():
    assert checks.CHECKS_VERSION == 3


def test_the_new_fields_sit_next_to_the_ones_they_qualify():
    f = checks.CHECK_FIELDS
    assert f[f.index("footer_leaks") + 1: f.index("footer_leaks") + 3] == ("footer_leaked", "footer_token_share")
    assert f[f.index("broken_line_pct") + 1: f.index("broken_line_pct") + 3] == ("line_breaks", "broken_lines")


def test_mismapped_symbols_count_only_where_a_symbol_font_put_them():
    pf = checks.PageFacts(1, 595.0, [], 0.0, symbol_chars={"§"})
    doc = checks.DocFacts({1: pf}, frozenset(), frozenset())
    r = checks.check_page("§ Komplexität ®\n§\nnext \uf0a7", pf, doc)
    assert r["wrong_symbols"] == 3  # two § and one private-use glyph; this ® is not from a symbol font
    assert r["lonely_bullets"] == 1
    assert r["title_first"] is None


def test_dropped_and_invented_words(facts):
    r = check(f"# {TITLES[2]}\nbanana banana", facts)
    assert r["dropped_words_pct"] > 50 and r["invented_words_pct"] == 50.0


def test_tables_and_math(facts):
    r = check("| a | b |\n|---|---|\n| 1 | 2 |\n\n$x^2$ and $$y$$", facts)
    assert (r["tables"], r["math_spans"]) == (1, 2)


def test_figure_markers_are_not_the_first_line(facts):
    assert check(f"[figure]\n# {TITLES[2]}", facts)["title_first"] is True


SWT1 = DECK_DIR / "Course SWT" / "Slides" / "1.pdf"


@pytest.mark.skipif(not SWT1.exists(), reason="real SWT deck not available")
def test_real_swt_deck():
    f = checks.document_facts(SWT1)
    assert "softwaretechnik" in f.boilerplate and len(f.boilerplate) >= 2
    assert "§" in f.pages[15].symbol_chars
    # the slide title itself stays out of the public repo; only its SHA-256 is kept
    title = checks.title_of(f.pages[21]) or ""
    assert hashlib.sha256(title.encode("utf-8")).hexdigest() == "9311c1d6051f5403d7f1ef1a52c77d222095a4d9ea4a482839894355db0a769b"


# --- printed slide numbers are not the PDF page index --------------------------------


@pytest.fixture(scope="module")
def offset_deck(tmp_path_factory):
    """Like make_deck, but the printed slide number runs on from a previous lecture part (i + 29)."""
    path = tmp_path_factory.mktemp("offset") / "offset.pdf"
    doc = fitz.open()
    for i in range(1, 7):
        title = TITLES[i - 1]
        page = doc.new_page(width=W, height=H)
        page.insert_text((60, 110), title, fontsize=28)
        page.insert_text((60, 170), f"First point about {title.lower()}", fontsize=16)
        page.insert_text((60, 195), "continues here in lower case", fontsize=16)
        page.insert_text((60, 250), "Second point.", fontsize=16)
        page.insert_text((40, 530), "Lecturer", fontsize=9)
        page.insert_text((380, 530), "Softwaretechnik", fontsize=9)
        page.insert_text((790, 530), str(i + 29), fontsize=9)
    doc.save(path)
    doc.close()
    return path


@pytest.fixture(scope="module")
def offset_facts(offset_deck):
    return checks.document_facts(offset_deck)


def test_printed_numbers_that_differ_from_the_pdf_index(offset_deck, offset_facts):
    assert offset_facts.pages[3].edge_numbers == {"32"}
    with fitz.open(offset_deck) as d:
        raw = d[2].get_text("text")
    r = checks.check_page(raw, offset_facts.pages[3], offset_facts)
    assert r["footer_leaks"] == 3
    assert (r["dropped_words_pct"], r["invented_words_pct"]) == (0.0, 0.0)


def test_a_merged_footer_with_the_printed_number_counts_every_part(offset_facts):
    # ruling A.2: the merged line holds all three parts of this page's footer
    r = checks.check_page("## Lecturer Softwaretechnik 32", offset_facts.pages[3], offset_facts)
    assert r["footer_leaks"] == 3
    r = checks.check_page("Lecturer 32", offset_facts.pages[3], offset_facts)
    assert r["footer_leaks"] == 2


def test_a_number_that_is_not_on_the_page_edge_is_not_a_footer(offset_facts):
    # 3 is the PDF index, but this deck prints 32 there
    r = checks.check_page("Sommerville\n3\n", offset_facts.pages[3], offset_facts)
    assert r["footer_leaks"] == 0


DECK2 = DECK_DIR / "Course SWT" / "Slides" / "2.pdf"


@pytest.mark.skipif(not DECK2.exists(), reason="real SWT deck 2 not available")
@pytest.mark.parametrize("n", [3, 10, 20])
def test_raw_text_of_a_real_deck_is_perfect_by_construction(n):
    f = checks.document_facts(DECK2)
    with fitz.open(DECK2) as d:
        raw = d[n - 1].get_text("text")
    r = checks.check_page(raw, f.pages[n], f)
    assert (r["dropped_words_pct"], r["invented_words_pct"]) == (0.0, 0.0)
    assert r["footer_leaks"] >= 3


# --- figure markers ------------------------------------------------------------------


def test_a_figure_marker_does_not_break_the_next_line(facts):
    # ruling A.4: the only pair is skipped, so there is no break to share out (None, was 0.0)
    r = check("[figure]\nthe diagram shows flow.", facts)
    assert (r["line_breaks"], r["broken_lines"], r["broken_line_pct"]) == (0, 0, None)


def test_an_inline_figure_marker_invents_no_word(facts):
    assert check("Merge Conflicts [figure]", facts)["invented_words_pct"] == 0.0


# --- title first strips heading marks only -------------------------------------------


def test_a_numbered_title_matches_its_heading():
    lines = [checks.Line("2. Test", 28.0, 100.0, 130.0), checks.Line("body one", 14.0, 200.0, 214.0), checks.Line("body two", 14.0, 250.0, 264.0)]
    pf = checks.PageFacts(1, 595.0, lines, 14.0)
    doc = checks.DocFacts({1: pf}, frozenset(), frozenset())
    assert checks.check_page("# 2. Test\n", pf, doc)["title_first"] is True


# --- checks v3: a footer part split across lines still leaks ------------------------


def multi_token_footer():
    """One edge line holds a three-word footer, as real decks often print it."""
    foot = "Software Engineering Lecturer"
    lines = [
        checks.Line("Welcome", 28.0, 100.0, 130.0),
        checks.Line("body text here", 14.0, 200.0, 214.0),
        checks.Line(foot, 9.0, 520.0, 530.0),
    ]
    pf = checks.PageFacts(1, 595.0, lines, 14.0)
    doc = checks.DocFacts({1: pf}, frozenset({checks.norm_line(foot)}), frozenset({"software", "engineering", "lecturer"}))
    return pf, doc


def test_a_footer_part_split_across_two_lines_still_leaks():
    pf, doc = multi_token_footer()
    r = checks.check_page("Welcome\nSoftware Engineering\nLecturer\n", pf, doc)
    assert (r["footer_leaks"], r["footer_leaked"], r["footer_token_share"]) == (1, True, 1.0)  # v2 counted 0


def test_a_footer_cut_short_shows_in_the_token_share():
    pf, doc = multi_token_footer()
    r = checks.check_page("Welcome\nSoftware Engineering\n", pf, doc)
    assert (r["footer_leaks"], r["footer_leaked"], r["footer_token_share"]) == (0, False, 0.667)


@pytest.mark.parametrize(("text", "share"), [
    ("Lecturer\nSoftwaretechnik\n3", 1.0),
    ("Lecturer Softwaretechnik", 0.667),
    (f"# {TITLES[2]}\nbody", 0.0),
])
def test_the_footer_token_share_on_the_deck(facts, text, share):
    assert check(text, facts)["footer_token_share"] == share


def test_a_page_without_footer_parts_has_no_token_share():
    lines = [checks.Line("Welcome", 28.0, 100.0, 130.0)]
    pf = checks.PageFacts(1, 595.0, lines, 14.0)
    doc = checks.DocFacts({1: pf}, frozenset(), frozenset())
    assert checks.check_page("Welcome", pf, doc)["footer_token_share"] is None


def test_a_list_item_after_running_text_is_not_a_line_break(facts):
    r = check("The steps are\n- commit your work", facts)
    assert (r["line_breaks"], r["broken_lines"], r["broken_line_pct"]) == (0, 0, None)


def test_footer_line_numbers_name_the_lines_the_viewer_marks(facts):
    text = f"# {TITLES[2]}\nbody line\nLecturer Softwaretechnik 3\n3"
    assert checks.footer_line_numbers(text, facts.pages[3], facts) == [2, 3]
