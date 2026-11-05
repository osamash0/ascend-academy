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

    def __init__(self, progress, ratings, events=(), slides=(), questions=()):
        self.progress, self.ratings = progress, ratings
        self.events, self.slides, self.questions = list(events), list(slides), list(questions)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def fetchval(self, sql, *a):
        assert "professor_id" in sql
        return OWNER

    async def fetch(self, sql, *a):
        if "confidence_rating" in sql:
            return list(self.ratings)
        if "FROM student_progress" in sql:
            return [{"user_id": p["user_id"], "quiz_score": p["quiz_score"],
                     "total_questions_answered": p.get("answered", 1),
                     "correct_answers": p.get("correct", 0)} for p in self.progress]
        if "FROM slides s" in sql:
            return list(self.slides)
        if "FROM quiz_questions" in sql:
            return list(self.questions)
        if "FROM learning_events" in sql:
            return list(self.events)
        raise AssertionError("unexpected SQL: " + sql[:60])


def _dash(monkeypatch, ratings, progress=(), events=(), slides=(), questions=()):
    import asyncio

    async def conn():
        return _Conn(list(progress), ratings, events, slides, questions)

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
    assert _dash(monkeypatch, ratings)["confidenceMap"] is None  # 4 people
    ratings.append(_drate("u4", "s1", "got_it"))
    assert _dash(monkeypatch, ratings)["confidenceMap"] == {"got_it": 4, "unsure": 0, "confused": 1}


def test_the_dashboard_owner_does_not_count_toward_score_bands(monkeypatch):
    progress = [{"user_id": f"u{i}", "quiz_score": 50} for i in range(4)] + [{"user_id": OWNER, "quiz_score": 50}]
    assert _dash(monkeypatch, [], progress)["scoreBands"] == []


def test_the_dashboards_confidence_is_null_not_zero_under_the_floor(monkeypatch):
    out = _dash(monkeypatch, [_drate(f"u{i}", "s1", "got_it") for i in range(4)])
    assert out["confidenceMap"] is None
    assert out["overview"]["totalEvents"] is None


def test_the_dashboards_confidence_is_present_at_five_people(monkeypatch):
    out = _dash(monkeypatch, [_drate(f"u{i}", "s1", "got_it") for i in range(5)])
    assert out["confidenceMap"] == {"got_it": 5, "unsure": 0, "confused": 0}
    assert out["overview"]["totalEvents"] == 5


def test_people_who_only_opened_the_lesson_do_not_make_a_score_band(monkeypatch):
    # Five progress rows, none answered a question: nothing to draw, not [5,0,0,0,0].
    progress = [{"user_id": f"u{i}", "quiz_score": 0, "answered": 0} for i in range(5)]
    assert _dash(monkeypatch, [], progress)["scoreBands"] == []
    progress += [{"user_id": f"q{i}", "quiz_score": 90, "answered": 3} for i in range(5)]
    assert _dash(monkeypatch, [], progress)["scoreBands"] == [0, 0, 0, 0, 5]


# ── quizzes, distractors, retry-performance: people, first try, from 5 ──────

def _ask(uid, question, correct, selected=None):
    ed = {"lectureId": "L1", "questionId": question, "correct": correct}
    if selected is not None:
        ed["selectedAnswer"] = selected
    return {"user_id": uid, "event_data": ed}


@pytest.fixture
def quiz_world(world):
    world[("quiz_questions", None)] = [{"id": "q1", "slide_id": "s1", "question_text": "Q one",
                                         "options": ["a", "b", "c"], "correct_answer": 0}]
    world[("learning_events", "quiz_retry_attempt")] = []
    return world


def test_a_question_four_people_tried_has_no_success_rate(quiz_world):
    quiz_world[("learning_events", "quiz_attempt")] = [_ask(f"u{i}", "q1", True) for i in range(4)]
    (row,) = analytics_service.get_quiz_analytics("L1", "t")
    assert (row["success_rate"], row["attempts"], row["difficulty"]) == (None, None, None)


def test_five_people_open_a_question_and_a_retrier_counts_once(quiz_world):
    # u0 fails, retries the same question three times and gets it right: one person, first try wins.
    ev = [_ask("u0", "q1", False)] + [_ask("u0", "q1", True)] * 3 + [_ask(f"u{i}", "q1", True) for i in range(1, 5)]
    quiz_world[("learning_events", "quiz_attempt")] = ev
    (row,) = analytics_service.get_quiz_analytics("L1", "t")
    assert (row["success_rate"], row["attempts"]) == (80.0, 5)


