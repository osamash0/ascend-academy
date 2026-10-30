"""A rehearsal question is shown only if its answer is well-defined and worth asking."""
from backend.services.v4_rehearsal_service import validate_rehearsal

LEC = "35e5687b-6469-4385-ad04-1fb5ca44b920"
ALLOWED = {LEC: 82}
BASE = {"lecture_id": LEC, "page": 6, "idea": "FDs", "prompt": "Which hold?", "why": "w"}


def kinds(*qs):
    return [q["kind"] for q in validate_rehearsal({"questions": list(qs)}, ALLOWED)]


def test_choice_needs_exactly_one_correct_option():
    ok = {**BASE, "kind": "choice", "options": [{"text": "a", "correct": True}, {"text": "b"}]}
    two = {**BASE, "kind": "choice", "options": [{"text": "a", "correct": True}, {"text": "b", "correct": True}]}
    assert kinds(ok, two) == ["choice"]


def test_fd_question_needs_one_that_holds_and_one_that_breaks():
    rows = [["1", "x", "p"], ["1", "x", "q"], ["2", "y", "p"]]
    good = {**BASE, "kind": "fdHolds", "columns": ["A", "B", "C"], "rows": rows,
            "candidates": [{"lhs": ["A"], "rhs": ["B"]}, {"lhs": ["A"], "rhs": ["C"]}]}
    all_hold = {**good, "candidates": [{"lhs": ["A"], "rhs": ["B"]}, {"lhs": ["B"], "rhs": ["A"]}]}
    assert kinds(good, all_hold) == ["fdHolds"]


def test_closure_must_grow_and_bcnf_must_discriminate():
    closure = {**BASE, "kind": "closure", "attrs": ["A", "B", "C"], "fds": [{"lhs": ["A"], "rhs": ["B"]}, {"lhs": ["B"], "rhs": ["C"]}], "start": ["A"]}
    stuck = {**closure, "start": ["C"]}
    bcnf = {**BASE, "kind": "bcnf", "attrs": ["A", "B", "C"], "fds": [{"lhs": ["A"], "rhs": ["B", "C"]}, {"lhs": ["B"], "rhs": ["C"]}]}
    no_violation = {**bcnf, "fds": [{"lhs": ["A"], "rhs": ["B", "C"]}, {"lhs": ["A"], "rhs": ["B"]}]}
    assert kinds(closure, stuck, bcnf, no_violation) == ["closure", "bcnf"]


def test_a_question_must_point_at_a_real_page_of_a_chosen_lecture():
    q = {**BASE, "kind": "order", "items": ["a", "b", "c"]}
    assert kinds(q, {**q, "page": 99}, {**q, "lecture_id": "7142693a-dd83-4bb5-8716-83d30b1dcc7a"}) == ["order"]


def test_history_marks_each_idea_by_its_latest_answer(monkeypatch):
    import asyncio
    import datetime
    import uuid

    import backend.services.v4_rehearsal_service as svc

    now = datetime.datetime(2026, 10, 10, tzinfo=datetime.timezone.utc)
    newest = [{"lecture_id": LEC, "page": 30, "idea": "Closure", "kind": "closure", "correct": True}]
    older = [
        {"lecture_id": LEC, "page": 30, "idea": "closure ", "kind": "closure", "correct": False},
        {"lecture_id": LEC, "page": 50, "idea": "BCNF", "kind": "bcnf", "correct": False},
    ]
    attempts = [
        {"id": uuid.uuid4(), "title": "t", "score": 1, "total": 1, "results": newest, "created_at": now},
        {"id": uuid.uuid4(), "title": "t", "score": 0, "total": 2, "results": older, "created_at": now},
    ]

    class Conn:
        async def fetch(self, sql, *args):
            return attempts if "v4_rehearsal_attempts" in sql else [{"id": LEC, "title": "Normalization"}]

    class Ctx:
        async def __aenter__(self):
            return Conn()

        async def __aexit__(self, *exc):
            return False

    async def connect():
        return Ctx()

    monkeypatch.setattr(svc, "get_db_connection", connect)
    h = asyncio.run(svc.history(uuid.uuid4(), str(uuid.uuid4())))
    assert sorted((m["page"], m["correct"]) for m in h["marks"]) == [(30, True), (50, False)]
    assert all(m["at"] == now.isoformat() for m in h["marks"])
    assert [w["idea"] for w in h["weak"]] == ["BCNF"]


