# backend/services/luna/session_service.py
"""Luna study sessions: a plan, turns that move the reader, a wrap-up.

The server runs the steps; the model fills each turn. Everything it writes is
validated against the Lesson (validate.py) before it is saved or sent, and a
learner never sees a broken turn: it degrades to a gentle line instead.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, AsyncIterator, Awaitable, Callable, Optional
from uuid import UUID

import anyio

from backend.services.luna.context import load_lesson
from backend.services.luna.plan import apply_action, advance, current_step, fallback_plan, is_last, retarget_thin_pages
from backend.services.luna.memory import choose_retirements
from backend.services.luna.prompts import LessonView, plan_prompt, practice_prompt, turn_prompt, wrap_prompt
from backend.services.luna.validate import PageIndex, validate_check, validate_plan, validate_turn, validate_wrap

logger = logging.getLogger(__name__)

MAX_TURNS = 60
RECENT = 8
RECAP_EVERY = 8
PLAN_LOOKAHEAD = 8
FEATURE = "luna_session"

FALLBACK = {
    "en": "I lost my thread for a second. Could you say that again?",
    "de": "Da hab ich kurz den Faden verloren. Sagst du das nochmal?",
}
BUDGET = {
    "en": "You've used this month's AI allowance. Your session is saved for when it renews.",
    "de": "Dein KI-Kontingent für diesen Monat ist aufgebraucht. Deine Session bleibt gespeichert.",
}
GREETING = {
    "en": "Here's a short plan. Change anything you like, or just start.",
    "de": "Hier ist ein kurzer Plan. Ändere, was du willst, oder leg einfach los.",
}

# Every refusal a learner can see, in their language (du, calm, no "!").
ERRORS = {
    "not_found": {"en": "Session not found.", "de": "Diese Session gibt es nicht."},
    "ended": {"en": "This session has ended.", "de": "Diese Session ist schon beendet."},
    "busy": {"en": "Luna is still answering.", "de": "Luna antwortet noch."},
    "bad_turn": {"en": "Invalid turn id.", "de": "Ungültige Turn-ID."},
    "wrong_space": {"en": "That Lesson isn't in this Space.", "de": "Diese Lektion gehört nicht zu diesem Space."},
    "wrap_failed": {"en": "Couldn't write the wrap-up just now.", "de": "Die Zusammenfassung klappt gerade nicht."},
    "practice_failed": {"en": "Couldn't make practice just now.", "de": "Die Übungen klappen gerade nicht."},
    "wrap_first": {"en": "Wrap the session up first.", "de": "Schließ die Session zuerst ab."},
    "lesson_gone": {"en": "This session's Lesson is gone.", "de": "Die Lektion dieser Session gibt es nicht mehr."},
    "lesson_not_found": {"en": "Lesson not found.", "de": "Lektion nicht gefunden."},
}


class LunaError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


Ai = Callable[..., Awaitable[Any]]
Loader = Callable[[str, str, list[int]], Awaitable[LessonView]]
CanView = Callable[[str, str], Awaitable[bool]]


# Gemini hung on every call in the live run, so it goes last.
LUNA_PROVIDERS = ("groq", "openai", "gemini")


def _attempt_seconds() -> float:
    return float(os.getenv("LUNA_ATTEMPT_SECONDS", "15"))


# Module constant (patchable); the env var is read at import time.
LUNA_ATTEMPT_SECONDS = _attempt_seconds()


async def default_ai(prompt: str, *, user_id: str, course_id: Optional[str], feature: str) -> Any:
    """Try providers in turn, each bounded: a hung provider does not fail over inside the
    orchestrator chain (only at the global timeout), so the failover is done here."""
    from backend.services.v4_reader_service import _generate_json

    last: Optional[BaseException] = None
    for provider in LUNA_PROVIDERS:
        try:
            result = await asyncio.wait_for(
                _generate_json(prompt, user_id=user_id, course_id=course_id, feature=feature, prefer=provider),
                LUNA_ATTEMPT_SECONDS,
            )
        except asyncio.TimeoutError as exc:
            last = exc
            logger.warning("luna ai attempt failed provider=%s reason=timeout after %ss", provider, LUNA_ATTEMPT_SECONDS)
            continue
        except Exception as exc:
            if _is_budget(exc):
                raise
            last = exc
            logger.warning("luna ai attempt failed provider=%s reason=%r", provider, exc)
            continue
        if isinstance(result, dict):
            return result
        last = ValueError("non-dict AI result")
        logger.warning("luna ai attempt failed provider=%s reason=non-dict result (%s)", provider, type(result).__name__)
    assert last is not None
    raise last


async def default_find(course_id: str, q: str, exclude_lecture: str) -> list[dict]:
    from backend.services.v4_reader_service import find_in_course

    return await find_in_course(UUID(course_id), q, 3, UUID(exclude_lecture), True)


async def default_can_view(lecture_id: str, user_id: str) -> bool:
    from backend.services.v4_reader_service import can_view_lecture

    return await can_view_lecture(UUID(lecture_id), user_id)


def _lang(locale: str) -> str:
    return locale if locale in FALLBACK else "en"


def _err(status: int, key: str, locale: str) -> LunaError:
    return LunaError(status, ERRORS[key][_lang(locale)])


async def _check_access(session: dict, user_id: str, locale: str, can_view: Optional[CanView]) -> None:
    """Access can be lost mid-session (unenrolled, Lesson made private): re-check every call."""
    if session["lecture_id"] and not await (can_view or default_can_view)(session["lecture_id"], user_id):
        raise _err(404, "lesson_not_found", locale)


async def _release(store: Any, session_id: str) -> None:
    # Shielded: a cancelled request (client gone) must still free the session.
    with anyio.CancelScope(shield=True):
        await store.release(session_id)


def _is_budget(exc: Exception) -> bool:
    return exc.__class__.__name__ == "LLMBudgetExceededError"


async def start(
    store: Any, *, user_id: str, space_id: str, lecture_id: str, page: int, opener: str, locale: str,
    ai: Ai = default_ai, load: Loader = load_lesson,
) -> dict:
    # The learner's page and the eight after it, so a title or agenda slide still
    # leaves the model (and the fallback) real content to plan on.
    view = await load(lecture_id, locale, list(range(page, page + PLAN_LOOKAHEAD + 1)))
    if space_id not in {view.course_id, user_id}:
        raise _err(400, "wrong_space", locale)
    memory = await store.active_memory(user_id, space_id)
    raw: Any = None
    try:
        raw = await ai(plan_prompt(view, page=page, opener=opener, memory=memory, locale=locale),
                       user_id=user_id, course_id=view.course_id, feature=FEATURE)
    except Exception as exc:
        if _is_budget(exc):
            raise LunaError(429, BUDGET[_lang(locale)])
        logger.warning("luna plan model call failed: %s", exc)
    total = view.pages.totals[lecture_id]
    texts = {n: t for (lid, n), t in view.pages.texts.items() if lid == lecture_id}
    valid = validate_plan(raw, lecture_id=lecture_id, pages=view.pages)
    # The model still aims step 1 at the title slide the learner opened on: move it to content.
    plan = retarget_thin_pages(valid, texts, lecture_id) if valid else fallback_plan(
        lecture_id, page, total, locale=locale, texts=texts)
    say = str((raw or {}).get("say") or "").strip()[:400] if isinstance(raw, dict) else ""
    say = say or GREETING[_lang(locale)]
    session = await store.create_session(user_id, space_id, lecture_id, opener.strip()[:300], plan)
    rows: list[tuple[str, dict]] = [("learner", {"text": opener.strip()[:2000]})] if opener.strip() else []
    rows.append(("luna", {"say": say}))
    await store.add_turns(session["id"], user_id, str(UUID(int=0)), rows)
    return {"session": session, "say": say}


def _events_from_rows(rows: list[dict], session: dict) -> list[tuple[str, dict]]:
    out: list[tuple[str, dict]] = []
    offer = False
    for r in rows:
        if r["role"] == "move":
            out.append(("move", r["content"]))
        elif r["role"] == "luna":
            offer = bool(r["content"].get("offer_wrap"))
            out.append(("say", {"md": r["content"].get("say", "")}))
            if r["content"].get("blocks") or r["content"].get("check"):
                out.append(("blocks", {"blocks": r["content"].get("blocks", []), "check": r["content"].get("check")}))
    out.append(("plan", {"plan": session["plan"]}))
    out.append(("end", {"turn_count": session["turn_count"], "offer_wrap": offer}))
    return out


async def _replay(events: list[tuple[str, dict]]) -> AsyncIterator[tuple[str, dict]]:
    for e in events:
        yield e


class _LockedTurn:
    """The turn stream plus the lock it holds. An async generator that was never
    started skips its `finally` even on aclose(), so the wrapper releases the lock itself."""

    def __init__(self, store: Any, session_id: str, gen: AsyncIterator[tuple[str, dict]]):
        self._store, self._sid, self._gen = store, session_id, gen
        self._started = False
        self._closed = False

    def __aiter__(self) -> "_LockedTurn":
        return self

    async def __anext__(self) -> tuple[str, dict]:
        self._started = True
        return await self._gen.__anext__()

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._started:
            await self._gen.aclose()  # runs _run's finally, which releases
        else:
            await _release(self._store, self._sid)


async def open_turn(
    store: Any, *, user_id: str, session_id: str, client_turn_id: str, text: Optional[str], action: Optional[str],
    plan_edit: Optional[list[dict]], reading_at: Optional[int], check_result: Optional[dict], locale: str,
    ai: Ai = default_ai, load: Loader = load_lesson, find: Callable[..., Awaitable[list[dict]]] = default_find,
    can_view: Optional[CanView] = None,
) -> AsyncIterator[tuple[str, dict]]:
    """Raises LunaError before streaming. The caller must exhaust the returned stream or call
    `await stream.aclose()`, typically in a `finally` (plain generators have aclose() too)."""
    session = await store.get_session(session_id, user_id)
    if not session:
        raise _err(404, "not_found", locale)
    await _check_access(session, user_id, locale, can_view)
    if session["status"] != "active":
        raise _err(409, "ended", locale)
    if client_turn_id == str(UUID(int=0)):
        raise _err(400, "bad_turn", locale)
    stored = await store.turns_for_client_id(session_id, client_turn_id)
    if stored:
        return _replay(_events_from_rows(stored, session))
    if session["turn_count"] >= MAX_TURNS or action == "end":
        return _replay([("end", {"turn_count": session["turn_count"], "offer_wrap": True})])
    if not await store.claim(session_id):
        raise _err(409, "busy", locale)
    return _LockedTurn(store, session_id, _run(
        store, session, user_id=user_id, client_turn_id=client_turn_id, text=text, action=action,
        plan_edit=plan_edit, reading_at=reading_at, check_result=check_result, locale=locale,
        ai=ai, load=load, find=find))


async def _run(
    store: Any, session: dict, *, user_id: str, client_turn_id: str, text: Optional[str], action: Optional[str],
    plan_edit: Optional[list[dict]], reading_at: Optional[int], check_result: Optional[dict], locale: str,
    ai: Ai, load: Loader, find: Callable[..., Awaitable[list[dict]]],
) -> AsyncIterator[tuple[str, dict]]:
    sid, lang = session["id"], _lang(locale)
    try:
        plan = apply_action(session["plan"], action, plan_edit)
        step = current_step(plan)
        lecture_id = session["lecture_id"]
        if not lecture_id:
            yield "error", {"detail": FALLBACK[lang]}
            return
        around = [p for p in ((step or {}).get("target", {}).get("page"), reading_at) if p]
        view = await load(lecture_id, locale, around or [1])
        related: list[dict] = []
        if step and step["kind"] == "connect" and view.course_id:
            try:
                related = await find(view.course_id, step["title"], lecture_id)
            except Exception:
                related = []
            for r in related:
                rid, rp = str(r["lecture_id"]), int(r["page"])
                view.pages.totals[rid] = max(view.pages.totals.get(rid, 0), rp)
                view.pages.texts[(rid, rp)] = str(r.get("snippet") or "")
        memory = await store.active_memory(user_id, session["space_id"])
        recent = await store.recent_turns(sid, RECENT)
        count = session["turn_count"] + 1
        prompt = turn_prompt(
            view, step=step, plan=plan, recent=recent, recap=session["recap"], memory=memory,
            reading_at=reading_at, text=text, check_result=check_result, related=related, locale=locale,
            write_recap=count % RECAP_EVERY == 0,
        )
        try:
            raw = await ai(prompt, user_id=user_id, course_id=view.course_id, feature=FEATURE)
        except Exception as exc:
            yield "error", {"detail": BUDGET[lang] if _is_budget(exc) else FALLBACK[lang]}
            return
        turn = validate_turn(raw, pages=view.pages, locale=locale)
        if turn is None:
            yield "error", {"detail": FALLBACK[lang]}
            return

        move = turn["move"]
        # Following, not fighting: no pulling a reader back unless they asked something.
        if move and not text and reading_at and move["lecture_id"] == lecture_id and move["page"] < reading_at:
            move = None
        if turn["step_done"]:
            last = is_last(plan, step)
            plan = advance(plan)
        else:
            last = False
        offer = turn["offer_wrap"] or last or count >= MAX_TURNS

        learner: dict = {}
        if text:
            learner["text"] = text.strip()[:2000]
        if action:
            learner["action"] = action
        if check_result:
            learner["check"] = {"question": str(check_result.get("question", ""))[:300], "correct": bool(check_result.get("correct"))}
        rows: list[tuple[str, dict]] = [("learner", learner)] if learner else []
        if move:
            rows.append(("move", move))
        rows.append(("luna", {"say": turn["say"], "blocks": turn["blocks"], "check": turn["check"], "offer_wrap": offer}))
        await store.add_turns(sid, user_id, client_turn_id, rows)
        await store.update_session(
            sid, plan=plan, turn_count=min(count, MAX_TURNS),
            recap=turn["recap"] if count % RECAP_EVERY == 0 and turn["recap"] else None,
        )

        if move:
            yield "move", move
        yield "say", {"md": turn["say"]}
        if turn["blocks"] or turn["check"]:
            yield "blocks", {"blocks": turn["blocks"], "check": turn["check"]}
        yield "plan", {"plan": plan}
        yield "end", {"turn_count": min(count, MAX_TURNS), "offer_wrap": offer}
    except Exception as exc:
        logger.warning("luna turn failed: %s", exc)
        yield "error", {"detail": FALLBACK[lang]}
    finally:
        await _release(store, sid)


async def _owned(store: Any, user_id: str, session_id: str, locale: str) -> dict:
    session = await store.get_session(session_id, user_id)
    if not session:
        raise _err(404, "not_found", locale)
    return session


def _visited(session: dict, turns: list[dict]) -> list[int]:
    pages = {t["content"]["page"] for t in turns if t["role"] == "move" and t["content"].get("lecture_id") == session["lecture_id"]}
    pages |= {s["target"]["page"] for s in session["plan"] if s["status"] in ("done", "current")}
    return sorted(pages) or [1]


async def wrap(
    store: Any, *, user_id: str, session_id: str, locale: str, ai: Ai = default_ai, load: Loader = load_lesson,
    can_view: Optional[CanView] = None,
) -> dict:
    session = await _owned(store, user_id, session_id, locale)
    await _check_access(session, user_id, locale, can_view)
    if session["wrap"]:
        return {"wrap": session["wrap"], "memory": []}
    if not session["lecture_id"]:
        raise _err(409, "lesson_gone", locale)
    turns = await store.recent_turns(session_id, MAX_TURNS * 3)
    view = await load(session["lecture_id"], locale, _visited(session, turns))
    memory = await store.active_memory(user_id, session["space_id"])
    try:
        raw = await ai(wrap_prompt(view, plan=session["plan"], turns=turns, memory=memory, locale=locale),
                       user_id=user_id, course_id=view.course_id, feature=FEATURE)
    except Exception as exc:
        if _is_budget(exc):
            raise LunaError(429, BUDGET[_lang(locale)])
        logger.warning("luna wrap model call failed: %s", exc)
        raise _err(502, "wrap_failed", locale)
    result = validate_wrap(raw, pages=view.pages, memory_ids={m["id"] for m in memory}, locale=locale)
    if not result:
        raise _err(502, "wrap_failed", locale)
    everything = await store.all_active_memory(user_id)
    await store.retire_memory(user_id, choose_retirements(everything, len(result["memory_add"]), result["memory_retire"]))
    added = await store.add_memory(user_id, result["memory_add"], session["space_id"], session_id)
    await store.update_session(session_id, wrap=result["wrap"], status="wrapped")
    return {"wrap": result["wrap"], "memory": [{k: m[k] for k in ("id", "kind", "text")} for m in added]}


async def keep(store: Any, *, user_id: str, session_id: str, locale: str = "en") -> dict:
    session = await _owned(store, user_id, session_id, locale)
    if not session["wrap"]:
        raise _err(409, "wrap_first", locale)
    await store.update_session(session_id, kept=True)
    return {"kept": True}


async def practice(
    store: Any, *, user_id: str, session_id: str, locale: str, ai: Ai = default_ai, load: Loader = load_lesson,
    can_view: Optional[CanView] = None,
) -> dict:
    session = await _owned(store, user_id, session_id, locale)
    await _check_access(session, user_id, locale, can_view)
    if not session["wrap"] or not session["lecture_id"]:
        raise _err(409, "wrap_first", locale)
    turns = await store.recent_turns(session_id, MAX_TURNS * 3)
    view = await load(session["lecture_id"], locale, _visited(session, turns))
    shaky = [i["text"] for i in session["wrap"].get("shaky", [])]
    missed = [t["content"]["check"]["question"] for t in turns
              if t["role"] == "learner" and isinstance(t["content"].get("check"), dict) and not t["content"]["check"].get("correct")]
    try:
        raw = await ai(practice_prompt(view, shaky=shaky, missed=missed, locale=locale),
                       user_id=user_id, course_id=view.course_id, feature=FEATURE)
    except Exception as exc:
        if _is_budget(exc):
            raise LunaError(429, BUDGET[_lang(locale)])
        logger.warning("luna practice model call failed: %s", exc)
        raise _err(502, "practice_failed", locale)
    cards = []
    for q in (raw.get("questions") if isinstance(raw, dict) else None) or []:
        check = validate_check(q, locale)
        if check:
            page = q.get("page") if isinstance(q.get("page"), int) and view.pages.exists(session["lecture_id"], q["page"]) else None
            cards.append({**check, "page": page})
    if not cards:
        raise _err(502, "practice_failed", locale)
    added = await store.insert_owned_cards(user_id, session["lecture_id"], cards[:6])
    return {"added": added}
