"""Integration tests for POST /api/analytics/lecture/{id}/ask."""
import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import verify_token, require_professor


def _seed_lecture(fake, lecture_id, professor_id):
    fake.seed("lectures", [{
        "id": lecture_id, "professor_id": professor_id, "title": "L",
        "description": "", "total_slides": 1, "created_at": "2026-01-01",
        "pdf_url": None,
    }])


@pytest.fixture
def stub_ask(monkeypatch):
    """Replace the LLM-driven pipeline with a deterministic stub."""
    from backend.services.ai import ask_data

    async def fake_ask(*, lecture_id, question, token, ai_model="cerebras"):
        return {
            "intent": "completion_count",
            "answer_text": f"echo: {question}",
            "table": [{"metric": "x", "value": 1}],
            "chart": None,
            "debug": {},
        }

    monkeypatch.setattr("backend.api.analytics.ask_lecture_data", fake_ask)
    return fake_ask


class TestAskEndpointOwnership:
    def test_403_when_other_professor(self, app, patch_supabase, professor_user, other_professor_user, stub_ask):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        app.dependency_overrides[verify_token] = lambda: other_professor_user
        app.dependency_overrides[require_professor] = lambda: other_professor_user
        client = TestClient(app)
        r = client.post(
            "/api/analytics/lecture/L1/ask",
            json={"question": "How many students finished?"},
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 403

    def test_404_when_lecture_missing(self, app, patch_supabase, professor_user, stub_ask):
        app.dependency_overrides[verify_token] = lambda: professor_user
        app.dependency_overrides[require_professor] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/analytics/lecture/nope/ask",
            json={"question": "anything"},
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 404

    def test_owner_gets_answer(self, app, patch_supabase, professor_user, stub_ask):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        app.dependency_overrides[verify_token] = lambda: professor_user
        app.dependency_overrides[require_professor] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/analytics/lecture/L1/ask",
            json={"question": "How many students finished?"},
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert body["data"]["intent"] == "completion_count"
        assert "echo:" in body["data"]["answer_text"]
        assert isinstance(body["data"]["suggested_questions"], list) and body["data"]["suggested_questions"]

    def test_empty_question_rejected(self, app, patch_supabase, professor_user, stub_ask):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        app.dependency_overrides[verify_token] = lambda: professor_user
        app.dependency_overrides[require_professor] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/analytics/lecture/L1/ask",
            json={"question": "   "},
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 400

    def test_unknown_intent_returns_safe_fallback(self, app, patch_supabase, professor_user, monkeypatch):
        _seed_lecture(patch_supabase, "L1", professor_user.id)

        async def fake_ask(*, lecture_id, question, token, ai_model="cerebras"):
            return {
                "intent": "unknown",
                "answer_text": "I can only answer questions about this lecture's analytics.",
                "table": [],
                "chart": None,
                "debug": {},
            }
        monkeypatch.setattr("backend.api.analytics.ask_lecture_data", fake_ask)

        app.dependency_overrides[verify_token] = lambda: professor_user
        app.dependency_overrides[require_professor] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/analytics/lecture/L1/ask",
            json={"question": "delete all students"},
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 200
        body = r.json()["data"]
        assert body["intent"] == "unknown"
        assert "only answer questions" in body["answer_text"]
        assert body["table"] == []
        assert body["chart"] is None

    def test_parse_failure_returns_couldnt_understand(self, app, patch_supabase, professor_user, monkeypatch):
        _seed_lecture(patch_supabase, "L1", professor_user.id)

        async def fake_ask(*, lecture_id, question, token, ai_model="cerebras"):
            return {
                "intent": "unknown",
                "answer_text": "I couldn't understand that question. Try rephrasing it, or pick one of the suggested questions below.",
                "table": [],
                "chart": None,
                "debug": {"parse_failed": True},
            }
        monkeypatch.setattr("backend.api.analytics.ask_lecture_data", fake_ask)

        app.dependency_overrides[verify_token] = lambda: professor_user
        app.dependency_overrides[require_professor] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/analytics/lecture/L1/ask",
            json={"question": "??!@#$"},
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 200
        body = r.json()["data"]
        assert body["intent"] == "unknown"
        assert "couldn't understand" in body["answer_text"]

    def test_oversize_question_rejected(self, app, patch_supabase, professor_user, stub_ask):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        app.dependency_overrides[verify_token] = lambda: professor_user
        app.dependency_overrides[require_professor] = lambda: professor_user
        client = TestClient(app)
        r = client.post(
            "/api/analytics/lecture/L1/ask",
            json={"question": "x" * 1001},
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 400


class TestAskEndpointSeededExecutors:
    """End-to-end tests that exercise the real intent executors (only the
    LLM classifier is stubbed) against seeded supabase data — locks the
    answer shape for canonical example questions over time."""

    def _setup(self, app, patch_supabase, professor_user, monkeypatch, intent: str, params=None):
        _seed_lecture(patch_supabase, "L1", professor_user.id)

        async def fake_classify(question, ai_model="cerebras"):
            return {"intent": intent, "params": params or {}}
        monkeypatch.setattr("backend.services.ai.ask_data.classify_intent", fake_classify)

        # Skip cache so seeded rows are read fresh.
        from backend.services import analytics_cache
        monkeypatch.setattr(analytics_cache, "get_or_compute",
                            lambda lecture_id, kind, fn, force_refresh=False: fn())

        app.dependency_overrides[verify_token] = lambda: professor_user
        app.dependency_overrides[require_professor] = lambda: professor_user
        return TestClient(app)

    def test_completion_count_against_seeded_data(self, app, patch_supabase, professor_user, monkeypatch):
        client = self._setup(app, patch_supabase, professor_user, monkeypatch, "completion_count")
        patch_supabase.seed("student_progress", [
            {"user_id": "u1", "lecture_id": "L1", "completed_at": "2026-01-02", "quiz_score": 80},
            {"user_id": "u2", "lecture_id": "L1", "completed_at": "2026-01-02", "quiz_score": 60},
            {"user_id": "u3", "lecture_id": "L1", "completed_at": None, "quiz_score": 0},
        ])

        r = client.post(
            "/api/analytics/lecture/L1/ask",
            json={"question": "How many students finished the lecture?"},
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 200
        data = r.json()["data"]
        assert data["intent"] == "completion_count"
        # 2 of 3 students completed → answer text reports both numbers.
        assert "2" in data["answer_text"] and "3" in data["answer_text"]
        metrics = {row["metric"]: row["value"] for row in data["table"]}
        assert metrics["Students started"] == 3
        assert metrics["Students completed"] == 2

    def test_struggling_students_against_seeded_data(self, app, patch_supabase, professor_user, monkeypatch):
        client = self._setup(
            app, patch_supabase, professor_user, monkeypatch,
            "struggling_students", params={"max_accuracy_percent": 40},
        )
        # Stub get_student_performance directly — the underlying analytics
        # call assembles data from many tables; we just need the executor
        # to receive a realistic shape so we can assert filtering behavior.
        from backend.services import analytics_service
        monkeypatch.setattr(analytics_service, "get_student_performance",
                            lambda lecture_id, token: [
                                {"student_id": "u1", "student_name": "Alice", "quiz_score": 25, "progress_percentage": 80},
                                {"student_id": "u2", "student_name": "Bob",   "quiz_score": 75, "progress_percentage": 90},
                                {"student_id": "u3", "student_name": "Cara",  "quiz_score": 39, "progress_percentage": 60},
                            ])

        r = client.post(
            "/api/analytics/lecture/L1/ask",
            json={"question": "Show me students whose quiz accuracy is below 40%"},
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 200
        data = r.json()["data"]
        assert data["intent"] == "struggling_students"
        names = {row["student"] for row in data["table"]}
        assert names == {"Alice", "Cara"}, f"unexpected filtered set: {names}"
        assert "2 student" in data["answer_text"]


class TestAskRateLimitKey:
    def test_key_derives_from_bearer_token(self):
        from backend.api.analytics import _ask_rate_limit_key
        from types import SimpleNamespace

        def _make(headers):
            return SimpleNamespace(headers={k.lower(): v for k, v in headers.items()},
                                   client=SimpleNamespace(host="10.0.0.1"))

        k1 = _ask_rate_limit_key(_make({"authorization": "Bearer prof-token-A"}))
        k2 = _ask_rate_limit_key(_make({"authorization": "Bearer prof-token-B"}))
        k_same = _ask_rate_limit_key(_make({"authorization": "Bearer prof-token-A"}))

        assert k1.startswith("user:") and k2.startswith("user:")
        assert k1 != k2, "Two different professor tokens must produce different rate-limit keys"
        assert k1 == k_same, "Same token must produce a stable key across calls"


class TestAskSuggestionsEndpoint:
    def test_403_for_other_professor(self, app, patch_supabase, professor_user, other_professor_user):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        app.dependency_overrides[verify_token] = lambda: other_professor_user
        app.dependency_overrides[require_professor] = lambda: other_professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/lecture/L1/ask/suggestions",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 403

    def test_owner_gets_questions(self, app, patch_supabase, professor_user):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        app.dependency_overrides[verify_token] = lambda: professor_user
        app.dependency_overrides[require_professor] = lambda: professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/lecture/L1/ask/suggestions",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 200
        qs = r.json()["data"]["questions"]
        assert isinstance(qs, list) and len(qs) > 0
