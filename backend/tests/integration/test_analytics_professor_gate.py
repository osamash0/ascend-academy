"""Per-lecture analytics answer only professors, even when a student owns the lecture.

Students may create courses (a v4 Space is a course), so a student can own a
lecture. These routes describe the lecture's members, and the frontend shows
them to professors only; the backend now says the same, before any data is read.
"""
import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import verify_token

PER_LECTURE_ROUTES = [
    ("get", "overview"),
    ("get", "slides"),
    ("get", "quizzes"),
    ("get", "students"),
    ("get", "dashboard"),
    ("get", "insights"),
    ("get", "evidence?kind=confidence_breakdown"),
    ("get", "distractors"),
    ("get", "dropoff"),
    ("get", "confidence-by-slide"),
    ("get", "ai-queries"),
    ("get", "retry-performance"),
    ("post", "cache/refresh"),
]


def _seed_owned_lecture(fake, lecture_id, owner_id):
    fake.seed(
        "lectures",
        [{"id": lecture_id, "professor_id": owner_id, "title": "Owned", "total_slides": 1}],
    )


@pytest.mark.parametrize("method,route", PER_LECTURE_ROUTES)
def test_a_student_who_owns_the_lecture_is_refused(app, patch_supabase, student_user, method, route):
    _seed_owned_lecture(patch_supabase, "L1", student_user.id)
    app.dependency_overrides[verify_token] = lambda: student_user
    client = TestClient(app)

    r = getattr(client, method)(
        f"/api/analytics/lecture/L1/{route}",
        headers={"Authorization": "Bearer fake-token"},
    )

    assert r.status_code == 403
    assert r.json()["detail"] == "Insufficient permissions for this action."


def test_every_per_lecture_route_is_covered():
    """A new per-lecture analytics route must join the list above (and the gate)."""
    from backend.api.v1 import analytics

    base = f"{analytics.router.prefix}/lecture/{{lecture_id}}/"
    paths = {
        (sorted(route.methods)[0].lower(), route.path[len(base):])
        for route in analytics.router.routes
        if route.path.startswith(base)
        # these two already required the professor role before this change
        and not route.path[len(base):].startswith("ask")
        and route.path[len(base):] != "benchmarks"
    }
    listed = {(m, r.split("?")[0]) for m, r in PER_LECTURE_ROUTES}
    assert paths == listed


def test_the_professor_who_owns_the_lecture_still_gets_in(app, patch_supabase, professor_user):
    _seed_owned_lecture(patch_supabase, "L1", professor_user.id)
    patch_supabase.seed("slides", [{"id": "s1", "lecture_id": "L1", "slide_number": 1, "title": "T1"}])
    patch_supabase.seed("student_progress", [])
    patch_supabase.seed("learning_events", [])
    patch_supabase.seed("quiz_questions", [])
    app.dependency_overrides[verify_token] = lambda: professor_user
    client = TestClient(app)

    r = client.get("/api/analytics/lecture/L1/overview", headers={"Authorization": "Bearer fake-token"})

    assert r.status_code == 200
