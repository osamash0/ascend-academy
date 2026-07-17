"""Unit tests for backend.services.parser.persist.

Server-authoritative persistence for the unified pipeline. The asyncpg pool is
mocked at ``get_db_connection`` with a fake connection that records every
execute/fetch/fetchval, so no database is touched. We assert the deterministic
logic: the owner-shape validation on create_lecture, the SSE-dict→columns
mapping, the drop-unresolvable-answer quiz rules, deck-quiz anchor resolution,
and the replay reconstruction.
"""
from __future__ import annotations

import json
from uuid import UUID, uuid4

import pytest

from backend.services.parser import persist


class _FakeConn:
    def __init__(self):
        self.calls: list[tuple] = []
        self.fetch_result: list = []
        self.fetchval_result = None

    async def execute(self, query, *args):
        self.calls.append(("execute", query, args))
        return "INSERT 0 1"

    async def fetch(self, query, *args):
        self.calls.append(("fetch", query, args))
        return self.fetch_result

    async def fetchval(self, query, *args):
        self.calls.append(("fetchval", query, args))
        return self.fetchval_result

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def conn(monkeypatch):
    c = _FakeConn()

    async def _get():
        return c

    monkeypatch.setattr(persist, "get_db_connection", _get)
    return c


def _last_execute_args(conn) -> tuple:
    for kind, _q, args in reversed(conn.calls):
        if kind == "execute":
            return args
    raise AssertionError("no execute call recorded")


# ── create_lecture owner-shape validation ────────────────────────────────────

async def test_create_lecture_private_student_requires_owner(conn):
    with pytest.raises(ValueError, match="student_owner_id"):
        await persist.create_lecture(
            title="x", pdf_hash="h", visibility="private_student"
        )


async def test_create_lecture_private_student_forbids_course_id(conn):
    with pytest.raises(ValueError, match="cannot have a course_id"):
        await persist.create_lecture(
            title="x", pdf_hash="h", visibility="private_student",
            student_owner_id=uuid4(), course_id=uuid4(),
        )


async def test_create_lecture_course_path_requires_professor(conn):
    with pytest.raises(ValueError, match="professor_id"):
        await persist.create_lecture(title="x", pdf_hash="h", professor_id=None)


async def test_create_lecture_professor_happy_path_inserts_and_returns_uuid(conn):
    prof = uuid4()
    lid = await persist.create_lecture(
        title="Graphs", pdf_hash="abc", professor_id=prof, course_id=uuid4()
    )
    assert isinstance(lid, UUID)
    args = _last_execute_args(conn)
    assert "Graphs" in args           # title threaded
    assert "abc" in args              # pdf_hash threaded
    assert prof in args               # professor_id threaded


async def test_create_lecture_private_student_happy_path(conn):
    owner = uuid4()
    lid = await persist.create_lecture(
        title="My notes", pdf_hash="h", visibility="private_student",
        student_owner_id=owner,
    )
    assert isinstance(lid, UUID)
    args = _last_execute_args(conn)
    assert owner in args
    assert "private_student" in args


# ── simple update helpers (arg wiring) ───────────────────────────────────────

async def test_finalize_lecture_casts_total_slides_to_int(conn):
    lid = uuid4()
    await persist.finalize_lecture(lid, "desc", total_slides="12")
    _, _q, args = conn.calls[-1]
    assert args == ("desc", 12, lid)  # str "12" coerced to int 12


async def test_finalize_lecture_defaults_empty_description(conn):
    lid = uuid4()
    await persist.finalize_lecture(lid, "", 3)
    _, _q, args = conn.calls[-1]
    assert args[0] == ""


async def test_set_lecture_title_unarchives(conn):
    lid = uuid4()
    await persist.set_lecture_title(lid, "New Title")
    _, q, args = conn.calls[-1]
    assert "is_archived = false" in q
    assert args == ("New Title", lid)


async def test_set_lecture_pdf_url(conn):
    lid = uuid4()
    await persist.set_lecture_pdf_url(lid, "path/to.pdf")
    _, _q, args = conn.calls[-1]
    assert args == ("path/to.pdf", lid)


async def test_set_course_id(conn):
    lid, cid = uuid4(), uuid4()
    await persist.set_course_id(lid, cid)
    _, _q, args = conn.calls[-1]
    assert args == (cid, lid)