def test_a_miss_in_the_same_attempt_makes_the_idea_weak(monkeypatch):
    # LS-057: a two-question checkpoint on one idea, right then wrong, is a weak spot.
    import asyncio
    import datetime
    import uuid

    import backend.services.v4_rehearsal_service as svc

    now = datetime.datetime(2026, 10, 10, tzinfo=datetime.timezone.utc)
    checkpoint = [
        {"lecture_id": LEC, "page": 2, "idea": "Architecture", "kind": "choice", "correct": True},
        {"lecture_id": LEC, "page": 3, "idea": "Architecture", "kind": "choice", "correct": False},
    ]
    older_pass = [{"lecture_id": LEC, "page": 2, "idea": "Architecture", "kind": "choice", "correct": True}]
    attempts = [
        {"id": uuid.uuid4(), "title": "Checkpoint", "score": 1, "total": 2, "results": checkpoint, "created_at": now},
        {"id": uuid.uuid4(), "title": "Checkpoint", "score": 1, "total": 1, "results": older_pass, "created_at": now},
    ]

    class Conn:
        async def fetch(self, sql, *args):
            return attempts if "v4_rehearsal_attempts" in sql else [{"id": LEC, "title": "Introduction"}]

    class Ctx:
        async def __aenter__(self):
            return Conn()

        async def __aexit__(self, *exc):
            return False

    async def connect():
        return Ctx()

    monkeypatch.setattr(svc, "get_db_connection", connect)
    h = asyncio.run(svc.history(uuid.uuid4(), str(uuid.uuid4())))
    assert [w["idea"] for w in h["weak"]] == ["Architecture"]
    assert h["steady_count"] == 0
    assert [m["correct"] for m in h["marks"]] == [False]


def test_a_checkpoint_stays_inside_its_idea_and_is_written_once(monkeypatch):
    import asyncio
    import uuid

    import backend.services.v4_reader_service as reader
    import backend.services.v4_rehearsal_service as svc

    lec = uuid.UUID(LEC)
    store: dict = {}
    calls = []

    async def row(_id):
        return {"title": "Normalization", "course_id": uuid.uuid4(), "content_revision": 3}

    async def content(_id, _locale):
        return {"slides": [{"slide_number": n, "title": f"p{n}", "content_text": "x" * 80} for n in range(1, 83)]}, "en"

    async def generate(prompt, **kw):
        calls.append(kw["prefer"])
        choice = {"kind": "choice", "options": [{"text": "a", "correct": True}, {"text": "b"}], "idea": "Closure", "prompt": "Which is right?", "why": "w", "lecture_id": LEC}
        return {"questions": [{**choice, "page": 34}, {**choice, "page": 60}]}

    async def get(k):
        return store.get(k)

    async def put(k, v, ttl_seconds):
        store[k] = v

    monkeypatch.setattr(reader, "_lecture_row", row)
    monkeypatch.setattr(svc, "get_lecture_content_for_locale", content)
    monkeypatch.setattr(svc, "_generate_json", generate)
    monkeypatch.setattr(svc, "get_cache", get)
    monkeypatch.setattr(svc, "set_cache", put)

    first = asyncio.run(svc.checkpoint(lec, 32, 40, "Closure", user_id="u", locale="en"))
    assert [q["page"] for q in first["questions"]] == [34]
    assert first["cached"] is False
    again = asyncio.run(svc.checkpoint(lec, 32, 40, "Closure", user_id="u", locale="en"))
    assert again["cached"] is True and calls == ["groq"]


def test_an_order_question_never_opens_on_its_answer():
    from backend.services.v4_rehearsal_service import _shuffle

    for n in (2, 3, 5):
        for _ in range(200):
            assert _shuffle(n) != list(range(n))
    assert _shuffle(1) == [0]