def test_one_person_trying_many_times_never_reaches_the_floor(quiz_world):
    ev = [_ask("u0", "q1", True)] * 10 + [_ask(f"u{i}", "q1", True) for i in range(1, 4)]
    quiz_world[("learning_events", "quiz_attempt")] = ev
    assert analytics_service.get_quiz_analytics("L1", "t")[0]["success_rate"] is None


def test_the_owner_is_not_counted_on_a_question(quiz_world):
    quiz_world[("learning_events", "quiz_attempt")] = (
        [_ask(f"u{i}", "q1", True) for i in range(4)] + [_ask(OWNER, "q1", False)])
    assert analytics_service.get_quiz_analytics("L1", "t")[0]["success_rate"] is None


def test_withheld_questions_sort_after_the_ranked_ones(quiz_world):
    quiz_world[("quiz_questions", None)] += [{"id": "q2", "slide_id": "s1", "question_text": "Q two",
                                               "options": [], "correct_answer": 0}]
    quiz_world[("learning_events", "quiz_attempt")] = [_ask(f"u{i}", "q2", i < 2) for i in range(5)]
    assert [r["question_id"] for r in analytics_service.get_quiz_analytics("L1", "t")] == ["q2", "q1"]


def test_distractor_shares_need_five_people(quiz_world):
    quiz_world[("learning_events", "quiz_attempt")] = [_ask(f"u{i}", "q1", False, 1) for i in range(4)]
    (row,) = analytics_service.get_distractor_analysis("L1", "t")
    assert row["answer_distribution"] == {} and row["total_attempts"] is None
    assert row["most_common_wrong_answer"] is None and row["all_common_wrong_answers"] == []


def test_distractor_shares_count_people_and_not_the_owner(quiz_world):
    ev = [_ask(f"u{i}", "q1", False, 1) for i in range(3)] + [_ask("u3", "q1", False, 2)]
    ev += [_ask("u3", "q1", True, 0)] * 2          # u3 trying again does not add a person
    quiz_world[("learning_events", "quiz_attempt")] = ev + [_ask(OWNER, "q1", True, 0)]
    assert analytics_service.get_distractor_analysis("L1", "t")[0]["total_attempts"] is None
    quiz_world[("learning_events", "quiz_attempt")] = ev + [_ask("u4", "q1", True, 0)]
    (row,) = analytics_service.get_distractor_analysis("L1", "t")
    assert row["answer_distribution"] == {"1": 3, "2": 1, "0": 1}
    assert (row["total_attempts"], row["most_common_wrong_answer"]) == (5, 1)


def test_retry_performance_floors_each_side_by_people(quiz_world):
    quiz_world[("learning_events", "quiz_attempt")] = [_ask(f"u{i}", "q1", i < 2) for i in range(5)]
    quiz_world[("learning_events", "quiz_retry_attempt")] = [_ask(f"u{i}", "q1", True) for i in range(4)]
    (row,) = analytics_service.get_retry_performance("L1", "t")
    assert (row["first_attempt_total"], row["first_attempt_miss_rate"]) == (5, 60.0)
    assert (row["retry_total"], row["retry_misses"], row["retry_miss_rate"]) == (None, None, None)


def test_retry_performance_counts_a_repeat_retrier_once_and_skips_the_owner(quiz_world):
    quiz_world[("learning_events", "quiz_attempt")] = [_ask(f"u{i}", "q1", False) for i in range(4)] + [_ask(OWNER, "q1", False)]
    quiz_world[("learning_events", "quiz_retry_attempt")] = [_ask("u0", "q1", True)] * 6
    (row,) = analytics_service.get_retry_performance("L1", "t")
    assert row["first_attempt_total"] is None and row["retry_total"] is None


# ── /dashboard overview, slide figures, the week, the question feed ─────────

def _prog(i, answered=2, correct=1, score=50):
    return {"user_id": f"u{i}", "quiz_score": score, "answered": answered, "correct": correct}


def test_the_dashboard_overview_is_none_under_five_people(monkeypatch):
    out = _dash(monkeypatch, [], [_prog(i) for i in range(4)])["overview"]
    assert (out["uniqueStudents"], out["averageScore"], out["totalAttempts"], out["totalCorrect"]) == (None,) * 4


