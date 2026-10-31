"""Explain answers are model output: only shapes the panel can draw get through."""
from uuid import UUID

import pytest

from backend.services.v4_reader_service import _Idea, _ideas_to_concepts, _storage_path, validate_answer

LECTURE = UUID("35e5687b-6469-4385-ad04-1fb5ca44b920")


def test_keeps_valid_blocks_and_drops_broken_ones():
    answer = validate_answer(
        {
            "title": "X⁺ is everything X decides",
            "format": "A calculator",
            "blocks": [
                {"type": "text", "md": "Start with X."},
                {"type": "closure", "title": "c", "attrs": ["A", "B", "C"], "fds": [{"lhs": ["A"], "rhs": ["B"]}], "start": ["A"]},
                {"type": "closure", "title": "bad", "attrs": ["A"], "fds": [{"lhs": ["A"], "rhs": ["Z"]}], "start": ["A"]},
                {"type": "check", "question": "q", "options": [{"text": "a", "why": "w"}, {"text": "b", "why": "w"}]},
                {"type": "video", "url": "x"},
            ],
            "next": ["Why?", "", "How?", "More?", "Too many"],
        }
    )
    assert answer is not None
    assert [b["type"] for b in answer["blocks"]] == ["text", "closure"]
    assert answer["next"] == ["Why?", "How?", "More?"]


def test_fd_table_rows_must_fit_the_columns():
    table = {
        "type": "fdTable", "title": "t", "columns": ["A", "B"], "rows": [["1", "2"], ["1"]],
        "fd": {"lhs": ["A"], "rhs": ["B"]}, "prompt": "p",
    }
    assert validate_answer({"title": "t", "blocks": [table]}) is None


def test_nothing_usable_is_none():
    assert validate_answer({"title": "", "blocks": [{"type": "text", "md": "x"}]}) is None
    assert validate_answer("not json") is None


def test_ideas_become_contiguous_ranges_starting_at_page_one():
    concepts = _ideas_to_concepts(
        [_Idea(name="Keys", first_page=30), _Idea(name="FDs", first_page=3), _Idea(name="Beyond", first_page=99)],
        total=40,
        lecture_id=LECTURE,
    )
    assert [c["name"] for c in concepts] == ["FDs", "Keys"]
    assert concepts[0]["slide_indices"][0] == 0  # the first idea absorbs the opening pages
    assert concepts[0]["slide_indices"][-1] == 28
    assert concepts[1]["slide_indices"] == list(range(29, 40))


def test_storage_path_accepts_both_stored_forms():
    assert _storage_path("lectures/u/03 DBS Normalization.pdf") == "lectures/u/03 DBS Normalization.pdf"
    assert _storage_path("https://x.supabase.co/storage/v1/object/public/lecture-pdfs/lectures/u/f.pdf") == "lectures/u/f.pdf"


SANDBOX = {"type": "sandbox", "title": "B+-tree", "html": "<div id=t></div>", "css": "", "js": "document.getElementById('t').textContent='ok'"}


def test_a_generated_app_is_kept_once_per_answer():
    answer = validate_answer({"title": "t", "blocks": [SANDBOX, SANDBOX, {"type": "text", "md": "x"}]})
    assert [b["type"] for b in answer["blocks"]] == ["sandbox", "text"]


def test_a_generated_app_that_reaches_out_is_dropped():
    for js in [
        "fetch('/api/x')",
        "new XMLHttpRequest()",
        "window.parent.document.body",
        "document.cookie",
        "localStorage.getItem('k')",
        "eval('1')",
        "img.src='https://evil.example/x'",
    ]:
        assert validate_answer({"title": "t", "blocks": [dict(SANDBOX, js=js)]}) is None, js
    assert validate_answer({"title": "t", "blocks": [dict(SANDBOX, html='<script src="x.js"></script>')]}) is None


def test_a_format_made_of_block_names_gets_a_human_label():
    blocks = [{"type": "key", "md": "x"}, {"type": "compare", "columns": [{"title": "a", "points": ["p"]}, {"title": "b", "points": ["q"]}]}]
    assert validate_answer({"title": "t", "format": "key, compare, check", "blocks": blocks})["format"] == "Side by side"
    assert validate_answer({"title": "t", "format": "A table you can break", "blocks": blocks})["format"] == "A table you can break"


@pytest.mark.parametrize("label", ["key block", "KeyBlock", "key_blocks", "KEY-BLOCK", "text block and key blocks"])
def test_schema_format_variants_are_not_shown_to_the_learner(label):
    answer = validate_answer({"title": "Venue", "format": label, "blocks": [{"type": "key", "md": "The lecture is in HS B."}]})
    assert answer["format"] == "In one line"


def test_a_human_format_with_the_word_key_is_preserved():
    answer = validate_answer({"title": "Venue", "format": "A key distinction", "blocks": [{"type": "key", "md": "Offices and lecture halls differ."}]})
    assert answer["format"] == "A key distinction"


def test_a_longer_deck_is_split_into_more_ideas_named_by_what_they_teach():
    from backend.services.v4_reader_service import idea_count, ideas_prompt

    assert idea_count(12) == 3
    assert idea_count(82) == 9
    assert idea_count(400) == 12
    prompt = ideas_prompt("Normalization", 82, "1. Title")
    assert "about 9 consecutive ideas (between 7 and 11)" in prompt
    assert "Never a vague name" in prompt


def test_the_answer_follows_the_reader_and_keeps_the_slides_words():
    from backend.services.v4_reader_service import write_in

    assert write_in("en", "en") == "Write in English."
    # German always carries the product's register: du, never Sie.
    assert write_in("de", "de").startswith("Write in German.") and "never Sie" in write_in("de", "de")
    assert "never Sie" not in write_in("en", "de")
    mixed = write_in("de", "en")
    # A German reader on an English deck: German answers, English terms and spots.
    # A German reader on an English deck: all German, but the terms named once and the spots verbatim.
    assert mixed.startswith("Write everything in German")
    assert "options" in mixed and "never for everyday words" in mixed and "word for word from the slide, in English" in mixed
