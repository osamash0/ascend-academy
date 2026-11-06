"""Unit tests for professor-wide Ask Your Data executors (DB-mocked)."""
import pytest

from backend.services import analytics_service
from backend.services.ai import ask_professor

#: The real bulk fetch, kept before the autouse fixture below swaps it out.
_REAL_BULK_CONFIDENCE = ask_professor._bulk_fetch_confidence


LECTURES = [
    {"id": "L1", "title": "Indexing", "course_id": "C1"},
    {"id": "L2", "title": "Joins", "course_id": "C1"},
]

OVERVIEW = {
    "L1": {"total_students": 10, "completion_rate": 90.0, "average_score": 80.0},
    "L2": {"total_students": 8, "completion_rate": 50.0, "average_score": 45.0},
}

CONFIDENCE = {
    "L1": [{"slide_number": 3, "confusion_rate": 55.0, "total": 9}],
    "L2": [{"slide_number": 1, "confusion_rate": 20.0, "total": 6}],
}


@pytest.fixture(autouse=True)
def _mock_analytics(monkeypatch):
    # The executors fetch through the bulk helpers (one Supabase round-trip);
    # mock at that seam so no client is ever constructed.
    monkeypatch.setattr(
        ask_professor, "_bulk_fetch_overviews",
        lambda ids, token: {lid: OVERVIEW[lid] for lid in ids},
    )
    monkeypatch.setattr(
        ask_professor, "_bulk_fetch_confidence",
        lambda ids, token: {lid: CONFIDENCE[lid] for lid in ids},
    )


def test_lectures_by_dropoff_ranks_lowest_completion_first():
    out = ask_professor._exec_lectures_by_dropoff(LECTURES, "tok", {})
    assert out["table"][0]["lecture"] == "Joins"
    assert out["table"][0]["completion_rate"] == 50.0
    assert "Joins" in out["answer_text"]


def test_lectures_by_quiz_performance_ranks_weakest_first():
    out = ask_professor._exec_lectures_by_quiz_performance(LECTURES, "tok", {})
    assert out["table"][0]["lecture"] == "Joins"
    assert out["table"][0]["average_score"] == 45.0


def test_most_confusing_slides_sorts_by_confusion():
    out = ask_professor._exec_most_confusing_slides(LECTURES, "tok", {})
    assert out["table"][0]["confusion_rate"] == 55.0
    assert "Indexing" in out["table"][0]["slide"]


def test_teaching_overview_summarizes_active_lectures():
    out = ask_professor._exec_teaching_overview(LECTURES, "tok", {})
    metrics = {row["metric"]: row["value"] for row in out["table"]}
    assert metrics["Lectures"] == 2
    assert metrics["Total enrollments"] == 18


def test_suggested_questions_present():
    assert len(ask_professor.list_suggested_questions()) == 5


async def test_chat_failure_reply_never_echoes_the_exception(monkeypatch):
    """The fallback reply used to embed ``Debug Error: {type}: {str(e)}`` —
    provider error bodies and budget figures went straight to the chat."""
    monkeypatch.setattr(ask_professor, "_build_professor_context", lambda token, pid: {})

    async def _boom(prompt, ai_model="cerebras", **kwargs):
        raise RuntimeError("monthly budget 4.20 USD exceeded at api.openai.com")

    monkeypatch.setattr(ask_professor, "generate_text", _boom)
    reply = await ask_professor.chat_professor_data(
        professor_id="p1", messages=[{"role": "user", "content": "how are my students doing?"}], token="t",
    )
    assert "Debug Error" not in reply
    assert "RuntimeError" not in reply
    assert "4.20" not in reply
    assert reply.strip()


# ── most confusing slides: people, not events; never the owner; 5 or nothing ──

OWNER = "prof"


class _Q:
    def __init__(self, table):
        self.table_name = table

    def __getattr__(self, name):
        return lambda *a, **k: self


class _Client:
    def table(self, name):
        return _Q(name)


@pytest.fixture
def confidence_world(monkeypatch):
    rows = {
        "lectures": [{"id": "L1", "professor_id": OWNER}],
        "slides": [{"id": "s1", "lecture_id": "L1", "slide_number": 1},
                   {"id": "s2", "lecture_id": "L1", "slide_number": 2}],
        "learning_events": [],
    }
    monkeypatch.setattr(analytics_service, "get_auth_client", lambda token=None: _Client())
    monkeypatch.setattr(analytics_service, "_fetch_all", lambda q, limit=10000: list(rows[q.table_name]))
    monkeypatch.setattr(ask_professor, "_bulk_fetch_confidence", _REAL_BULK_CONFIDENCE)
    return rows


def _rating(uid, slide, rating, at="2026-11-01T10:00:00Z"):
    return {"user_id": uid, "created_at": at,
            "event_data": {"lectureId": "L1", "slideId": slide, "rating": rating}}


def _confusing(world):
    return ask_professor._exec_most_confusing_slides([{"id": "L1", "title": "Indexing"}], "t", {})["table"]


def test_one_person_rating_once_makes_no_confusing_slide(confidence_world):
    confidence_world["learning_events"] = [_rating("u1", "s1", "confused")]
    assert _confusing(confidence_world) == []


def test_five_people_make_a_confusing_slide(confidence_world):
    confidence_world["learning_events"] = [_rating(f"u{i}", "s1", "confused" if i < 2 else "got_it") for i in range(5)]
    (row,) = _confusing(confidence_world)
    assert (row["confusion_rate"], row["ratings"]) == (40.0, 5)


def test_one_person_rating_three_times_counts_once(confidence_world):
    ev = [_rating(f"u{i}", "s1", "got_it") for i in range(4)]
    ev += [_rating("u0", "s1", "confused", "2026-11-01T11:00:00Z"),
           _rating("u0", "s1", "confused", "2026-11-01T12:00:00Z")]
    confidence_world["learning_events"] = ev
    assert _confusing(confidence_world) == []
    # a fifth person opens it; u0's latest rating is the one that counts
    confidence_world["learning_events"] = ev + [_rating("u9", "s1", "got_it")]
    (row,) = _confusing(confidence_world)
    assert (row["confusion_rate"], row["ratings"]) == (20.0, 5)


def test_the_owner_never_counts_toward_a_confusing_slide(confidence_world):
    confidence_world["learning_events"] = (
        [_rating(f"u{i}", "s1", "got_it") for i in range(4)] + [_rating(OWNER, "s1", "confused")])
    assert _confusing(confidence_world) == []