def test_the_dashboard_overview_shows_from_five_people(monkeypatch):
    out = _dash(monkeypatch, [], [_prog(i, answered=4, correct=3) for i in range(5)])["overview"]
    assert (out["uniqueStudents"], out["averageScore"], out["totalAttempts"], out["totalCorrect"]) == (5, 75, 20, 15)


def test_the_dashboard_overview_leaves_the_owner_out(monkeypatch):
    progress = [_prog(i) for i in range(4)] + [{"user_id": OWNER, "quiz_score": 100, "answered": 9, "correct": 9}]
    out = _dash(monkeypatch, [], progress)["overview"]
    assert out["uniqueStudents"] is None and out["averageScore"] is None


def test_openers_make_students_but_only_answerers_make_a_score(monkeypatch):
    progress = [_prog(i, answered=0, correct=0) for i in range(5)]
    out = _dash(monkeypatch, [], progress)["overview"]
    assert out["uniqueStudents"] == 5 and out["averageScore"] is None and out["totalAttempts"] is None


def _ev(uid, kind, slide="s1", **data):
    return {"user_id": uid, "type": kind, "time": "2026-11-05 10:00:00", "day": "2026-11-05", "recent": True,
            "event_data": {"lectureId": "L1", "slideId": slide, **data}}


SLIDES = [{"id": "s1", "name": "One"}, {"id": "s2", "name": "Two"}]


def _slide_by_id(out):
    return {s["id"]: s for s in out["slidePerformance"]}


def test_slide_figures_need_five_people_each(monkeypatch):
    events = [_ev(f"u{i}", "slide_view", duration_seconds=30) for i in range(4)]        # 4 viewers: no time
    events += [_ev(f"u{i}", "quiz_attempt", correct=i < 3, questionId="q1") for i in range(4)]
    s1 = _slide_by_id(_dash(monkeypatch, [], events=events, slides=SLIDES))["s1"]
    assert s1["avgDuration"] is None and s1["correctRate"] is None and s1["quizAttempts"] is None
    assert s1["aiQueries"] is None and s1["revisions"] is None and s1["confusionIndex"] is None


def test_slide_figures_show_from_five_people_and_count_people(monkeypatch):
    events = [_ev(f"u{i}", "slide_view", duration_seconds=30) for i in range(5)]
    events += [_ev(f"u{i}", "quiz_attempt", correct=i < 4, questionId="q1") for i in range(5)]
    events += [_ev("u0", "quiz_attempt", correct=True, questionId="q1")] * 3   # u0 retrying: first try stands
    events += [_ev("u1", "ai_tutor_query", query="why?")] * 4                  # one asker, four questions
    s1 = _slide_by_id(_dash(monkeypatch, [], events=events, slides=SLIDES))["s1"]
    assert (s1["avgDuration"], s1["correctRate"], s1["quizAttempts"]) == (30, 80, 5)
    assert s1["aiQueries"] is None            # one person asked: under the floor, however many times
    assert s1["confusionIndex"] == 30 + 10 + 10


def test_the_owner_does_not_make_a_slide_figure(monkeypatch):
    events = [_ev(f"u{i}", "slide_view", duration_seconds=30) for i in range(4)] + [_ev(OWNER, "slide_view", duration_seconds=30)]
    assert _slide_by_id(_dash(monkeypatch, [], events=events, slides=SLIDES))["s1"]["avgDuration"] is None


def test_the_week_is_counts_of_people_per_kind_and_never_one_event(monkeypatch):
    events = [_ev(f"u{i}", "quiz_attempt", correct=True) for i in range(5)]
    events += [_ev(f"u{i}", "slide_back_navigation", fromSlideId="s1") for i in range(4)]
    out = _dash(monkeypatch, [], events=events)
    assert out["liveTicker"] == [{"type": "quiz_attempt", "people": 5}]
    assert all(set(row) == {"type", "people"} for row in out["liveTicker"])


def test_the_week_says_nothing_when_one_person_did_it_often(monkeypatch):
    events = [_ev("u0", "quiz_attempt", correct=True)] * 20
    out = _dash(monkeypatch, [], events=events)
    assert out["liveTicker"] == [] and out["activityByDay"] == [] and out["overview"]["totalEvents"] is None


