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


def test_flags_are_true_only_when_the_model_says_true():
    turn = validate_turn({"say": "ok", "step_done": "false", "offer_wrap": "no"}, pages=PAGES)
    assert turn["step_done"] is False and turn["offer_wrap"] is False
    turn = validate_turn({"say": "ok", "step_done": 1, "offer_wrap": True}, pages=PAGES)
    assert turn["step_done"] is False and turn["offer_wrap"] is True
    check = validate_check({"question": "Q?", "options": [
        {"text": "A", "correct": "false"}, {"text": "B", "correct": "true"}, {"text": "C", "correct": True}]})
    assert [o["correct"] for o in check["options"]] == [False, False, True]


def test_calm_voice_swaps_exclamation_marks_but_leaves_code_and_not_equal_alone():
    from backend.services.luna.validate import calm

    assert calm("Great job! You got it!!") == "Great job. You got it."
    assert calm("Really?!") == "Really?"
    assert calm("Use x != y here, and `!flag` in code!") == "Use x != y here, and `!flag` in code."


def test_turn_and_check_text_never_shout():
    turn = validate_turn({"say": "Nice! Look here.", "check": {"question": "Which one holds!", "options": [
        {"text": "X → Y!", "correct": True, "why": "Right!"}, {"text": "Y → X", "why": "Not quite!"}]}}, pages=PAGES)
    assert turn["say"] == "Nice. Look here."
    assert turn["check"]["question"] == "Which one holds."
    assert [o["text"] for o in turn["check"]["options"]] == ["X → Y.", "Y → X"]
    assert [o["why"] for o in turn["check"]["options"]] == ["Right.", "Not quite."]


def test_wrap_text_loses_page_numbers_and_exclamation_marks():
    raw = {"covered": [
        {"text": "What an FD says (page 4)", "lecture_id": L, "page": 4},
        {"text": "Second normal form, Seite 5", "lecture_id": L, "page": 5},
        {"text": "Partial dependencies [p. 5]!", "lecture_id": L, "page": 5},
        {"text": "Keys (page 3) and closures", "lecture_id": L, "page": 3},
        {"text": "page 4", "lecture_id": L, "page": 4},
    ], "clicked": [{"text": "FDs clicked on page 4!", "lecture_id": L, "page": 4}], "shaky": []}
    wrap = validate_wrap(raw, pages=PAGES, memory_ids=set())["wrap"]
    assert [i["text"] for i in wrap["covered"]] == [
        "What an FD says", "Second normal form", "Partial dependencies", "Keys and closures"]
    assert [i["text"] for i in wrap["clicked"]] == ["FDs clicked"]


def test_german_says_seite_never_folie_and_english_is_untouched():
    from backend.services.luna.validate import calm

    assert calm("Schau auf Folie 31! Die Folien davor auch. FOLIE, folie, Folienansicht", "de") == (
        "Schau auf Seite 31. Die Seiten davor auch. SEITE, seite, Folienansicht")
    assert calm("Folie 31 and Folien", "en") == "Folie 31 and Folien"
    turn = validate_turn({"say": "Sieh dir Folie 31 an.", "check": {"question": "Welche Folien?", "options": [
        {"text": "Folie 4", "correct": True, "why": "Auf der Folie steht es."}, {"text": "Keine", "why": "Folien zählen."}]}},
        pages=PAGES, locale="de")
    assert turn["say"] == "Sieh dir Seite 31 an."
    assert turn["check"]["question"] == "Welche Seiten?"
    assert [o["text"] for o in turn["check"]["options"]] == ["Seite 4", "Keine"]
    assert [o["why"] for o in turn["check"]["options"]] == ["Auf der Seite steht es.", "Seiten zählen."]
    assert validate_turn({"say": "See Folie 31."}, pages=PAGES)["say"] == "See Folie 31."
    raw = {"covered": [{"text": "Die Folien zu FDs", "lecture_id": L, "page": 4},
                       {"text": "Schlüssel, Folie 31", "lecture_id": L, "page": 4}]}
    wrap = validate_wrap(raw, pages=PAGES, memory_ids=set(), locale="de")["wrap"]
    assert [i["text"] for i in wrap["covered"]] == ["Die Seiten zu FDs", "Schlüssel"]
