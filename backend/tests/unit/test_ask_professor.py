"""Unit tests for professor-wide Ask Your Data executors (DB-mocked)."""
import pytest

from backend.services.ai import ask_professor


LECTURES = [
    {"id": "L1", "title": "Indexing", "course_id": "C1"},
    {"id": "L2", "title": "Joins", "course_id": "C1"},
]

OVERVIEW = {
    "L1": {"total_students": 10, "completion_rate": 90.0, "average_score": 80.0},
    "L2": {"total_students": 8, "completion_rate": 50.0, "average_score": 45.0},
}

STUDENTS = {
    "L1": [{"student_name": "Fox", "quiz_score": 30, "total_questions_answered": 5}],
    "L2": [
        {"student_name": "Fox", "quiz_score": 20, "total_questions_answered": 4},
        {"student_name": "Owl", "quiz_score": 90, "total_questions_answered": 6},
    ],
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
        ask_professor, "_bulk_fetch_student_scores",
        lambda ids, token: {lid: STUDENTS[lid] for lid in ids},
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


def test_struggling_students_aggregates_across_lectures():
    out = ask_professor._exec_struggling_students(LECTURES, "tok", {"max_accuracy_percent": 40})
    # Fox is below 40 in both lectures; Owl never is.
    fox = next(r for r in out["table"] if r["student"] == "Fox")
    assert fox["lectures_below"] == 2
    assert fox["lowest_score"] == 20
    assert all(r["student"] != "Owl" for r in out["table"])


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
