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
    assert [w["idea"] for w in h["weak"]] == ["BCNF"]
