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
        assert self.table_name == "lectures", "only the owner lookup goes through execute()"

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


def test_an_event_without_a_person_is_ignored():
    ev = [{"created_at": "t", "event_data": {"slideId": "s1", "rating": "got_it"}},
          _rate("u1", "s1", "unsure")]
    assert analytics_service.people_ratings(ev, OWNER) == {"s1": {"u1": "unsure"}}


# ── /slides: nothing per slide from fewer than 5 people ─────────────────────

def _view(uid, slide, secs=20):
    return {"user_id": uid, "event_data": {"lectureId": "L1", "slideId": slide, "duration_seconds": secs}}


def _try(uid, question, correct):
    return {"user_id": uid, "event_data": {"lectureId": "L1", "questionId": question, "correct": correct}}


def _slides(world):
    return {s["slide_id"]: s for s in analytics_service.get_slide_analytics("L1", "t")}


def test_the_slides_view_hides_views_time_and_drop_off_under_five_viewers(world):
    world[("student_progress", None)] = [{"user_id": f"u{i}"} for i in range(8)]
    world[("learning_events", "slide_view")] = (
        [_view(f"u{i}", "s1") for i in range(4)] + [_view(f"u{i}", "s2") for i in range(5)])
    s1, s2 = _slides(world)["s1"], _slides(world)["s2"]
    assert s1["view_count"] is None and s1["average_time_seconds"] is None and s1["drop_off_rate"] is None
    assert (s2["view_count"], s2["average_time_seconds"], s2["drop_off_rate"]) == (5, 20.0, 37.5)


def test_the_slides_view_counts_viewers_not_views(world):
    # One person opening a slide four times is one person.
    world[("learning_events", "slide_view")] = [_view("u1", "s1")] * 4 + [_view(f"u{i}", "s1") for i in range(2, 5)]
    assert _slides(world)["s1"]["view_count"] is None


def test_the_owner_is_not_a_viewer(world):
    world[("learning_events", "slide_view")] = [_view(f"u{i}", "s1") for i in range(4)] + [_view(OWNER, "s1")]
    assert _slides(world)["s1"]["view_count"] is None


def test_the_slides_view_hides_the_quiz_under_five_people(world):
    world[("learning_events", "slide_view")] = [_view(f"u{i}", "s1") for i in range(6)]
    world[("learning_events", "quiz_attempt")] = [_try(f"u{i}", "q1", True) for i in range(4)]
    s1 = _slides(world)["s1"]
    assert s1["quiz_attempts"] is None and s1["quiz_success_rate"] is None


def test_the_owner_never_counts_toward_the_quiz_floor(world):
    world[("learning_events", "slide_view")] = [_view(f"u{i}", "s1") for i in range(6)]
    world[("learning_events", "quiz_attempt")] = [_try(f"u{i}", "q1", True) for i in range(4)] + [_try(OWNER, "q1", False)]
    assert _slides(world)["s1"]["quiz_success_rate"] is None


def test_five_people_open_the_quiz_figures(world):
    world[("learning_events", "slide_view")] = [_view(f"u{i}", "s1") for i in range(6)]
    world[("learning_events", "quiz_attempt")] = [_try(f"u{i}", "q1", i < 4) for i in range(5)]
    s1 = _slides(world)["s1"]
    assert (s1["quiz_attempts"], s1["quiz_success_rate"]) == (5, 80.0)


def test_a_slide_too_few_viewed_gets_no_recommendation_built_on_one_person(world):
    # Four viewers, one failing quiz try: no "low quiz success" reason may come out of it.
    world[("learning_events", "slide_view")] = [_view(f"u{i}", "s1") for i in range(4)]
    world[("learning_events", "quiz_attempt")] = [_try("u1", "q1", False)]
    s1 = _slides(world)["s1"]
    assert (s1["recommendation_label"], s1["recommendation_reasons"]) == ("insufficient_data", ["low_view_count"])


def test_ask_your_data_does_not_rank_a_slide_with_a_null_drop_off(monkeypatch):
    from backend.services.ai import ask_data

    rows = [{"slide_number": 1, "title": "A", "drop_off_rate": None, "view_count": None},
            {"slide_number": 2, "title": "B", "drop_off_rate": 40.0, "view_count": 9}]
    monkeypatch.setattr(analytics_service, "get_slide_analytics", lambda *a, **k: rows)
    out = ask_data._exec_top_dropoff_slides("L1", "t", {})
    assert [r["slide"] for r in out["table"]] == ["#2 — B"]