async def test_set_run_lecture_links_run_to_lecture(conn):
    run_id, lid = uuid4(), uuid4()
    await persist.set_run_lecture(run_id, lid)
    _, q, args = conn.calls[-1]
    assert "parse_runs" in q
    assert args == (lid, run_id)


async def test_clear_lecture_content_deletes_slides(conn):
    lid = uuid4()
    await persist.clear_lecture_content(lid)
    _, q, args = conn.calls[-1]
    assert "DELETE FROM slides" in q
    assert args == (lid,)


async def test_fetch_regen_instructions_maps_to_zero_based(conn):
    conn.fetch_result = [
        {"slide_number": 1, "regen_instruction": "focus on defs"},
        {"slide_number": 4, "regen_instruction": "add example"},
    ]
    out = await persist.fetch_regen_instructions(uuid4())
    assert out == {0: "focus on defs", 3: "add example"}


# ── insert_slide ─────────────────────────────────────────────────────────────

async def test_insert_slide_maps_sse_dict_to_columns(conn):
    lid = uuid4()
    slide = {
        "title": "Recursion", "content": "body text", "summary": "sum",
        "slide_type": "text", "vision_routed": True, "needs_review": True,
    }
    sid = await persist.insert_slide(lid, 2, slide)
    assert isinstance(sid, UUID)
    args = _last_execute_args(conn)
    assert lid in args
    assert 3 in args                  # slide_number is 1-based (index 2 → 3)
    assert "Recursion" in args
    assert "body text" in args


async def test_insert_slide_title_and_content_fallbacks(conn):
    lid = uuid4()
    # No title → "Slide N"; content_text used when content absent.
    sid = await persist.insert_slide(lid, 0, {"content_text": "from ct"})
    args = _last_execute_args(conn)
    assert "Slide 1" in args
    assert "from ct" in args


# ── _quiz_metadata ───────────────────────────────────────────────────────────

def test_quiz_metadata_only_includes_truthy_keys():
    meta = persist._quiz_metadata(
        {"explanation": "why", "concept": "", "difficulty": "hard", "cognitive_level": None}
    )
    assert meta == {"explanation": "why", "difficulty": "hard"}


def test_quiz_metadata_merges_extra():
    meta = persist._quiz_metadata({"concept": "Trees"}, extra={"is_deck": True})
    assert meta == {"concept": "Trees", "is_deck": True}


# ── insert_slide_quizzes ─────────────────────────────────────────────────────

async def test_insert_slide_quizzes_counts_valid_and_drops_bad(conn):
    questions = [
        {"question": "Q1", "options": ["alpha", "beta", "gamma", "delta"], "correctAnswer": "gamma"},
        "not a dict",  # dropped
        {"question": "Q2", "options": ["a", "b", "c", "d"], "correctAnswer": "ZZZ"},  # unresolvable → dropped
    ]
    n = await persist.insert_slide_quizzes(uuid4(), questions)
    assert n == 1
    # The one valid insert stored the resolved index (2 = "gamma") and JSON options.
    args = _last_execute_args(conn)
    assert 2 in args
    assert any(isinstance(a, str) and a.startswith("[") for a in args)  # json options


async def test_insert_slide_quizzes_empty_returns_zero(conn):
    assert await persist.insert_slide_quizzes(uuid4(), []) == 0


# ── insert_deck_quizzes ──────────────────────────────────────────────────────

async def test_insert_deck_quizzes_empty_slide_map_returns_zero(conn):
    assert await persist.insert_deck_quizzes(uuid4(), {}, [{"question": "Q"}]) == 0


async def test_insert_deck_quizzes_anchors_to_first_linked_slide(conn):
    sid0, sid1, sid2 = uuid4(), uuid4(), uuid4()
    slide_db_ids = {0: sid0, 1: sid1, 2: sid2}
    deck = [{
        "question": "Q", "options": ["alpha", "beta", "gamma", "delta"],
        "correctAnswer": "beta", "linked_slides": [2, 1],
    }]
    n = await persist.insert_deck_quizzes(uuid4(), slide_db_ids, deck)
    assert n == 1
    args = _last_execute_args(conn)
    assert sid1 in args               # first linked index present in the map = 1 → sid1
    # metadata carries linked_slides + is_deck
    meta = json.loads([a for a in args if isinstance(a, str) and '"is_deck"' in a][0])
    assert meta["is_deck"] is True
    assert meta["linked_slides"] == [1, 2]  # coerced + sorted


