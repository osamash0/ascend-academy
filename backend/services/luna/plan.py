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


NEAR_EMPTY = 120


def _fallback_pages(page: int, total: int, texts: Optional[dict[int, str]]) -> list[int]:
    """Up to three distinct pages from the learner's page on, the fullest first; a title
    or agenda slide with little text is skipped when there are content pages to go to."""
    pool = {n: len((t or "").strip()) for n, t in (texts or {}).items() if page <= n <= total}
    full = {n: c for n, c in pool.items() if c >= NEAR_EMPTY}
    pool = full or pool
    if not pool:
        return [page]
    picked = [page] if page in pool else []
    picked += sorted((n for n in pool if n != page), key=lambda n: (-pool[n], n))[: 3 - len(picked)]
    return sorted(picked)


def fallback_plan(
    lecture_id: str, page: int, total: int, locale: str = "en", texts: Optional[dict[int, str]] = None,
) -> list[dict]:
    """When the model's plan doesn't survive validation: look, explain, check, spread over
    the pages with real content from where the learner is."""
    p = max(1, min(page, total))
    pages = _fallback_pages(p, total, texts)
    titles = ("Diese Seite", "Was sie bedeutet", "Prüf dich selbst") if locale == "de" else ("This page", "What it means", "Check yourself")
    steps = list(zip(("look", "explain", "check"), titles))
    return [
        {"id": f"s{i + 1}", "kind": k, "title": t, "target": {"lecture_id": lecture_id, "page": pages[min(i, len(pages) - 1)]},
         "status": "todo"}
        for i, (k, t) in enumerate(steps)
    ]


def retarget_thin_pages(plan: list[dict], texts: dict[int, str], lecture_id: str) -> list[dict]:
    """A step aimed at a title or agenda slide (a loaded page under NEAR_EMPTY chars) moves to
    the nearest following loaded page with content, if there is one. Never backwards; order,
    kind and title stay. Pages that weren't loaded are left alone: their text is unknown."""
    full = sorted(n for n, t in texts.items() if len((t or "").strip()) >= NEAR_EMPTY)
    out = []
    for s in plan:
        target = s["target"]
        page = target["page"]
        if target["lecture_id"] == lecture_id and page in texts and len((texts[page] or "").strip()) < NEAR_EMPTY:
            nxt = next((n for n in full if n > page), None)
            if nxt is not None:
                s = {**s, "target": {**target, "page": nxt}}
        out.append(dict(s))
    return out
