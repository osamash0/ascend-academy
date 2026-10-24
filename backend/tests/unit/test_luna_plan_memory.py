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
