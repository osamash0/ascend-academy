"""The plan as state: which step is lit, and what an action does to it."""
from __future__ import annotations

from typing import Optional

from backend.services.luna.validate import MAX_STEPS


def _copy(plan: list[dict]) -> list[dict]:
    return [dict(s) for s in plan]


def current_step(plan: list[dict]) -> Optional[dict]:
    return next((s for s in plan if s["status"] == "current"), None)


def is_last(plan: list[dict], step: Optional[dict]) -> bool:
    return step is not None and not any(s["status"] == "todo" for s in plan)


def ensure_current(plan: list[dict]) -> list[dict]:
    out = _copy(plan)
    if not current_step(out):
        nxt = next((s for s in out if s["status"] == "todo"), None)
        if nxt:
            nxt["status"] = "current"
    return out


def advance(plan: list[dict], *, skipped: bool = False) -> list[dict]:
    out = _copy(plan)
    cur = current_step(out)
    if cur:
        cur["status"] = "skipped" if skipped else "done"
    return ensure_current(out)


def apply_action(plan: list[dict], action: Optional[str], edit: Optional[list[dict]]) -> list[dict]:
    if action == "accept_plan":
        return ensure_current(plan)
    if action == "skip_step":
        return advance(plan, skipped=True)
    if action == "edit_plan" and edit:
        by_id = {s["id"]: s for s in plan}
        kept = []
        for e in edit[:MAX_STEPS]:
            s = by_id.get(str(e.get("id")))
            if s and s["status"] in ("todo", "current") and all(k["id"] != s["id"] for k in kept):
                title = str(e.get("title") or "").strip()[:60] or s["title"]
                kept.append({**s, "title": title, "status": "todo"})
        if not kept:
            return plan
        closed = [dict(s) for s in plan if s["status"] in ("done", "skipped")]
        return ensure_current(closed + kept)
    return plan


def fallback_plan(lecture_id: str, page: int, total: int) -> list[dict]:
    """When the model's plan doesn't survive validation: look, explain, check this page."""
    p = max(1, min(page, total))
    steps = [("look", "This page"), ("explain", "What it means"), ("check", "Check yourself")]
    return [
        {"id": f"s{i + 1}", "kind": k, "title": t, "target": {"lecture_id": lecture_id, "page": p}, "status": "todo"}
        for i, (k, t) in enumerate(steps)
    ]
