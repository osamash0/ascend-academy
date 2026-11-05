"""The legacy professor analytics never show a learner one by one (Abi, 2026-11-05: no people, ever).

Nothing in the schema tells a v4 Space from a legacy course, so this holds for every course.
"""
from __future__ import annotations

import pytest

from backend.services import analytics_service
from backend.services.insights import engine, evidence


def _student(sid, progress, score, asked=0):
    return {"student_id": sid, "student_name": sid.upper(), "progress_percentage": progress,
            "quiz_score": score, "typology": "x", "ai_interactions": asked, "revisions": 0}


def test_the_legacy_feed_lists_no_strugglers(monkeypatch):
    # Three quiet, stalled learners: exactly what detect_silent_strugglers would name.
    bundle = {"lecture_id": "L1", "total_students": 3, "lecture_avg_dwell": 0.0, "lecture_median_dwell": 0.0,
              "slides": [], "students": [_student("a", 10, 20), _student("b", 20, 30), _student("c", 30, 10)]}
    monkeypatch.setattr(engine, "build_metric_bundle", lambda lecture_id, token=None: bundle)
    assert all(i["kind"] != "silent_strugglers" for i in engine.build_insights("L1", "t"))


def test_there_is_no_journey_of_one_person():
    with pytest.raises(ValueError, match="Unknown evidence kind"):
        evidence.get_evidence("student_journey", "L1", token="t")


# ── the people floor on the two confidence readers ───────────────────────────

OWNER = "owner"


class _Q:
    def __init__(self, table):
        self.table_name = table
        self.event_type = None

    def __getattr__(self, name):
        def chain(*a, **k):
            if name == "eq" and a and a[0] == "event_type":
                self.event_type = a[1]
            return self
        return chain

    def execute(self):
        class R:
            data = [{"professor_id": OWNER}]
        return R()


class _Client:
    def table(self, name):
        return _Q(name)


@pytest.fixture
def world(monkeypatch):
    rows = {
        ("slides", None): [{"id": "s1", "slide_number": 1, "title": "One"},
                           {"id": "s2", "slide_number": 2, "title": "Two"}],
        ("learning_events", "confidence_rating"): [],
        ("learning_events", "quiz_attempt"): [],
        ("learning_events", "slide_view"): [],
        ("quiz_questions", None): [{"id": "q1", "slide_id": "s1"}],
        ("student_progress", None): [],
    }
    monkeypatch.setattr(analytics_service, "get_auth_client", lambda token=None: _Client())
    monkeypatch.setattr(analytics_service, "_fetch_all",
                        lambda q, limit=10000: list(rows.get((q.table_name, q.event_type), [])))
    # no cache: compute directly
    monkeypatch.setattr(analytics_service.analytics_cache, "get_or_compute",
                        lambda lecture_id, view, fn, force_refresh=False: fn())
    return rows


def _rate(uid, slide, rating, at="2026-11-01T10:00:00Z"):
    return {"user_id": uid, "created_at": at,
            "event_data": {"lectureId": "L1", "slideId": slide, "rating": rating}}


def test_a_slide_with_four_raters_is_absent_not_zero(world):
    world[("learning_events", "confidence_rating")] = [_rate(f"u{i}", "s1", "got_it") for i in range(4)]
    assert analytics_service.get_confidence_by_slide("L1", "t") == []


def test_five_people_are_enough_and_counted_as_people(world):
    ev = [_rate(f"u{i}", "s1", "got_it") for i in range(4)]
    # one person rating twice is one person: latest wins
    ev += [_rate("u4", "s1", "got_it", "2026-11-01T10:00:00Z"), _rate("u4", "s1", "confused", "2026-11-01T11:00:00Z")]
    world[("learning_events", "confidence_rating")] = ev
    (row,) = analytics_service.get_confidence_by_slide("L1", "t")
    assert (row["got_it"], row["unsure"], row["confused"], row["total"]) == (4, 0, 1, 5)


def test_the_owner_never_counts_toward_the_floor(world):
    ev = [_rate(f"u{i}", "s1", "got_it") for i in range(4)] + [_rate(OWNER, "s1", "confused")]
    world[("learning_events", "confidence_rating")] = ev
    assert analytics_service.get_confidence_by_slide("L1", "t") == []


def test_the_slides_view_floors_its_confusion_rate_the_same_way(world):
    ev = [_rate(f"u{i}", "s1", "confused") for i in range(4)]
    ev += [_rate(f"v{i}", "s2", "confused") for i in range(5)]
    world[("learning_events", "confidence_rating")] = ev
    by_id = {s["slide_id"]: s for s in analytics_service.get_slide_analytics("L1", "t")}
    assert by_id["s1"]["confusion_rate"] is None
    assert by_id["s2"]["confusion_rate"] == 100.0


def _pair(world, n, owner_too=False):
    users = [f"u{i}" for i in range(n)] + ([OWNER] if owner_too else [])
    world[("learning_events", "confidence_rating")] = [_rate(u, "s1", "got_it") for u in users]
    world[("learning_events", "quiz_attempt")] = [
        {"user_id": u, "created_at": "2026-11-01T10:00:00Z",
         "event_data": {"lectureId": "L1", "questionId": "q1", "correct": True}} for u in users]


def test_a_two_by_two_of_four_people_is_withheld(world):
    _pair(world, 4)
    out = evidence.get_confidence_breakdown_evidence("L1", "s1", "t")
    assert out["total"] == 0 and sum(out["quadrants"].values()) == 0


def test_a_two_by_two_does_not_count_the_owner(world):
    _pair(world, 4, owner_too=True)
    assert evidence.get_confidence_breakdown_evidence("L1", "s1", "t")["total"] == 0


def test_a_two_by_two_of_five_people_is_shown(world):
    _pair(world, 5)
    out = evidence.get_confidence_breakdown_evidence("L1", "s1", "t")
    assert out["total"] == 5 and out["quadrants"]["confidentCorrect"] == 5
