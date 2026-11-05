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
        # Five people: u0 read 2 of 4 slides, the rest 1 of 4; each answered 4, u0 got all 4 right.
        patch_supabase.seed("student_progress", [
            {"user_id": f"u{i}", "lecture_id": "L1", "completed_slides": [1, 2] if i == 0 else [1],
             "quiz_score": 50, "total_questions_answered": 4, "correct_answers": 4 if i == 0 else 1}
            for i in range(5)
        ])
        patch_supabase.seed("quiz_questions", [
            {"id": "q1", "slide_id": "s1", "metadata": {"concept": "Recursion"}},
            {"id": "q2", "slide_id": "s2", "metadata": {"concept": "Pointers"}},
        ])
        events = []
        for i in range(5):
            events.append({"user_id": f"u{i}", "event_type": "quiz_attempt", "created_at": now,
                           "event_data": {"lectureId": "L1", "questionId": "q1", "slideId": "s1", "correct": False}})
            events.append({"user_id": f"u{i}", "event_type": "lecture_complete", "created_at": now,
                           "event_data": {"lectureId": "L1", "total_duration_seconds": 600}})
        patch_supabase.seed("learning_events", events)

        data = self._overview(app, professor_user)
        assert data["active_students"] == 5
        assert data["lecture_count"] == 1
        # u0: 2/4 = 50%, four people 1/4 = 25% → mean over people 30.0
        assert data["average_completion"] == 30.0
        # per person: 100%, 25%, 25%, 25%, 25% → 40.0 (attempt-weighted would be 8/20 = 40.0 too;
        # the weighting itself is pinned by test_quiz_accuracy_is_a_mean_over_people)
        assert data["average_quiz_accuracy"] == 40.0
        assert data["median_time_minutes"] == 10.0
        assert len(data["activity_sparkline"]) == 7
        assert self._today(data)["people"] == 5
        # Recursion: five people, each wrong on the first try → 100% miss
        concepts = {c["concept"]: c for c in data["weakest_concepts"]}
        assert concepts["Recursion"] == {"concept": "Recursion", "miss_rate": 100.0, "attempts": 5}
        assert "Pointers" not in concepts

    # ── the floor: people, never the owner, five or nothing ──────────────────

    @staticmethod
    def _overview(app, professor_user):
        app.dependency_overrides[verify_token] = lambda: professor_user
        r = TestClient(app).get(
            "/api/analytics/professor/overview?course_id=C1&days=7",
            headers={"Authorization": "Bearer fake-token"},
        )
        assert r.status_code == 200, r.text
        return r.json()["data"]

    @staticmethod
    def _today(data):
        from datetime import datetime, timezone as _tz
        today = datetime.now(_tz.utc).date().isoformat()
        return next(b for b in data["activity_sparkline"] if b["date"] == today)

    def _seed_world(self, fake, professor_user, people, events=(), progress=None, questions=(), slides=()):
        self._seed_course(fake, "C1", professor_user.id)
        fake.seed("lectures", [
            {"id": "L1", "course_id": "C1", "professor_id": professor_user.id,
             "title": "Lecture 1", "total_slides": 4, "created_at": "2026-01-01"},
        ])
        fake.seed("slides", list(slides) or [{"id": "s1", "lecture_id": "L1", "slide_number": 1, "title": "Joins"}])
        fake.seed("quiz_questions", list(questions))
        fake.seed("student_progress", progress if progress is not None else [
            {"user_id": u, "lecture_id": "L1", "completed_slides": [1], "quiz_score": 50,
             "total_questions_answered": 2, "correct_answers": 1} for u in people])
        fake.seed("learning_events", list(events))

    @staticmethod
    def _seen(uid, at=None):
        from datetime import datetime, timezone
        return {"user_id": uid, "event_type": "slide_view",
                "created_at": at or datetime.now(timezone.utc).isoformat(),
                "event_data": {"lectureId": "L1", "slideId": "s1"}}

    @staticmethod
    def _try(uid, qid, correct, at):
        return {"user_id": uid, "event_type": "quiz_attempt", "created_at": at,
                "event_data": {"lectureId": "L1", "questionId": qid, "slideId": "s1", "correct": correct}}

    def test_four_people_say_nothing(self, app, patch_supabase, professor_user):
        people = [f"u{i}" for i in range(4)]
        self._seed_world(patch_supabase, professor_user, people, events=[self._seen(u) for u in people])
        data = self._overview(app, professor_user)
        assert data["active_students"] is None
        assert data["average_completion"] is None
        assert data["average_quiz_accuracy"] is None
        assert data["median_time_minutes"] is None
        assert all(b["people"] is None for b in data["activity_sparkline"])

    def test_the_owner_never_counts(self, app, patch_supabase, professor_user):
        people = [f"u{i}" for i in range(4)] + [professor_user.id]
        self._seed_world(patch_supabase, professor_user, people, events=[self._seen(u) for u in people])
        data = self._overview(app, professor_user)
        assert data["active_students"] is None
        assert data["average_completion"] is None
        assert self._today(data)["people"] is None

    def test_active_students_and_the_sparkline_count_people_not_events(self, app, patch_supabase, professor_user):
        people = [f"u{i}" for i in range(5)]
        events = [self._seen(u) for u in people] + [self._seen("u0")] * 30 + [self._seen(professor_user.id)]
        self._seed_world(patch_supabase, professor_user, people, events=events)
        data = self._overview(app, professor_user)
        assert data["active_students"] == 5
        assert self._today(data)["people"] == 5
        # a day no one was active is under the floor: None, never 0
        assert [b["people"] for b in data["activity_sparkline"][:-1]] == [None] * 6

    def test_completion_is_a_mean_over_people_without_the_owner(self, app, patch_supabase, professor_user):
        people = [f"u{i}" for i in range(5)]
        progress = [
            # u0 has two progress rows (two lectures' worth): 4/4 and 0/4 → 50% for u0
            {"user_id": "u0", "lecture_id": "L1", "completed_slides": [1, 2, 3, 4]},
            {"user_id": "u0", "lecture_id": "L1", "completed_slides": []},
        ] + [{"user_id": f"u{i}", "lecture_id": "L1", "completed_slides": [1]} for i in range(1, 5)] + [
            {"user_id": professor_user.id, "lecture_id": "L1", "completed_slides": [1, 2, 3, 4]}]
        self._seed_world(patch_supabase, professor_user, people, progress=progress,
                         events=[self._seen(u) for u in people])
        # per person: 50, 25, 25, 25, 25 → 30.0 (per row, with the owner, it would be 50.0)
        assert self._overview(app, professor_user)["average_completion"] == 30.0

    def test_quiz_accuracy_is_a_mean_over_people(self, app, patch_supabase, professor_user):
        people = [f"u{i}" for i in range(5)]
        progress = [{"user_id": "u0", "lecture_id": "L1", "completed_slides": [1],
                     "total_questions_answered": 100, "correct_answers": 100}] + [
            {"user_id": f"u{i}", "lecture_id": "L1", "completed_slides": [1],
             "total_questions_answered": 1, "correct_answers": 0} for i in range(1, 5)] + [
            {"user_id": professor_user.id, "lecture_id": "L1", "completed_slides": [1],
             "total_questions_answered": 50, "correct_answers": 50}]
        self._seed_world(patch_supabase, professor_user, people, progress=progress,
                         events=[self._seen(u) for u in people])
        # per person: 100, 0, 0, 0, 0 → 20.0 (attempt-weighted it would be 100/104 = 96.2)
        assert self._overview(app, professor_user)["average_quiz_accuracy"] == 20.0

    def test_quiz_accuracy_needs_five_people_who_answered(self, app, patch_supabase, professor_user):
        people = [f"u{i}" for i in range(5)]
        progress = [{"user_id": u, "lecture_id": "L1", "completed_slides": [1],
                     "total_questions_answered": 1 if u != "u4" else 0, "correct_answers": 1} for u in people]
        self._seed_world(patch_supabase, professor_user, people, progress=progress,
                         events=[self._seen(u) for u in people])
        data = self._overview(app, professor_user)
        assert data["average_completion"] == 25.0
        assert data["average_quiz_accuracy"] is None

    def test_median_time_is_over_people(self, app, patch_supabase, professor_user):
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        people = [f"u{i}" for i in range(5)]

        def done(uid, secs):
            return {"user_id": uid, "event_type": "lecture_complete", "created_at": now,
                    "event_data": {"lectureId": "L1", "total_duration_seconds": secs}}
        # u0 finished six times at 60 min; four people once at 10 min; the owner at 90 min.
        events = [done("u0", 3600)] * 6 + [done(f"u{i}", 600) for i in range(1, 5)] + [done(professor_user.id, 5400)]
        self._seed_world(patch_supabase, professor_user, people, events=events)
        # per person: 60, 10, 10, 10, 10 → median 10.0 (per event it would be 60.0)
        assert self._overview(app, professor_user)["median_time_minutes"] == 10.0

    def test_median_time_needs_five_people(self, app, patch_supabase, professor_user):
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        people = [f"u{i}" for i in range(5)]
        events = [self._seen(u) for u in people] + [
            {"user_id": f"u{i}", "event_type": "lecture_complete", "created_at": now,
             "event_data": {"lectureId": "L1", "total_duration_seconds": 600}} for i in range(4)]
        self._seed_world(patch_supabase, professor_user, people, events=events)
        data = self._overview(app, professor_user)
        assert data["active_students"] == 5
        assert data["median_time_minutes"] is None

    def test_a_weak_concept_counts_people_on_their_first_try(self, app, patch_supabase, professor_user):
        from datetime import datetime, timedelta, timezone
        t0 = datetime.now(timezone.utc) - timedelta(hours=2)
        first, later = t0.isoformat(), (t0 + timedelta(minutes=5)).isoformat()
        people = [f"u{i}" for i in range(5)]
        questions = [{"id": "q1", "slide_id": "s1", "metadata": {"concept": "Joins"}}]
        # u0 is right first, then retries wrong ten times; four people are wrong first; the owner is wrong.
        events = [self._try("u0", "q1", True, first)] + [self._try("u0", "q1", False, later)] * 10
        events += [self._try(f"u{i}", "q1", False, first) for i in range(1, 5)]
        events += [self._try(professor_user.id, "q1", False, first)]
        self._seed_world(patch_supabase, professor_user, people, events=events, questions=questions)
        (row,) = self._overview(app, professor_user)["weakest_concepts"]
        assert row == {"concept": "Joins", "miss_rate": 80.0, "attempts": 5}

    def test_a_concept_four_people_tried_is_absent(self, app, patch_supabase, professor_user):
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        people = [f"u{i}" for i in range(4)]
        questions = [{"id": "q1", "slide_id": "s1", "metadata": {"concept": "Joins"}}]
        events = [self._try(u, "q1", False, now) for u in people] + [self._try(professor_user.id, "q1", False, now)]
        events += [self._try("u0", "q1", False, now)] * 10
        self._seed_world(patch_supabase, professor_user, people, events=events, questions=questions)
        data = self._overview(app, professor_user)
        assert data["weakest_concepts"] == [] and data["weakest_slides"] == []

    def test_a_weak_slide_counts_people_and_needs_five(self, app, patch_supabase, professor_user):
        from datetime import datetime, timedelta, timezone
        t0 = datetime.now(timezone.utc) - timedelta(hours=2)
        first, later = t0.isoformat(), (t0 + timedelta(minutes=5)).isoformat()
        slides = [{"id": "s1", "lecture_id": "L1", "slide_number": 1, "title": "Joins"},
                  {"id": "s2", "lecture_id": "L1", "slide_number": 2, "title": "Keys"}]
        questions = [{"id": "q1", "slide_id": "s1", "metadata": {}}, {"id": "q2", "slide_id": "s2", "metadata": {}}]
        people = [f"u{i}" for i in range(5)]
        events = [self._try(u, "q1", u != "u0", first) for u in people]
        events += [self._try("u0", "q1", True, later)] * 10
        # s2: four people, each many times
        events += [self._try(f"u{i}", "q2", False, first) for i in range(4) for _ in range(5)]
        self._seed_world(patch_supabase, professor_user, people, events=events, questions=questions, slides=slides)
        data = self._overview(app, professor_user)
        assert data["weakest_concepts"] == []
        assert data["weakest_slides"] == [{"slide_id": "s1", "title": "Joins", "miss_rate": 20.0, "attempts": 5}]

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
            {"user_id": "u4", "event_type": "slide_view", "created_at": now,
             "event_data": {"lectureId": "L1"}},
            {"user_id": "u5", "event_type": "confidence_rating", "created_at": now,
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
        # All five of our people must be counted regardless of noise volume.
        assert data["active_students"] == 5
        assert self._today(data)["people"] == 5

    def test_empty_course_says_nothing(self, app, patch_supabase, professor_user):
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
        assert data["active_students"] is None
        assert data["average_completion"] is None and data["average_quiz_accuracy"] is None
        assert data["median_time_minutes"] is None
        assert data["lecture_count"] == 0
        assert [b["people"] for b in data["activity_sparkline"]] == [None] * 7


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
