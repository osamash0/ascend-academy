import pytest
from hypothesis import given, settings

from backend.services.parser.deck_plan import SlideRole, build_deck_skeleton, classify_role
from backend.tests.support.deck_strategies import decks

LONG = "Relational algebra defines selection, projection and join over sets of tuples in detail."


@pytest.mark.parametrize("index,text,role", [
    (0, "Datenbanksysteme\nWS 2026", SlideRole.TITLE),
    (3, "", SlideRole.EMPTY),
    (3, "Agenda\n1. Intro\n2. SQL", SlideRole.AGENDA),
    (3, "Gliederung\nTeil A", SlideRole.AGENDA),
    (3, "Übung 2\n" + LONG, SlideRole.EXERCISE),
    (3, "Exercise: normalize this schema\n" + LONG, SlideRole.EXERCISE),
    (3, "Zusammenfassung\n" + LONG, SlideRole.SUMMARY),
    (3, "Summary\n" + LONG, SlideRole.SUMMARY),
    (3, "Literatur\nElmasri, Navathe", SlideRole.REFERENCES),
    (3, "2. Relationale Algebra", SlideRole.SECTION),
    (3, "Selection\n" + LONG, SlideRole.CONTENT),
])
def test_classify_role(index, text, role):
    assert classify_role(index, text) is role


def test_sections_start_at_dividers_and_partition_the_deck():
    pages = ["Title", "Intro text " + LONG, "1. Basics", LONG, LONG, "2. SQL", LONG]
    sk = build_deck_skeleton(pages)
    assert [(s.title, s.start, s.end) for s in sk.sections] == [
        ("Title", 0, 1), ("1. Basics", 2, 4), ("2. SQL", 5, 6),
    ]
    assert [p.section for p in sk.slides] == [0, 0, 1, 1, 1, 2, 2]


def test_footer_does_not_hide_a_section_divider():
    # Without boilerplate stripping, "1. Basics" plus two footer lines is 3 lines
    # and would read as CONTENT. The divider must be found after stripping.
    footer = "Prof. Dr. Example | Datenbanksysteme\nSeite {n}"
    bodies = ["Title", LONG, "1. Basics", LONG, "2. SQL", LONG]
    pages = [b + "\n" + footer.replace("{n}", str(i + 1)) for i, b in enumerate(bodies)]
    assert [s.start for s in build_deck_skeleton(pages).sections] == [0, 2, 4]


@settings(max_examples=60)
@given(decks())
def test_property_sections_are_a_contiguous_partition(pages):
    sk = build_deck_skeleton(pages)
    covered = [i for s in sk.sections for i in range(s.start, s.end + 1)]
    assert covered == list(range(len(pages)))
    assert all(sk.slides[i].section == s.index for s in sk.sections for i in range(s.start, s.end + 1))


@settings(max_examples=60)
@given(decks())
def test_property_roles_never_see_boilerplate(pages):
    sk = build_deck_skeleton(pages)
    assert sk.slides[0].role is SlideRole.TITLE
    assert all("Datenbanksysteme" not in p.text for p in sk.slides)


@settings(max_examples=40)
@given(decks(min_pages=6))
def test_metamorphic_appending_a_page_keeps_existing_roles(pages):
    before = build_deck_skeleton(pages)
    after = build_deck_skeleton(pages + [pages[-1]])
    if before.boilerplate == after.boilerplate:
        assert [p.role for p in after.slides[: len(pages)]] == [p.role for p in before.slides]
