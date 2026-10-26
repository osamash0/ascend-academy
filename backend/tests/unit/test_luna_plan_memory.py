from datetime import datetime, timedelta

from backend.services.luna.memory import choose_retirements
from backend.services.luna.plan import advance, apply_action, current_step, ensure_current, fallback_plan, is_last

L = "11111111-1111-1111-1111-111111111111"


def _plan():
    return [{"id": f"s{i}", "kind": "look", "title": f"Step {i}", "target": {"lecture_id": L, "page": i}, "status": "todo"}
            for i in (1, 2, 3)]


def test_accepting_lights_the_first_step_and_advancing_moves_on():
    plan = apply_action(_plan(), "accept_plan", None)
    assert [s["status"] for s in plan] == ["current", "todo", "todo"]
    plan = advance(plan)
    assert [s["status"] for s in plan] == ["done", "current", "todo"]
    plan = apply_action(plan, "skip_step", None)
    assert [s["status"] for s in plan] == ["done", "skipped", "current"]
    assert is_last(plan, current_step(plan))
    assert current_step(advance(plan)) is None


def test_editing_reorders_and_renames_only_open_steps():
    plan = ensure_current(_plan())
    edited = apply_action(plan, "edit_plan", [{"id": "s3", "title": "Fix one"}, {"id": "s1"}, {"id": "zz"}])
    assert [(s["id"], s["title"], s["status"]) for s in edited] == [("s3", "Fix one", "current"), ("s1", "Step 1", "todo")]
    assert apply_action(plan, "edit_plan", [{"id": "nope"}]) == plan


def test_fallback_plan_never_fails():
    plan = fallback_plan(L, page=7, total=10)
    assert [s["kind"] for s in plan] == ["look", "explain", "check"]
    assert all(s["target"]["page"] == 7 for s in plan)
    assert fallback_plan(L, page=99, total=10)[0]["target"]["page"] == 10


def test_memory_retires_what_was_asked_then_the_oldest_to_fit_the_cap():
    now = datetime(2026, 10, 24)
    active = [{"id": f"m{i}", "updated_at": now - timedelta(days=i)} for i in range(20)]
    assert choose_retirements(active, 0, []) == []
    assert choose_retirements(active, 2, ["m0", "unknown"]) == ["m0", "m19"]
    assert choose_retirements(active[:5], 3, []) == []


def test_fallback_plan_titles_follow_the_locale():
    assert fallback_plan(L, page=7, total=10, locale="de")[0]["title"] == "Diese Seite"


CONTENT = "A functional dependency X → Y holds when any two rows that agree on X also agree on Y. " * 3


def test_fallback_plan_skips_a_title_slide_and_spreads_over_content_pages():
    texts = {1: "Datenbanksysteme", 2: CONTENT, 3: CONTENT + CONTENT, 4: CONTENT, 5: "Fragen?"}
    plan = fallback_plan(L, page=1, total=10, texts=texts)
    assert [s["kind"] for s in plan] == ["look", "explain", "check"]
    assert [s["target"]["page"] for s in plan] == [2, 3, 4]


def test_fallback_plan_starts_at_the_learners_page_when_it_has_content():
    texts = {6: "short", 7: CONTENT, 8: "", 9: CONTENT + CONTENT, 10: CONTENT + "x"}
    plan = fallback_plan(L, page=7, total=10, locale="de", texts=texts)
    assert [s["target"]["page"] for s in plan] == [7, 9, 10]
    assert plan[0]["title"] == "Diese Seite"


def test_fallback_plan_reuses_pages_when_too_few_and_keeps_near_empty_ones_if_nothing_else():
    assert [s["target"]["page"] for s in fallback_plan(L, page=3, total=10, texts={3: CONTENT, 4: CONTENT})] == [3, 4, 4]
    assert [s["target"]["page"] for s in fallback_plan(L, page=3, total=10, texts={3: "Hi", 4: "Agenda"})] == [3, 4, 4]