# ── /dashboard: how many, never who ─────────────────────────────────────────

def test_the_dashboard_counts_people_per_score_band_and_only_from_five():
    from backend.services.analytics_service import score_bands

    assert score_bands([10, 90, 55, 61, 20]) == [2, 0, 1, 1, 1]
    assert score_bands([None, 100, 40, 41, 80, 81]) == [1, 1, 1, 1, 2]
    assert score_bands([10, 20, 30, 40]) == []


def test_no_ask_answers_with_a_list_of_learners():
    from backend.services.ai import ask_data, ask_professor

    for module in (ask_data, ask_professor):
        assert "struggling_students" not in module.INTENTS
        assert "struggling_students" not in module._EXECUTORS


class _Conn:
    """Just enough of an asyncpg connection for get_dashboard_data, keyed on the SQL text."""

    def __init__(self, progress, ratings):
        self.progress, self.ratings = progress, ratings

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def fetchrow(self, sql, *a):
        if "uniqueStudents" in sql:
            return {"uniqueStudents": len(self.progress), "totalAttempts": 0, "totalCorrect": 0, "averageScore": 0}
        raise AssertionError("the confidence map must not be counted in SQL: " + sql[:60])

    async def fetchval(self, sql, *a):
        if "professor_id" in sql:
            return OWNER
        return 2

    async def fetch(self, sql, *a):
        if "confidence_rating" in sql:
            return list(self.ratings)
        if "student_progress p" in sql:
            return [{"student_id": p["user_id"], "quiz_score": p["quiz_score"]} for p in self.progress]
        return []


def _dash(monkeypatch, ratings, progress=()):
    import asyncio

    async def conn():
        return _Conn(list(progress), ratings)

    monkeypatch.setattr(analytics_service, "get_db_connection", conn)
    monkeypatch.setattr(analytics_service.analytics_cache, "get_or_compute_async",
                        lambda lecture_id, view, fn, **k: fn())
    return asyncio.run(analytics_service.get_dashboard_data("L1", "t"))


def _drate(uid, slide, rating):
    return {"user_id": uid, "event_data": {"lectureId": "L1", "slideId": slide, "rating": rating}}


def test_the_dashboard_lists_no_learner_and_carries_score_bands(monkeypatch):
    progress = [{"user_id": f"u{i}", "quiz_score": 10 * i} for i in range(5)]
    out = _dash(monkeypatch, [], progress)
    assert "studentsMatrix" not in out
    assert out["scoreBands"] == [3, 2, 0, 0, 0]
    assert "u1" not in repr(out)


def test_the_dashboard_hides_score_bands_under_five_people(monkeypatch):
    out = _dash(monkeypatch, [], [{"user_id": f"u{i}", "quiz_score": 50} for i in range(4)])
    assert out["scoreBands"] == []


def test_the_dashboards_confidence_counts_people_and_skips_a_slide_under_five(monkeypatch):
    ratings = [_drate(f"u{i}", "s1", "got_it") for i in range(4)]      # 4 people: left out
    ratings += [_drate(f"v{i}", "s2", "unsure") for i in range(5)]     # 5 people: counted
    out = _dash(monkeypatch, ratings)
    assert out["confidenceMap"] == {"got_it": 0, "unsure": 5, "confused": 0}


def test_the_dashboards_confidence_is_latest_per_person_and_not_the_owner(monkeypatch):
    ratings = [_drate(f"u{i}", "s1", "got_it") for i in range(3)]
    ratings += [_drate("u3", "s1", "got_it"), _drate("u3", "s1", "confused"),   # one person, latest wins
                _drate("u3", "s1", "confused")]
    ratings += [_drate(OWNER, "s1", "confused")]                                # owner never counts
    assert _dash(monkeypatch, ratings)["confidenceMap"] == {"got_it": 0, "unsure": 0, "confused": 0}  # 4 people
    ratings.append(_drate("u4", "s1", "got_it"))
    assert _dash(monkeypatch, ratings)["confidenceMap"] == {"got_it": 4, "unsure": 0, "confused": 1}


def test_the_dashboard_owner_does_not_count_toward_score_bands(monkeypatch):
    progress = [{"user_id": f"u{i}", "quiz_score": 50} for i in range(4)] + [{"user_id": OWNER, "quiz_score": 50}]
    assert _dash(monkeypatch, [], progress)["scoreBands"] == []
