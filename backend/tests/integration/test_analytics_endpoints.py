"""Integration tests for /api/analytics/* endpoints.

These exercise the full FastAPI stack but with a fake Supabase client
and stubbed authentication.
"""
from fastapi.testclient import TestClient

from backend.core.auth_middleware import verify_token


def _seed_lecture(fake, lecture_id, professor_id):
    fake.seed(
        "lectures",
        [
            {
                "id": lecture_id,
                "professor_id": professor_id,
                "title": "Test Lecture",
                "description": "",
                "total_slides": 3,
                "created_at": "2026-01-01",
                "pdf_url": None,
            }
        ],
    )


class TestOverviewEndpoint:
    def test_404_when_lecture_missing(self, app, professor_user):
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/lecture/missing-id/overview",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 404

    def test_403_when_other_professor(self, app, patch_supabase, professor_user, other_professor_user):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        app.dependency_overrides[verify_token] = lambda: other_professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/lecture/L1/overview",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 403

    def test_200_for_owner(self, app, patch_supabase, professor_user):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        # Seed slides + progress + events for the owner
        patch_supabase.seed("slides", [
            {"id": "s1", "lecture_id": "L1", "slide_number": 1, "title": "T1"},
        ])
        patch_supabase.seed("student_progress", [])
        patch_supabase.seed("learning_events", [])
        patch_supabase.seed("quiz_questions", [])

        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/lecture/L1/overview",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert "data" in body

    def test_unauthenticated_401(self, app):
        client = TestClient(app)
        r = client.get("/api/analytics/lecture/L1/overview")
        # No Authorization header → HTTPBearer auto-error → 403 (FastAPI default)
        assert r.status_code in (401, 403)


class TestDropoffEndpoint:
    def test_owner_sees_dropoff(self, app, patch_supabase, professor_user):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        patch_supabase.seed("slides", [
            {"id": "s1", "lecture_id": "L1", "slide_number": 1, "title": "T1"},
            {"id": "s2", "lecture_id": "L1", "slide_number": 2, "title": "T2"},
        ])
        patch_supabase.seed("student_progress", [
            {"user_id": "u1", "lecture_id": "L1", "last_slide_viewed": 1, "completed_at": None,
             "completed_slides": [1], "quiz_score": 0,
             "total_questions_answered": 0, "correct_answers": 0},
        ])
        patch_supabase.seed("learning_events", [])

        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/lecture/L1/dropoff",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 200
        data = r.json()["data"]
        assert isinstance(data, list)