def test_the_week_leaves_out_older_events_and_the_owner(monkeypatch):
    events = [_ev(f"u{i}", "quiz_attempt", correct=True) for i in range(4)] + [_ev(OWNER, "quiz_attempt", correct=True)]
    events += [{**_ev("u9", "quiz_attempt", correct=True), "recent": False}]
    assert _dash(monkeypatch, [], events=events)["liveTicker"] == []


def _asked(uid, text="what is a join?"):
    return _ev(uid, "ai_tutor_query", query=text, slideTitle="Joins")


def test_the_question_feed_needs_five_askers(monkeypatch):
    events = [_asked(f"u{i}") for i in range(4)] + [_asked("u0", "again?")] * 3
    assert _dash(monkeypatch, [], events=events)["aiQueryFeed"] == []


def test_the_question_feed_shows_five_askers_word_for_word_with_no_identity(monkeypatch):
    events = [_asked(f"u{i}", f"question {i}") for i in range(5)]
    feed = _dash(monkeypatch, [], events=events)["aiQueryFeed"]
    assert [f["query_text"] for f in feed] == [f"question {i}" for i in (4, 3, 2, 1, 0)]
    assert all(set(f) == {"slide_title", "query_text", "created_at"} for f in feed)
    assert "u1" not in repr(feed)


def test_the_owner_is_not_a_question_asker(monkeypatch):
    events = [_asked(f"u{i}") for i in range(4)] + [_asked(OWNER)]
    assert _dash(monkeypatch, [], events=events)["aiQueryFeed"] == []


def test_the_v4_askers_do_not_count_toward_the_legacy_feed(monkeypatch):
    events = [_asked(f"u{i}") for i in range(4)] + [_ev("v1", "ai_tutor_query", query="q", source="v4_reader")]
    assert _dash(monkeypatch, [], events=events)["aiQueryFeed"] == []


def test_the_dashboard_retry_table_floors_by_people(monkeypatch):
    questions = [{"id": "q1", "question_text": "Q"}]
    events = [_ev(f"u{i}", "quiz_attempt", correct=False, questionId="q1") for i in range(4)]
    events += [_ev("u0", "quiz_retry_attempt", correct=True, questionId="q1")] * 5
    (row,) = _dash(monkeypatch, [], events=events, questions=questions)["retryPerformance"]
    assert row["first_attempt_total"] is None and row["retry_total"] is None


def test_the_ai_query_route_view_floors_too(world):
    world[("learning_events", "ai_tutor_query")] = [
        {"user_id": f"u{i}", "created_at": "t", "event_data": {"lectureId": "L1", "query": "why?", "slideTitle": "S"}}
        for i in range(4)]
    assert analytics_service.get_ai_query_feed("L1", "t") == []
    world[("learning_events", "ai_tutor_query")].append(
        {"user_id": "u4", "created_at": "t", "event_data": {"lectureId": "L1", "query": "how?"}})
    assert len(analytics_service.get_ai_query_feed("L1", "t")) == 5


# ── Ask: totals and averages over people, from 5 ────────────────────────────

def _progress(n, owner_too=False, answered=1):
    rows = [{"user_id": f"u{i}", "lecture_id": "L1", "completed_at": "t" if i < 2 else None,
             "quiz_score": 60, "total_questions_answered": answered} for i in range(n)]
    if owner_too:
        rows.append({"user_id": OWNER, "lecture_id": "L1", "completed_at": "t", "quiz_score": 100,
                     "total_questions_answered": 5})
    return rows


def test_the_lecture_overview_is_none_under_five_people_and_ignores_the_owner(world):
    world[("student_progress", None)] = _progress(4, owner_too=True)
    out = analytics_service.get_lecture_overview("L1", "t")
    assert out["total_students"] is None and out["completion_rate"] is None and out["average_score"] is None


def test_the_lecture_overview_counts_people_from_five(world):
    world[("student_progress", None)] = _progress(5, owner_too=True)
    out = analytics_service.get_lecture_overview("L1", "t")
    assert (out["total_students"], out["completion_rate"], out["average_score"]) == (5, 40.0, 60.0)


def test_ask_completion_count_says_too_few_under_five(world, monkeypatch):
    from backend.services.ai import ask_data

    world[("student_progress", None)] = _progress(4)
    out = ask_data._exec_completion_count("L1", "t", {})
    assert out["table"] == [] and "Too few" in out["answer_text"]
    world[("student_progress", None)] = _progress(5)
    out = ask_data._exec_completion_count("L1", "t", {})
    assert {"metric": "Students started", "value": 5} in out["table"]


