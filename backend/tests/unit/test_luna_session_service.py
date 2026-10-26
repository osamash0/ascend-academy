# backend/tests/unit/test_luna_session_service.py
"""The session loop with an in-memory store and a scripted model."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import anyio
import pytest

from backend.services.luna import session_service as svc
from backend.services.luna.prompts import LessonView
from backend.services.luna.validate import PageIndex

L = "11111111-1111-1111-1111-111111111111"
U = "22222222-2222-2222-2222-222222222222"


@pytest.fixture(autouse=True)
def _lesson_visible(monkeypatch):
    """Access is re-checked each turn; by default the learner can still see the Lesson."""
    async def can_view(lecture_id, user_id):
        return True

    monkeypatch.setattr(svc, "default_can_view", can_view)


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


async def test_start_loads_the_next_pages_and_the_fallback_plans_the_content_after_a_title_slide():
    seen = []
    content = "Second normal form removes partial dependencies on a composite key. " * 3

    async def load(lecture_id, locale, around):
        seen.append(around)
        return LessonView(lecture_id=lecture_id, title="Normalisation", served="en",
                          titles=[(n, f"Page {n}") for n in range(1, 21)],
                          pages=PageIndex(totals={lecture_id: 20},
                                          texts={(lecture_id, 1): "Normalisation", (lecture_id, 2): content,
                                                 (lecture_id, 3): content, (lecture_id, 5): content}),
                          course_id=None)

    store = FakeStore()
    out = await svc.start(store, user_id=U, space_id=U, lecture_id=L, page=1, opener="", locale="en",
                          ai=scripted({"steps": []}), load=load)
    assert seen == [list(range(1, 10))]
    assert [s["target"]["page"] for s in store.sessions[out["session"]["id"]]["plan"]] == [2, 3, 5]

    reply = {"steps": [{"kind": "look", "title": "Overview", "page": 1}, {"kind": "explain", "title": "2NF", "page": 3},
                       {"kind": "check", "title": "Check", "page": 4}]}
    out = await svc.start(store, user_id=U, space_id=U, lecture_id=L, page=1, opener="", locale="en",
                          ai=scripted(reply), load=load)
    plan = store.sessions[out["session"]["id"]]["plan"]
    assert [(s["title"], s["target"]["page"]) for s in plan] == [("Overview", 2), ("2NF", 3), ("Check", 4)]  # page 4 was not loaded: left alone


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


async def test_a_stream_that_is_never_iterated_still_releases_the_lock():
    store = FakeStore()
    sid = await _started(store, scripted(PLAN_REPLY))
    stream = await svc.open_turn(store, user_id=U, session_id=sid, client_turn_id=str(uuid.uuid4()), text="hi", action=None,
                                 plan_edit=None, reading_at=None, check_result=None, locale="en", ai=scripted(), load=fake_load)
    assert sid in store.locked
    await stream.aclose()
    await stream.aclose()
    assert sid not in store.locked


async def test_a_failure_while_preparing_a_turn_is_a_gentle_error():
    store = FakeStore()
    sid = await _started(store, scripted(PLAN_REPLY))

    async def broken_load(lecture_id, locale, around):
        raise RuntimeError("db down")

    events = await _events(await svc.open_turn(store, user_id=U, session_id=sid, client_turn_id=str(uuid.uuid4()), text="hi",
                                               action=None, plan_edit=None, reading_at=None, check_result=None,
                                               locale="en", ai=scripted(), load=broken_load))
    assert events == [("error", {"detail": svc.FALLBACK["en"]})] and sid not in store.locked


async def test_the_wrap_offer_survives_a_replay():
    store = FakeStore()
    ai = scripted(PLAN_REPLY, {"say": "Good place to stop.", "offer_wrap": True})
    sid = await _started(store, ai)
    kw = dict(user_id=U, session_id=sid, client_turn_id=str(uuid.uuid4()), text="hi", action=None, plan_edit=None,
              reading_at=None, check_result=None, locale="en", ai=ai, load=fake_load)
    first = await _events(await svc.open_turn(store, **kw))
    again = await _events(await svc.open_turn(store, **kw))
    assert first[-1][1]["offer_wrap"] is True and again[-1][1]["offer_wrap"] is True


async def test_the_reserved_turn_id_is_refused():
    store = FakeStore()
    sid = await _started(store, scripted(PLAN_REPLY))
    with pytest.raises(svc.LunaError) as e:
        await svc.open_turn(store, user_id=U, session_id=sid, client_turn_id=str(uuid.UUID(int=0)), text="hi", action=None,
                            plan_edit=None, reading_at=None, check_result=None, locale="en", ai=scripted(), load=fake_load)
    assert e.value.status == 400


WRAP_REPLY = {
    "covered": [{"text": "Functional dependencies", "lecture_id": L, "page": 4}],
    "clicked": [{"text": "Reading an FD as a lookup", "lecture_id": L, "page": 4}],
    "shaky": [{"text": "Partial keys in 2NF", "lecture_id": L, "page": 5}],
    "memory_add": [{"kind": "preference", "text": "examples before definitions"}, {"kind": "shaky", "text": "partial keys"}],
    "memory_retire": [],
}


async def test_wrap_saves_the_card_writes_memory_and_is_idempotent():
    store = FakeStore()
    sid = await _started(store, scripted(PLAN_REPLY))
    ai = scripted(WRAP_REPLY)
    out = await svc.wrap(store, user_id=U, session_id=sid, locale="en", ai=ai, load=fake_load)
    assert out["wrap"]["shaky"][0]["page"] == 5
    assert {m["text"] for m in out["memory"]} == {"examples before definitions", "partial keys"}
    assert store.sessions[sid]["status"] == "wrapped"
    again = await svc.wrap(store, user_id=U, session_id=sid, locale="en", ai=ai, load=fake_load)
    assert again["wrap"] == out["wrap"] and again["memory"] == [] and len(ai.calls) == 1


async def test_wrap_respects_the_memory_cap():
    store = FakeStore()
    store.memory = [{"id": f"m{i}", "kind": "preference", "space_id": None, "text": f"line {i}", "active": True,
                     "updated_at": datetime(2026, 1, 1 + i, tzinfo=timezone.utc)} for i in range(20)]
    sid = await _started(store, scripted(PLAN_REPLY))
    await svc.wrap(store, user_id=U, session_id=sid, locale="en", ai=scripted(WRAP_REPLY), load=fake_load)
    assert sum(m["active"] for m in store.memory) == 20
    assert not next(m for m in store.memory if m["id"] == "m0")["active"]


async def test_keep_and_practice_need_a_wrapped_session():
    store = FakeStore()
    sid = await _started(store, scripted(PLAN_REPLY))
    with pytest.raises(svc.LunaError) as e:
        await svc.keep(store, user_id=U, session_id=sid)
    assert e.value.status == 409
    await svc.wrap(store, user_id=U, session_id=sid, locale="en", ai=scripted(WRAP_REPLY), load=fake_load)
    assert await svc.keep(store, user_id=U, session_id=sid) == {"kept": True}
    q = {"question": "Does it hold?", "page": 4, "options": [{"text": "Yes", "why": "a"}, {"text": "No", "correct": True, "why": "b"}]}
    bad = {"question": "Two right?", "options": [{"text": "A", "correct": True}, {"text": "B", "correct": True}]}
    out = await svc.practice(store, user_id=U, session_id=sid, locale="en",
                             ai=scripted({"questions": [q, q, bad]}), load=fake_load)
    assert out == {"added": 2} and store.cards[0]["question"] == "Does it hold?"


async def _no_access(lecture_id, user_id):
    return False


async def test_losing_access_to_the_lesson_ends_turns_wrap_and_practice():
    store = FakeStore()
    sid = await _started(store, scripted(PLAN_REPLY))
    with pytest.raises(svc.LunaError) as e:
        await svc.open_turn(store, user_id=U, session_id=sid, client_turn_id=str(uuid.uuid4()), text="hi", action=None,
                            plan_edit=None, reading_at=None, check_result=None, locale="en", ai=scripted(),
                            load=fake_load, can_view=_no_access)
    assert (e.value.status, e.value.detail) == (404, "Lesson not found.") and sid not in store.locked
    with pytest.raises(svc.LunaError) as e:
        await svc.wrap(store, user_id=U, session_id=sid, locale="de", ai=scripted(WRAP_REPLY), load=fake_load,
                       can_view=_no_access)
    assert (e.value.status, e.value.detail) == (404, "Lektion nicht gefunden.")
    await svc.wrap(store, user_id=U, session_id=sid, locale="en", ai=scripted(WRAP_REPLY), load=fake_load)
    with pytest.raises(svc.LunaError) as e:
        await svc.practice(store, user_id=U, session_id=sid, locale="en", ai=scripted(), load=fake_load,
                           can_view=_no_access)
    assert e.value.status == 404


async def test_refusals_speak_the_learners_language():
    store = FakeStore()
    kw = dict(client_turn_id=str(uuid.uuid4()), text="hi", action=None, plan_edit=None, reading_at=None,
              check_result=None, ai=scripted(), load=fake_load)
    with pytest.raises(svc.LunaError) as e:
        await svc.open_turn(store, user_id=U, session_id=str(uuid.uuid4()), locale="de", **kw)
    assert e.value.detail == svc.ERRORS["not_found"]["de"] != svc.ERRORS["not_found"]["en"]
    sid = await _started(store, scripted(PLAN_REPLY))
    with pytest.raises(svc.LunaError) as e:
        await svc.keep(store, user_id=U, session_id=sid, locale="de")
    assert e.value.detail == svc.ERRORS["wrap_first"]["de"]
    with pytest.raises(svc.LunaError) as e:
        await svc.start(FakeStore(), user_id=U, space_id="someone-elses", lecture_id=L, page=1, opener="",
                        locale="de", ai=scripted(PLAN_REPLY), load=fake_load)
    assert e.value.detail == svc.ERRORS["wrong_space"]["de"]
    for key, texts in svc.ERRORS.items():
        assert set(texts) == {"en", "de"} and "!" not in texts["de"], key


class SlowReleaseStore(FakeStore):
    async def release(self, session_id):
        await anyio.sleep(0)  # a checkpoint: a cancelled caller would stop here
        self.locked.discard(session_id)


async def test_the_lock_is_released_even_when_the_request_is_cancelled():
    store = SlowReleaseStore()
    sid = await _started(store, scripted(PLAN_REPLY))
    kw = dict(user_id=U, client_turn_id=str(uuid.uuid4()), text="hi", action=None, plan_edit=None, reading_at=None,
              check_result=None, locale="en", load=fake_load)
    never_started = await svc.open_turn(store, session_id=sid, ai=scripted(), **kw)
    with anyio.CancelScope() as scope:
        scope.cancel()
        await never_started.aclose()
    assert sid not in store.locked

    async def hangs(prompt, **_):
        await anyio.sleep_forever()

    started = await svc.open_turn(store, session_id=sid, ai=hangs, **{**kw, "client_turn_id": str(uuid.uuid4())})
    with anyio.move_on_after(0.05):
        async for _ in started:
            pass
    with anyio.CancelScope() as scope:
        scope.cancel()
        await started.aclose()
    assert sid not in store.locked
