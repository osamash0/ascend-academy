"""Everything Luna says is checked against the Lesson before anyone sees it."""
from backend.services.luna.validate import (
    PageIndex, validate_check, validate_memory_line, validate_move, validate_plan, validate_turn, validate_wrap,
)

L = "11111111-1111-1111-1111-111111111111"
PAGES = PageIndex(
    totals={L: 12},
    texts={(L, 4): "X → Y holds if any two rows that agree on X also agree on Y.", (L, 5): "Second normal form"},
)


def test_plan_keeps_valid_steps_numbers_them_and_needs_three():
    raw = {"steps": [
        {"kind": "look", "title": "What an FD says", "page": 4},
        {"kind": "explain", "title": "Why it matters", "page": 4},
        {"kind": "fly", "title": "bad kind", "page": 4},
        {"kind": "check", "title": "Out of range", "page": 99},
        {"kind": "check", "title": "Check yourself", "page": 5},
    ]}
    plan = validate_plan(raw, lecture_id=L, pages=PAGES)
    assert [s["id"] for s in plan] == ["s1", "s2", "s3"]
    assert [s["kind"] for s in plan] == ["look", "explain", "check"]
    assert all(s["status"] == "todo" and s["target"] == {"lecture_id": L, "page": s["target"]["page"]} for s in plan)
    assert validate_plan({"steps": raw["steps"][:2]}, lecture_id=L, pages=PAGES) is None
    assert validate_plan("nonsense", lecture_id=L, pages=PAGES) is None


def test_plan_stops_at_five():
    raw = {"steps": [{"kind": "look", "title": f"Step {i}", "page": 4} for i in range(8)]}
    assert len(validate_plan(raw, lecture_id=L, pages=PAGES)) == 5


def test_move_drops_missing_pages_and_spots_not_on_the_page():
    assert validate_move({"lecture_id": L, "page": 40}, pages=PAGES) is None
    assert validate_move({"lecture_id": L, "page": 4, "spot": "agree on X"}, pages=PAGES) == {
        "lecture_id": L, "page": 4, "spot": "agree on X"}
    assert validate_move({"lecture_id": L, "page": 4, "spot": "words not there"}, pages=PAGES) == {
        "lecture_id": L, "page": 4}
    assert validate_move({"lecture_id": L, "page": 6, "spot": "anything"}, pages=PAGES) == {"lecture_id": L, "page": 6}


def test_check_needs_exactly_one_correct_option():
    good = {"question": "Does it hold?", "options": [{"text": "Yes", "why": "a"}, {"text": "No", "correct": True, "why": "b"}]}
    assert validate_check(good)["options"][1]["correct"] is True
    two = {"question": "Q", "options": [{"text": "A", "correct": True}, {"text": "B", "correct": True}]}
    assert validate_check(two) is None
    assert validate_check({"question": "Q", "options": [{"text": "A", "correct": True}]}) is None


def test_turn_falls_back_to_what_survives():
    raw = {
        "say": "This line is the whole idea.",
        "move": {"lecture_id": L, "page": 4, "spot": "agree on X"},
        "blocks": [{"type": "key", "md": "If X matches, Y matches."}, {"type": "unknown"}],
        "check": {"question": "Q", "options": [{"text": "A"}]},
        "step_done": True,
    }
    turn = validate_turn(raw, pages=PAGES)
    assert turn["say"] == "This line is the whole idea."
    assert turn["move"]["spot"] == "agree on X"
    assert [b["type"] for b in turn["blocks"]] == ["key"]
    assert turn["check"] is None and turn["step_done"] is True and turn["offer_wrap"] is False
    assert validate_turn({"say": "  "}, pages=PAGES) is None
    assert validate_turn(None, pages=PAGES) is None


def test_memory_lines_are_short_plain_and_never_grades():
    assert validate_memory_line({"kind": "preference", "text": "examples before definitions"}) == {
        "kind": "preference", "space_scoped": False, "text": "examples before definitions"}
    assert validate_memory_line({"kind": "shaky", "text": "outer joins"})["space_scoped"] is True
    for bad in ("scored 45% on joins", "got 3/10 on the quiz", "grade: B", "mail me at a@b.de", "call +49 170 1234567"):
        assert validate_memory_line({"kind": "shaky", "text": bad}) is None, bad
    assert validate_memory_line({"kind": "shaky", "text": "x" * 81}) is None
    assert validate_memory_line({"kind": "mood", "text": "happy"}) is None


def test_wrap_keeps_items_drops_bad_pages_and_unknown_memory_ids():
    raw = {
        "covered": [{"text": "Functional dependencies", "lecture_id": L, "page": 4}],
        "clicked": [{"text": "Reading an FD as a lookup", "lecture_id": L, "page": 99}],
        "shaky": [{"text": "Partial keys in 2NF", "lecture_id": L, "page": 5}],
        "memory_add": [{"kind": "shaky", "text": "partial keys"}, {"kind": "shaky", "text": "scored 2/5"}],
        "memory_retire": ["m1", "not-mine"],
    }
    out = validate_wrap(raw, pages=PAGES, memory_ids={"m1"})
    assert out["wrap"]["clicked"] == [{"text": "Reading an FD as a lookup", "lecture_id": None, "page": None}]
    assert out["wrap"]["covered"][0]["page"] == 4
    assert [m["text"] for m in out["memory_add"]] == ["partial keys"]
    assert out["memory_retire"] == ["m1"]
    assert validate_wrap({"covered": []}, pages=PAGES, memory_ids=set()) is None
