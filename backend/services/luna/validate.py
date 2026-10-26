"""Luna sessions: nothing the model writes reaches a learner unchecked.

Every page Luna names must exist in the Lesson, every phrase she lights must
really be on that page, interactive blocks go through the reader's own
`validate_answer`, and a check has exactly one right answer. What fails is
dropped, never shown broken — the same rule as Explain.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional

from backend.services.v4_reader_service import validate_answer

STEP_KINDS = ("look", "explain", "ask", "connect", "check", "teachback")
MEMORY_KINDS = ("preference", "shaky", "strong", "goal")
MIN_STEPS, MAX_STEPS = 3, 5
MAX_SAY = 1200
MAX_MEMORY_TEXT = 80
MAX_WRAP_ITEMS = 5

# Scores, grades, emails and phone numbers never become memory.
_SENSITIVE = re.compile(
    r"\d+\s*%|\d+\s*/\s*\d+|\d+\s*(points?|punkte|pts)\b|\b(grade|graded|score|scored|bewertung|note\s*\d)\b"
    r"|@|\+?\d[\d\s()\-]{6,}\d",
    re.IGNORECASE,
)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip().casefold()


_CODE = re.compile(r"(`[^`]*`)")
_SHOUT = re.compile(r"!+(?!=)")
_PAGE_TAIL = re.compile(r"(?:\s+(?:on|auf|see|siehe))?\s*[,;:–—-]?\s*[\(\[]?(page|seite|p\.)\s*\d+[\)\]]?\s*[.!]?\s*$", re.IGNORECASE)
_PAGE_INLINE = re.compile(r"\s*\((?:page|seite|p\.)\s*\d+\)", re.IGNORECASE)


def calm(text: str) -> str:
    """Luna's voice has no exclamation marks: "!" becomes "." (after "?" it just goes).
    "!=" and anything inside backticks are code and stay as they are."""
    parts = _CODE.split(text or "")
    return "".join(
        p if i % 2 else _SHOUT.sub(lambda m: "" if m.start() and p[m.start() - 1] == "?" else ".", p)
        for i, p in enumerate(parts)
    )


def _no_page_refs(text: str) -> str:
    """The page lives in the page field; the line itself should not repeat it."""
    return _PAGE_TAIL.sub("", _PAGE_INLINE.sub("", text)).strip()


def _int(v: Any) -> Optional[int]:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


@dataclass
class PageIndex:
    """Which pages exist (per lecture) and the text of the ones loaded."""

    totals: dict[str, int] = field(default_factory=dict)
    texts: dict[tuple[str, int], str] = field(default_factory=dict)

    def exists(self, lecture_id: str, page: int) -> bool:
        return 1 <= page <= self.totals.get(lecture_id, 0)

    def has_spot(self, lecture_id: str, page: int, spot: str) -> bool:
        text = self.texts.get((lecture_id, page))
        needle = _norm(spot)
        return bool(text) and len(needle) >= 3 and needle in _norm(text)


def validate_plan(raw: Any, *, lecture_id: str, pages: PageIndex) -> Optional[list[dict]]:
    steps = raw.get("steps") if isinstance(raw, dict) else None
    if not isinstance(steps, list):
        return None
    out: list[dict] = []
    for s in steps:
        if not isinstance(s, dict):
            continue
        kind = s.get("kind")
        title = str(s.get("title") or "").strip()[:60]
        page = _int(s.get("page"))
        if kind not in STEP_KINDS or not title or page is None or not pages.exists(lecture_id, page):
            continue
        out.append({
            "id": f"s{len(out) + 1}",
            "kind": kind,
            "title": title,
            "target": {"lecture_id": lecture_id, "page": page},
            "status": "todo",
        })
        if len(out) == MAX_STEPS:
            break
    return out if len(out) >= MIN_STEPS else None


def validate_check(raw: Any) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    question = calm(str(raw.get("question") or "").strip()[:300])
    options = []
    for o in raw.get("options") or []:
        if not isinstance(o, dict):
            continue
        text = calm(str(o.get("text") or "").strip()[:200])
        if text:
            options.append({"text": text, "correct": o.get("correct") is True, "why": calm(str(o.get("why") or "").strip()[:300])})
    if not question or not 2 <= len(options) <= 4 or sum(o["correct"] for o in options) != 1:
        return None
    return {"question": question, "options": options}


def validate_move(raw: Any, *, pages: PageIndex) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    lecture_id = str(raw.get("lecture_id") or "")
    page = _int(raw.get("page"))
    if page is None or not pages.exists(lecture_id, page):
        return None
    move: dict = {"lecture_id": lecture_id, "page": page}
    spot = str(raw.get("spot") or "").strip()[:120]
    if spot and pages.has_spot(lecture_id, page, spot):
        move["spot"] = spot
    return move


def validate_turn(raw: Any, *, pages: PageIndex) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    say = calm(str(raw.get("say") or "").strip()[:MAX_SAY])
    blocks: list[dict] = []
    if raw.get("blocks"):
        answer = validate_answer({"title": say[:120] or "Luna", "blocks": raw.get("blocks")})
        blocks = answer["blocks"] if answer else []
    check = validate_check(raw.get("check"))
    if not say and not blocks and not check:
        return None
    return {
        "say": say,
        "move": validate_move(raw.get("move"), pages=pages),
        "blocks": blocks,
        "check": check,
        "step_done": raw.get("step_done") is True,
        "offer_wrap": raw.get("offer_wrap") is True,
        "recap": str(raw.get("recap") or "").strip()[:2000],
    }


def validate_memory_line(raw: Any) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    kind = raw.get("kind")
    text = re.sub(r"\s+", " ", str(raw.get("text") or "")).strip()
    if kind not in MEMORY_KINDS or not text or len(text) > MAX_MEMORY_TEXT or _SENSITIVE.search(text):
        return None
    # Preferences travel with the person; what is shaky or strong belongs to a Space.
    return {"kind": kind, "space_scoped": kind != "preference", "text": text}


def _wrap_items(raw: Any, pages: PageIndex) -> list[dict]:
    items = []
    for it in (raw if isinstance(raw, list) else [])[:MAX_WRAP_ITEMS]:
        if not isinstance(it, dict):
            continue
        text = _no_page_refs(calm(str(it.get("text") or "").strip()[:160]))
        if not text:
            continue
        lecture_id = str(it.get("lecture_id") or "")
        page = _int(it.get("page"))
        if page is None or not pages.exists(lecture_id, page):
            lecture_id, page = None, None
        items.append({"text": text, "lecture_id": lecture_id, "page": page})
    return items


def validate_wrap(raw: Any, *, pages: PageIndex, memory_ids: set[str]) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    wrap = {k: _wrap_items(raw.get(k), pages) for k in ("covered", "clicked", "shaky")}
    if not wrap["covered"]:
        return None
    adds = [m for m in (validate_memory_line(x) for x in (raw.get("memory_add") or [])[:3]) if m]
    retire = [str(i) for i in (raw.get("memory_retire") or []) if str(i) in memory_ids][:3]
    return {"wrap": wrap, "memory_add": adds, "memory_retire": retire}
