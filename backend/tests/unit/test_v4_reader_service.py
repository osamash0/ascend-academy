"""Explain answers are model output: only shapes the panel can draw get through."""
from uuid import UUID

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