class TestProfessorOverviewEndpoint:
    def _seed_course(self, fake, course_id, professor_id):
        fake.seed("courses", [{
            "id": course_id, "professor_id": professor_id,
            "title": "CS 101", "description": "",
        }])

    def test_404_when_course_missing(self, app, patch_supabase, professor_user):
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/professor/overview?course_id=nope&days=7",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 404

    def test_403_when_other_professor(self, app, patch_supabase, professor_user, other_professor_user):
        self._seed_course(patch_supabase, "C1", professor_user.id)
        app.dependency_overrides[verify_token] = lambda: other_professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/professor/overview?course_id=C1&days=7",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 403

    def test_200_for_owner_with_seeded_data(self, app, patch_supabase, professor_user):
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        self._seed_course(patch_supabase, "C1", professor_user.id)
        patch_supabase.seed("lectures", [
            {"id": "L1", "course_id": "C1", "professor_id": professor_user.id,
             "title": "Lecture 1", "total_slides": 4, "created_at": "2026-01-01"},
        ])
        patch_supabase.seed("slides", [
            {"id": "s1", "lecture_id": "L1", "slide_number": 1, "title": "Intro"},
            {"id": "s2", "lecture_id": "L1", "slide_number": 2, "title": "Deep Dive"},
        ])
        patch_supabase.seed("student_progress", [
            {"user_id": "u1", "lecture_id": "L1", "completed_slides": [1, 2],
             "quiz_score": 80, "total_questions_answered": 5, "correct_answers": 4},
            {"user_id": "u2", "lecture_id": "L1", "completed_slides": [1],
             "quiz_score": 50, "total_questions_answered": 4, "correct_answers": 1},
        ])
        patch_supabase.seed("quiz_questions", [
            {"id": "q1", "slide_id": "s1", "metadata": {"concept": "Recursion"}},
            {"id": "q2", "slide_id": "s2", "metadata": {"concept": "Pointers"}},
        ])
        patch_supabase.seed("learning_events", [
            {"user_id": "u1", "event_type": "quiz_attempt", "created_at": now,
             "event_data": {"lectureId": "L1", "questionId": "q1", "slideId": "s1", "correct": False}},
            {"user_id": "u1", "event_type": "quiz_attempt", "created_at": now,
             "event_data": {"lectureId": "L1", "questionId": "q1", "slideId": "s1", "correct": False}},
            {"user_id": "u2", "event_type": "quiz_attempt", "created_at": now,
             "event_data": {"lectureId": "L1", "questionId": "q2", "slideId": "s2", "correct": True}},
            {"user_id": "u2", "event_type": "lecture_complete", "created_at": now,
             "event_data": {"lectureId": "L1", "total_duration_seconds": 600}},
        ])

        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/professor/overview?course_id=C1&days=7",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        data = body["data"]
        assert data["active_students"] == 2
        assert data["lecture_count"] == 1
        # u1: 2 completed / 4 total = 50%, u2: 1/4 = 25% → avg 37.5
        assert data["average_completion"] == 37.5
        # accuracy = 5 correct / 9 attempts = 55.6
        assert data["average_quiz_accuracy"] == round(5 / 9 * 100, 1)
        assert data["median_time_minutes"] == 10.0
        assert len(data["activity_sparkline"]) == 7
        # All 4 seeded events landed today (the last sparkline bucket).
        from datetime import datetime, timezone as _tz
        today = datetime.now(_tz.utc).date().isoformat()
        today_bucket = next(b for b in data["activity_sparkline"] if b["date"] == today)
        assert today_bucket["count"] == 4
        # Recursion has 2 misses out of 2 → 100%; Pointers 0% miss
        concepts = {c["concept"]: c for c in data["weakest_concepts"]}
        assert "Recursion" in concepts
        assert concepts["Recursion"]["miss_rate"] == 100.0

    def test_400_when_days_out_of_range(self, app, patch_supabase, professor_user):
        self._seed_course(patch_supabase, "C1", professor_user.id)
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/professor/overview?course_id=C1&days=0",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 422

    def test_high_volume_other_course_events_do_not_truncate(self, app, patch_supabase, professor_user, other_professor_user):
        """Regression test: prove event scoping happens at the query level.

        Seeds >10k recent events for an UNRELATED course/lecture plus a
        small handful for our course's lecture, then asserts our overview
        still sees every relevant event (no global pagination cap can
        knock our course's data out of the result set).
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()

        # Course we own + its lecture
        self._seed_course(patch_supabase, "C1", professor_user.id)
        patch_supabase.seed("lectures", [
            {"id": "L1", "course_id": "C1", "professor_id": professor_user.id,
             "title": "Lecture 1", "total_slides": 1, "created_at": "2026-01-01"},
            # Unrelated lecture under a different course / professor.
            {"id": "L_OTHER", "course_id": "C_OTHER",
             "professor_id": other_professor_user.id,
             "title": "Other", "total_slides": 1, "created_at": "2026-01-01"},
        ])
        patch_supabase.seed("slides", [])
        patch_supabase.seed("student_progress", [])
        patch_supabase.seed("quiz_questions", [])

        noise = [
            {"user_id": f"noise-{i}", "event_type": "slide_view", "created_at": now,
             "event_data": {"lectureId": "L_OTHER"}}
            for i in range(10_500)
        ]
        ours = [
            {"user_id": "u1", "event_type": "slide_view", "created_at": now,
             "event_data": {"lectureId": "L1"}},
            {"user_id": "u2", "event_type": "quiz_attempt", "created_at": now,
             "event_data": {"lectureId": "L1", "correct": True}},
            {"user_id": "u3", "event_type": "ai_tutor_query", "created_at": now,
             "event_data": {"lectureId": "L1"}},
        ]
        patch_supabase.seed("learning_events", noise + ours)

        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/professor/overview?course_id=C1&days=7",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 200
        data = r.json()["data"]
        # All three of our events must be counted regardless of noise volume.
        assert data["active_students"] == 3
        from datetime import timezone as _tz
        today = datetime.now(_tz.utc).date().isoformat()
        today_bucket = next(b for b in data["activity_sparkline"] if b["date"] == today)
        assert today_bucket["count"] == 3

    def test_empty_course_returns_zeroed_payload(self, app, patch_supabase, professor_user):
        self._seed_course(patch_supabase, "C1", professor_user.id)
        patch_supabase.seed("lectures", [])
        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/professor/overview?course_id=C1&days=7",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 200
        data = r.json()["data"]
        assert data["active_students"] == 0
        assert data["lecture_count"] == 0
        assert len(data["activity_sparkline"]) == 7


class TestAIQueriesEndpoint:
    def test_returns_envelope(self, app, patch_supabase, professor_user):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        patch_supabase.seed("slides", [])
        patch_supabase.seed("learning_events", [])

        app.dependency_overrides[verify_token] = lambda: professor_user
        client = TestClient(app)
        r = client.get(
            "/api/analytics/lecture/L1/ai-queries",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 200
        body = r.json()
        assert set(body.keys()) >= {"success", "data"}