async def test_insert_deck_quizzes_falls_back_to_min_slide(conn):
    sid5 = uuid4()
    slide_db_ids = {5: sid5}
    deck = [{
        "question": "Q", "options": ["alpha", "beta", "gamma", "delta"],
        "correctAnswer": "alpha", "linked_slides": [99],  # not in map
    }]
    await persist.insert_deck_quizzes(uuid4(), slide_db_ids, deck)
    args = _last_execute_args(conn)
    assert sid5 in args               # fallback = min(slide_db_ids) = 5


async def test_insert_deck_quizzes_carries_source_lecture_tags(conn):
    sid0 = uuid4()
    deck = [{
        "question": "Q", "options": ["alpha", "beta", "gamma", "delta"],
        "correctAnswer": "gamma", "linked_slides": [0],
        "source_lecture_id": "L1", "source_lecture_title": "Prior Lecture",
    }]
    await persist.insert_deck_quizzes(uuid4(), {0: sid0}, deck)
    args = _last_execute_args(conn)
    meta = json.loads([a for a in args if isinstance(a, str) and "source_lecture_id" in a][0])
    assert meta["source_lecture_id"] == "L1"
    assert meta["source_lecture_title"] == "Prior Lecture"


async def test_insert_deck_quizzes_drops_unresolvable(conn):
    sid0 = uuid4()
    deck = [{"question": "Q", "options": ["a", "b", "c", "d"], "correctAnswer": "ZZZ"}]
    assert await persist.insert_deck_quizzes(uuid4(), {0: sid0}, deck) == 0


async def test_insert_deck_quizzes_skips_non_dict_entries(conn):
    sid0 = uuid4()
    deck = ["not a dict", None]
    assert await persist.insert_deck_quizzes(uuid4(), {0: sid0}, deck) == 0


# ── fetch_lecture_for_replay ─────────────────────────────────────────────────

async def test_fetch_lecture_for_replay_reconstructs_slides_and_quizzes(conn):
    conn.fetch_result = [
        {"slide_number": 1, "title": "S1", "content_text": "c1", "summary": "sum1",
         "slide_type": "text", "question_text": "Q1?", "options": '["a","b","c","d"]',
         "correct_answer": 0, "metadata": {}},
        {"slide_number": 1, "title": "S1", "content_text": "c1", "summary": "sum1",
         "slide_type": "text", "question_text": None, "options": None,
         "correct_answer": None, "metadata": None},
        {"slide_number": 2, "title": "S2", "content_text": "c2", "summary": "",
         "slide_type": "text", "question_text": "Q2?", "options": ["x", "y", "z", "w"],
         "correct_answer": 3, "metadata": {}},
    ]
    conn.fetchval_result = "Deck description"
    out = await persist.fetch_lecture_for_replay(uuid4())
    assert out["deck_summary"] == "Deck description"
    assert [s["index"] for s in out["slides"]] == [0, 1]  # slide_numbers 1,2 → 0-based
    s1 = out["slides"][0]
    assert s1["title"] == "S1"
    assert len(s1["questions"]) == 1                       # None question row skipped
    assert s1["questions"][0]["options"] == ["a", "b", "c", "d"]  # JSON string decoded
    s2 = out["slides"][1]
    assert s2["questions"][0]["options"] == ["x", "y", "z", "w"]  # already a list


async def test_fetch_lecture_for_replay_handles_bad_options_json(conn):
    conn.fetch_result = [
        {"slide_number": 1, "title": "S1", "content_text": "c", "summary": "",
         "slide_type": "text", "question_text": "Q?", "options": "{not json",
         "correct_answer": 0, "metadata": {}},
    ]
    conn.fetchval_result = None
    out = await persist.fetch_lecture_for_replay(uuid4())
    assert out["slides"][0]["questions"][0]["options"] == []  # bad JSON → []
    assert out["deck_summary"] == ""                          # None description → ""
