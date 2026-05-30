"""Unit tests for ask_data intent dispatch and parameter validation."""
from __future__ import annotations
import asyncio
import pytest

from backend.services.ai import ask_data


class _FakeAnalytics:
    """Patches the analytics_service functions used by ask_data executors."""

    def __init__(self) -> None:
        self.slides = [
            {"slide_number": 1, "title": "Intro",  "drop_off_rate": 5.0,  "view_count": 10},
            {"slide_number": 2, "title": "Hard",   "drop_off_rate": 50.0, "view_count": 8},
            {"slide_number": 3, "title": "Mid",    "drop_off_rate": 20.0, "view_count": 9},
        ]
        self.quiz = [
            {"question_id": "q1", "question_text": "Define X", "success_rate": 90.0, "attempts": 10, "difficulty": "easy"},
            {"question_id": "q2", "question_text": "Explain Y", "success_rate": 30.0, "attempts": 10, "difficulty": "hard"},
            {"question_id": "q3", "question_text": "Apply Z", "success_rate": 0.0, "attempts": 0, "difficulty": "n/a"},
        ]
        self.students = [
            {"student_id": "s1", "student_name": "Alice", "progress_percentage": 100, "quiz_score": 80},
            {"student_id": "s2", "student_name": "Bob", "progress_percentage": 50, "quiz_score": 30},
        ]
        self.overview = {"total_students": 4, "completion_rate": 50, "average_score": 60,
                         "average_time_minutes": 12, "engagement_level": "ok"}
        self.confidence = [
            {"slide_number": 1, "title": "Intro", "got_it": 5, "unsure": 0, "confused": 0, "total": 5, "confusion_rate": 0.0},
            {"slide_number": 2, "title": "Hard", "got_it": 1, "unsure": 1, "confused": 8, "total": 10, "confusion_rate": 80.0},
        ]
        self.feed = [
            {"slide_title": "Hard", "query_text": "what is X?", "created_at": "2026-05-03"},
        ]


@pytest.fixture
def patched(monkeypatch):
    fake = _FakeAnalytics()
    from backend.services import analytics_service as svc
    monkeypatch.setattr(svc, "get_slide_analytics", lambda *a, **k: fake.slides)
    monkeypatch.setattr(svc, "get_quiz_analytics", lambda *a, **k: fake.quiz)
    monkeypatch.setattr(svc, "get_student_performance", lambda *a, **k: fake.students)
    monkeypatch.setattr(svc, "get_lecture_overview", lambda *a, **k: fake.overview)
    monkeypatch.setattr(svc, "get_confidence_by_slide", lambda *a, **k: fake.confidence)
    monkeypatch.setattr(svc, "get_ai_query_feed", lambda *a, **k: fake.feed)
    return fake


def _run(intent: str, params: dict, monkeypatch):
    async def fake_classify(question, ai_model="cerebras"):
        return {"intent": intent, "params": params}
    monkeypatch.setattr(ask_data, "classify_intent", fake_classify)
    return asyncio.run(ask_data.ask_lecture_data(
        lecture_id="lec1", question="anything", token="tok", ai_model="cerebras"
    ))


def test_top_dropoff_picks_highest(patched, monkeypatch):
    out = _run("top_dropoff_slides", {"limit": 2}, monkeypatch)
    assert out["intent"] == "top_dropoff_slides"
    assert len(out["table"]) == 2
    assert "Hard" in out["table"][0]["slide"]
    assert out["chart"]["y_key"] == "drop_off_rate"


def test_worst_quiz_skips_zero_attempts(patched, monkeypatch):
    out = _run("worst_quiz_questions", {"limit": 5}, monkeypatch)
    # q3 (0 attempts) excluded; q2 (30%) lower than q1 (90%)
    assert len(out["table"]) == 2
    assert "Explain Y" in out["table"][0]["question"]


def test_struggling_students_threshold(patched, monkeypatch):
    out = _run("struggling_students", {"max_accuracy_percent": 50}, monkeypatch)
    names = [r["student"] for r in out["table"]]
    assert names == ["Bob"]


def test_completion_count_table_shape(patched, monkeypatch):
    out = _run("completion_count", {}, monkeypatch)
    metrics = {row["metric"] for row in out["table"]}
    assert "Students completed" in metrics


def test_confusion_topics_orders_by_rate(patched, monkeypatch):
    out = _run("confusion_topics", {}, monkeypatch)
    assert "Hard" in out["table"][0]["slide"]


def test_ai_query_themes(patched, monkeypatch):
    out = _run("ai_query_themes", {"limit": 5}, monkeypatch)
    assert len(out["table"]) == 1


def test_unknown_intent_returns_safe_fallback(patched, monkeypatch):
    async def fake_classify(question, ai_model="cerebras"):
        return {"intent": "unknown", "params": {}}
    monkeypatch.setattr(ask_data, "classify_intent", fake_classify)
    out = asyncio.run(ask_data.ask_lecture_data(
        lecture_id="lec1", question="delete users", token="tok",
    ))
    assert out["intent"] == "unknown"
    assert "only answer questions" in out["answer_text"]
    assert out["chart"] is None
    assert out["table"] == []


def test_clamp_int_bounds():
    assert ask_data._clamp_int("999", default=5, lo=1, hi=20) == 20
    assert ask_data._clamp_int("-3",  default=5, lo=1, hi=20) == 1
    assert ask_data._clamp_int(None,  default=5, lo=1, hi=20) == 5
    assert ask_data._clamp_int("abc", default=7, lo=1, hi=20) == 7


def test_classify_intent_unknown_on_garbage(monkeypatch):
    async def fake_gen(prompt, ai_model="cerebras"):
        return "not json at all"
    monkeypatch.setattr(ask_data, "generate_text", fake_gen)
    out = asyncio.run(ask_data.classify_intent("anything"))
    assert out["intent"] == "unknown"