def test_ask_teaching_overview_floors_each_lecture_and_skips_the_owner(world, monkeypatch):
    from backend.services.ai import ask_professor

    world[("lectures", None)] = [{"id": "L1", "professor_id": OWNER}]
    monkeypatch.setattr(analytics_service, "_fetch_all_in",
                        lambda make_query, column, values, batch=100: list(world.get((make_query().table_name, None), [])))
    lectures = [{"id": "L1", "title": "Joins"}]
    world[("student_progress", None)] = _progress(4, owner_too=True)
    out = ask_professor._exec_teaching_overview(lectures, "t", {})
    assert "Total enrollments" not in {r["metric"] for r in out["table"]}
    world[("student_progress", None)] = _progress(5, owner_too=True)
    out = ask_professor._exec_teaching_overview(lectures, "t", {})
    assert {r["metric"]: r["value"] for r in out["table"]}["Total enrollments"] == 5


def test_ask_lectures_by_quiz_performance_skips_a_lecture_with_too_few_scorers(world, monkeypatch):
    from backend.services.ai import ask_professor

    world[("lectures", None)] = [{"id": "L1", "professor_id": OWNER}]
    monkeypatch.setattr(analytics_service, "_fetch_all_in",
                        lambda make_query, column, values, batch=100: list(world.get((make_query().table_name, None), [])))
    rows = _progress(5)
    for r in rows[:2]:
        r["total_questions_answered"] = 0      # five opened, only three answered
    world[("student_progress", None)] = rows
    out = ask_professor._exec_lectures_by_quiz_performance([{"id": "L1", "title": "Joins"}], "t", {})
    assert out["table"] == []


# ── the legacy garden: nothing about a slide fewer than 5 people viewed ─────

def _gslide(num, views, **kw):
    base = {"slide_id": f"s{num}", "slide_number": num, "title": f"S{num}", "view_count": views,
            "avg_dwell": 30.0, "median_dwell": 30.0, "dwell_p25": 20.0, "dwell_p75": 40.0, "dwell_cv": 0.3,
            "short_views": 0, "confusion_rate": 0.0, "quiz_success_rate": 90, "quiz_attempts": 10,
            "got_it": 0, "unsure": 0, "confused": 0, "ratings_total": 0, "ai_query_count": 0, "back_nav_count": 0,
            "back_nav_from_next": 0, "overconfident_count": 0, "got_it_quiz_total": 0, "overconfidence_rate": 0.0}
    base.update(kw)
    return base


def _garden(monkeypatch, slides):
    bundle = {"lecture_id": "L1", "total_students": 10, "lecture_avg_dwell": 30.0, "lecture_median_dwell": 30.0,
              "slides": slides, "students": []}
    monkeypatch.setattr(engine, "build_metric_bundle", lambda lecture_id, token=None: bundle)
    return engine.build_insights("L1", "t")


def _calib(views):
    return _gslide(3, views, got_it_quiz_total=4, overconfident_count=3, overconfidence_rate=75.0)


def test_a_garden_insight_on_a_slide_four_people_viewed_is_dropped(monkeypatch):
    assert _garden(monkeypatch, [_calib(4)]) == []


def test_a_garden_insight_on_a_slide_five_people_viewed_is_kept(monkeypatch):
    (insight,) = _garden(monkeypatch, [_calib(5)])
    assert insight["kind"] == "calibration_gap"


def test_a_confusion_block_needs_every_slide_in_it_viewed_by_five(monkeypatch):
    block = dict(confusion_rate=40.0, ratings_total=6)
    assert [i["kind"] for i in _garden(monkeypatch, [_gslide(1, 8, **block), _gslide(2, 8, **block)])
            if i["kind"] == "confusion_block"] == ["confusion_block"]
    assert all(i["kind"] != "confusion_block"
               for i in _garden(monkeypatch, [_gslide(1, 8, **block), _gslide(2, 4, **block)]))


def test_a_drop_off_finding_also_needs_the_slide_after_it(monkeypatch):
    # 10 people on slide 1, 4 on slide 2: the finding is made of both counts, and 4 is under the floor.
    slides = [_gslide(1, 10), _gslide(2, 4)]
    assert all(i["kind"] != "leaky_bucket" for i in _garden(monkeypatch, slides))
    assert any(i["kind"] == "leaky_bucket" for i in _garden(monkeypatch, [_gslide(1, 10), _gslide(2, 5)]))
