# backend/tests/unit/test_luna_session_service.py
"""The session loop with an in-memory store and a scripted model."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from backend.services.luna import session_service as svc
from backend.services.luna.prompts import LessonView
from backend.services.luna.validate import PageIndex

L = "11111111-1111-1111-1111-111111111111"
U = "22222222-2222-2222-2222-222222222222"


class FakeStore:
    def __init__(self):
        self.sessions: dict[str, dict] = {}
        self.turns: list[dict] = []
        self.memory: list[dict] = []
        self.locked: set[str] = set()
        self.cards: list[dict] = []

    async def create_session(self, user_id, space_id, lecture_id, goal, plan):
        sid = str(uuid.uuid4())
        self.sessions[sid] = {"id": sid, "user_id": user_id, "space_id": space_id, "lecture_id": lecture_id, "goal": goal,
                              "plan": plan, "recap": "", "status": "active", "wrap": None, "kept": False, "turn_count": 0}
        return dict(self.sessions[sid])

    async def get_session(self, session_id, user_id):
        s = self.sessions.get(session_id)
        return dict(s) if s and s["user_id"] == user_id else None

    async def update_session(self, session_id, **fields):
        self.sessions[session_id].update({k: v for k, v in fields.items() if v is not None})

    async def claim(self, session_id):
        if session_id in self.locked:
            return False
        self.locked.add(session_id)
        return True

    async def release(self, session_id):
        self.locked.discard(session_id)

    async def add_turns(self, session_id, user_id, client_turn_id, rows):
        for role, content in rows:
            if not any(t["sid"] == session_id and t["ct"] == client_turn_id and t["role"] == role for t in self.turns):
                self.turns.append({"sid": session_id, "ct": client_turn_id, "role": role, "content": content})

    async def turns_for_client_id(self, session_id, client_turn_id):
        return [t for t in self.turns if t["sid"] == session_id and t["ct"] == client_turn_id]

    async def recent_turns(self, session_id, limit):
        return [t for t in self.turns if t["sid"] == session_id][-limit:]

    async def active_memory(self, user_id, space_id):
        return [m for m in self.memory if m["active"] and m.get("space_id") in (None, space_id)]

    async def all_active_memory(self, user_id):
        return [m for m in self.memory if m["active"]]

    async def add_memory(self, user_id, lines, space_id, session_id):
        out = []
        for m in lines:
            row = {"id": str(uuid.uuid4()), "kind": m["kind"], "space_id": space_id if m["space_scoped"] else None,
                   "text": m["text"], "active": True, "updated_at": datetime.now(timezone.utc)}
            self.memory.append(row)
            out.append(row)
        return out

    async def retire_memory(self, user_id, ids):
        for m in self.memory:
            if m["id"] in ids:
                m["active"] = False

    async def insert_owned_cards(self, user_id, lecture_id, cards):
        self.cards += cards
        return len(cards)


async def fake_load(lecture_id, locale, around):
    return LessonView(lecture_id=lecture_id, title="Normalisation", served="en",
                      titles=[(n, f"Page {n}") for n in range(1, 11)],
                      pages=PageIndex(totals={lecture_id: 10},
                                      texts={(lecture_id, 4): "X → Y holds if any two rows that agree on X also agree on Y."}),
                      course_id=None)


def scripted(*replies):
    calls = []

    async def ai(prompt, *, user_id, course_id, feature):
        calls.append(prompt)
        r = replies[len(calls) - 1]
        if isinstance(r, Exception):
            raise r
        return r

    ai.calls = calls
    return ai


PLAN_REPLY = {"say": "Here's 15 minutes.", "steps": [
    {"kind": "look", "title": "What an FD says", "page": 4},
    {"kind": "check", "title": "Check yourself", "page": 4},
    {"kind": "explain", "title": "Spot a 2NF violation", "page": 5},
]}


async def _events(gen):
    return [e async for e in gen]


async def _started(store, ai):
    out = await svc.start(store, user_id=U, space_id=U, lecture_id=L, page=4, opener="exam Friday",
                          locale="en", ai=ai, load=fake_load)
    return out["session"]["id"]


async def test_start_drafts_a_plan_and_falls_back_when_it_is_unusable():
    store = FakeStore()
    sid = await _started(store, scripted(PLAN_REPLY))
    assert [s["title"] for s in store.sessions[sid]["plan"]] == ["What an FD says", "Check yourself", "Spot a 2NF violation"]
    sid2 = await _started(store, scripted({"steps": []}))
    assert [s["kind"] for s in store.sessions[sid2]["plan"]] == ["look", "explain", "check"]


async def test_start_rejects_a_space_the_lesson_is_not_in():
    with pytest.raises(svc.LunaError) as e:
        await svc.start(FakeStore(), user_id=U, space_id="someone-elses", lecture_id=L, page=1, opener="",
                        locale="en", ai=scripted(PLAN_REPLY), load=fake_load)
    assert e.value.status == 400


async def test_accepting_runs_the_first_step_moves_the_page_and_streams_in_order():
    store = FakeStore()
    ai = scripted(PLAN_REPLY, {"say": "This line is the whole idea.", "move": {"lecture_id": L, "page": 4, "spot": "agree on X"},
                               "step_done": True})
    sid = await _started(store, ai)
    ct = str(uuid.uuid4())
    events = await _events(await svc.open_turn(store, user_id=U, session_id=sid, client_turn_id=ct, text=None,
                                               action="accept_plan", plan_edit=None, reading_at=4, check_result=None,
                                               locale="en", ai=ai, load=fake_load))
    assert [e for e, _ in events] == ["move", "say", "plan", "end"]
    assert events[0][1] == {"lecture_id": L, "page": 4, "spot": "agree on X"}
    assert [s["status"] for s in events[2][1]["plan"]] == ["done", "current", "todo"]
    assert store.sessions[sid]["turn_count"] == 1 and sid not in store.locked

    replay = await _events(await svc.open_turn(store, user_id=U, session_id=sid, client_turn_id=ct, text=None,
                                               action="accept_plan", plan_edit=None, reading_at=4, check_result=None,
                                               locale="en", ai=ai, load=fake_load))
    assert [e for e, _ in replay][:2] == ["move", "say"] and len(ai.calls) == 2


async def test_luna_never_pulls_a_reader_back_unless_asked():
    store = FakeStore()
    ai = scripted(PLAN_REPLY, {"say": "Back to the definition.", "move": {"lecture_id": L, "page": 4}})
    sid = await _started(store, ai)
    events = await _events(await svc.open_turn(store, user_id=U, session_id=sid, client_turn_id=str(uuid.uuid4()),
                                               text=None, action="continue", plan_edit=None, reading_at=7,
                                               check_result=None, locale="en", ai=ai, load=fake_load))
    assert "move" not in [e for e, _ in events]


async def test_a_failed_model_call_is_a_gentle_error_and_changes_nothing():
    store = FakeStore()
    ai = scripted(PLAN_REPLY, RuntimeError("provider down"))
    sid = await _started(store, ai)
    before = len(store.turns)
    events = await _events(await svc.open_turn(store, user_id=U, session_id=sid, client_turn_id=str(uuid.uuid4()),
                                               text="why?", action=None, plan_edit=None, reading_at=4,
                                               check_result=None, locale="de", ai=ai, load=fake_load))
    assert events == [("error", {"detail": svc.FALLBACK["de"]})]
    assert len(store.turns) == before and store.sessions[sid]["turn_count"] == 0 and sid not in store.locked


async def test_budget_exceeded_says_so():
    class LLMBudgetExceededError(Exception):
        pass

    store = FakeStore()
    ai = scripted(PLAN_REPLY, LLMBudgetExceededError())
    sid = await _started(store, ai)
    events = await _events(await svc.open_turn(store, user_id=U, session_id=sid, client_turn_id=str(uuid.uuid4()),
                                               text="hi", action=None, plan_edit=None, reading_at=4,
                                               check_result=None, locale="en", ai=ai, load=fake_load))
    assert events == [("error", {"detail": svc.BUDGET["en"]})]


async def test_ownership_lock_and_cap_are_checked_before_streaming():
    store = FakeStore()
    sid = await _started(store, scripted(PLAN_REPLY))
    kw = dict(client_turn_id=str(uuid.uuid4()), text="hi", action=None, plan_edit=None, reading_at=None,
              check_result=None, locale="en", ai=scripted(), load=fake_load)
    with pytest.raises(svc.LunaError) as e:
        await svc.open_turn(store, user_id="someone-else", session_id=sid, **kw)
    assert e.value.status == 404
    store.locked.add(sid)
    with pytest.raises(svc.LunaError) as e:
        await svc.open_turn(store, user_id=U, session_id=sid, **kw)
    assert e.value.status == 409
    store.locked.clear()
    store.sessions[sid]["turn_count"] = svc.MAX_TURNS
    events = await _events(await svc.open_turn(store, user_id=U, session_id=sid, **kw))
    assert events == [("end", {"turn_count": svc.MAX_TURNS, "offer_wrap": True})]
