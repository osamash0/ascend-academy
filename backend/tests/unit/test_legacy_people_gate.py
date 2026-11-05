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
    assert (out["uniqueStudents"], out["averageScore"], out["totalAttempts"]) == (None,) * 3
    assert "totalCorrect" not in out


def test_the_dashboard_overview_shows_from_five_people(monkeypatch):
    out = _dash(monkeypatch, [], [_prog(i, answered=4, correct=3) for i in range(5)])["overview"]
    # totalAttempts is the people who answered (never the answers); there is no raw correct count at all
    assert (out["uniqueStudents"], out["averageScore"], out["totalAttempts"]) == (5, 75, 5)
    assert "totalCorrect" not in out


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
    assert s1["confusionIndex"] == 20         # 1 of the 5 people who tried missed; the asker leaves no trace


def test_no_sub_floor_count_can_be_read_out_of_the_confusion_index(monkeypatch):
    base = [_ev(f"u{i}", "slide_view", duration_seconds=30) for i in range(5)]
    base += [_ev(f"u{i}", "quiz_attempt", correct=True, questionId="q1") for i in range(5)]
    quiet = _slide_by_id(_dash(monkeypatch, [], events=base, slides=SLIDES))["s1"]["confusionIndex"]
    # 4 people asking and 4 going back changes nothing visible: neither reaches 5 people.
    noisy = base + [_ev(f"u{i}", "ai_tutor_query", query="q") for i in range(4)]
    noisy += [_ev(f"u{i}", "slide_back_navigation", fromSlideId="s1") for i in range(4)]
    assert _slide_by_id(_dash(monkeypatch, [], events=noisy, slides=SLIDES))["s1"]["confusionIndex"] == quiet


def test_the_confusion_index_is_a_share_over_the_slides_viewers_once_a_component_passes(monkeypatch):
    events = [_ev(f"u{i}", "slide_view", duration_seconds=30) for i in range(10)]
    events += [_ev(f"u{i}", "ai_tutor_query", query="q") for i in range(5)]       # 5 of 10 viewers asked
    s1 = _slide_by_id(_dash(monkeypatch, [], events=events, slides=SLIDES))["s1"]
    assert (s1["aiQueries"], s1["confusionIndex"]) == (5, 50)


def test_the_confusion_index_is_none_when_no_component_passes(monkeypatch):
    events = [_ev(f"u{i}", "slide_view", duration_seconds=30) for i in range(6)]
    events += [_ev("u0", "ai_tutor_query", query="q")]
    assert _slide_by_id(_dash(monkeypatch, [], events=events, slides=SLIDES))["s1"]["confusionIndex"] is None


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
    assert out["liveTicker"] == [] and out["overview"]["totalEvents"] is None
    assert [d["people"] for d in out["activityByDay"]] == [None] * 7


def test_activity_by_day_is_people_per_day_and_each_day_under_five_is_none(monkeypatch):
    import datetime as dt

    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    events = [{**_ev(f"u{i}", "quiz_attempt", correct=True), "day": today} for i in range(5)]
    events += [{**_ev("u0", "quiz_attempt", correct=True), "day": today}] * 6        # tries do not add people
    days = _dash(monkeypatch, [], events=events)["activityByDay"]
    assert len(days) == 7 and set(days[-1]) == {"date", "people"}
    assert days[-1]["people"] == 5 and [d["people"] for d in days[:-1]] == [None] * 6


def test_total_events_is_the_number_of_people_who_did_anything(monkeypatch):
    events = [_ev(f"u{i}", "slide_view", duration_seconds=5) for i in range(5)] * 3   # 15 events, 5 people
    assert _dash(monkeypatch, [], events=events)["overview"]["totalEvents"] == 5


def test_a_json_text_event_data_is_read_like_a_dict(monkeypatch):
    # asyncpg returns jsonb as text
    import json as _json

    events = [{**_ev(f"u{i}", "ai_tutor_query"), "event_data": _json.dumps(
        {"lectureId": "L1", "slideId": "s1", "query": f"question {i}", "slideTitle": "Joins"})} for i in range(5)]
    feed = _dash(monkeypatch, [], events=events)["aiQueryFeed"]
    assert len(feed) == 5 and feed[0]["query_text"] == "question 4"
    assert analytics_service._event_dict('{"a": 1}') == {"a": 1} and analytics_service._event_dict(None) == {}


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


def _calib(views, pairs=5):
    # `pairs` confident people who also took the quiz; 3/4 or 4/5 of them failed it
    return _gslide(3, views, got_it_quiz_total=pairs, overconfident_count=pairs - 1,
                   overconfidence_rate=round((pairs - 1) / pairs * 100, 1))


def test_a_garden_insight_on_a_slide_four_people_viewed_is_dropped(monkeypatch):
    assert _garden(monkeypatch, [_calib(4)]) == []


def test_a_garden_insight_is_kept_when_viewers_and_its_own_base_are_five_or_more(monkeypatch):
    (insight,) = _garden(monkeypatch, [_calib(5, pairs=5)])
    assert insight["kind"] == "calibration_gap"


def test_a_calibration_gap_of_three_in_four_confident_people_is_dropped_on_a_busy_slide(monkeypatch):
    # 30 people viewed it, but the share is over the 4 who were confident and took the quiz.
    assert _garden(monkeypatch, [_calib(30, pairs=4)]) == []


def test_a_confusion_hotspot_over_four_raters_is_dropped_and_over_five_is_kept(monkeypatch):
    hot = dict(confusion_rate=60.0, confused=3, got_it=1, ratings_total=4)
    assert all(i["kind"] != "confusion_hotspot" for i in _garden(monkeypatch, [_gslide(1, 12, **hot)]))
    hot = dict(confusion_rate=60.0, confused=3, got_it=2, ratings_total=5)
    assert any(i["kind"] == "confusion_hotspot" for i in _garden(monkeypatch, [_gslide(1, 12, **hot)]))


def test_a_quiz_finding_needs_the_slides_quiz_rate_to_have_five_people_behind_it(monkeypatch):
    weak = dict(quiz_success_rate=20.0, quiz_attempts=6, confusion_rate=5.0)
    assert any(i["kind"] == "quiz_misalignment" for i in _garden(monkeypatch, [_gslide(1, 12, **weak)]))
    withheld = dict(quiz_success_rate=None, quiz_attempts=0, confusion_rate=5.0)
    assert all(i["kind"] != "quiz_misalignment" for i in _garden(monkeypatch, [_gslide(1, 12, **withheld)]))


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


# ── the garden's bundle: people counts, the owner out ───────────────────────

def test_the_bundles_reach_is_the_unfloored_people_count_and_the_owner_is_not_a_reader(world):
    from backend.services.insights import bundle as bundle_mod

    world[("student_progress", None)] = [
        {"user_id": f"u{i}", "completed_slides": [], "quiz_score": 0} for i in range(3)
    ] + [{"user_id": OWNER, "completed_slides": [], "quiz_score": 0}]
    world[("learning_events", "slide_view")] = [_view(f"u{i}", "s1") for i in range(3)] + [_view(OWNER, "s1")]
    world[("learning_events", "ai_tutor_query")] = [
        {"user_id": OWNER, "event_data": {"lectureId": "L1", "slideId": "s1", "query": "?"}},
        {"user_id": "u0", "event_data": {"lectureId": "L1", "slideId": "s1", "query": "?"}},
    ]
    out = bundle_mod.build_metric_bundle("L1", "t")
    # 3 readers: the overview itself would say None; the bundle keeps the real number, not 0.
    assert analytics_service.get_lecture_overview("L1", "t")["total_students"] is None
    assert out["total_students"] == 3
    s1 = next(s for s in out["slides"] if s["slide_id"] == "s1")
    assert s1["view_count"] == 3 and s1["ai_query_count"] == 1


# ── benchmarks: a withheld lecture is None, never 0, and is not a peer ──────

def _bench(monkeypatch, overview, quizzes=(), distractors=(), slides=()):
    import asyncio

    monkeypatch.setattr(analytics_service, "get_lecture_overview", lambda *a, **k: overview)
    monkeypatch.setattr(analytics_service, "get_quiz_analytics", lambda *a, **k: list(quizzes))
    monkeypatch.setattr(analytics_service, "get_distractor_analysis", lambda *a, **k: list(distractors))
    monkeypatch.setattr(analytics_service, "get_slide_analytics", lambda *a, **k: list(slides))
    return asyncio.run(analytics_service._compute_lecture_benchmark_metrics("L1", None))


def test_a_withheld_lecture_has_no_benchmark_figures(monkeypatch):
    withheld = {"total_students": None, "completion_rate": None, "average_score": None,
                "average_time_minutes": None, "engagement_level": "No Data"}
    out = _bench(monkeypatch, withheld)
    assert set(out) == set(analytics_service._BENCHMARK_METRIC_KEYS)
    assert all(v is None for v in out.values())


def test_a_lecture_with_people_but_no_scorers_leaves_only_the_score_figures_out(monkeypatch):
    overview = {"total_students": 6, "completion_rate": 50.0, "average_score": None,
                "average_time_minutes": None, "engagement_level": "No Data"}
    quiz = [{"question_id": "q", "question_text": "q", "success_rate": None, "difficulty": None, "attempts": None}]
    out = _bench(monkeypatch, overview, quizzes=quiz)
    assert (out["unique_students"], out["completion_rate"], out["drop_off_rate"]) == (6, 50.0, 50.0)
    assert out["avg_score"] is None and out["avg_time_minutes"] is None
    assert out["mastery_rate"] is None and out["struggle_rate"] is None and out["distractor_confusion"] is None


def test_the_peer_summary_leaves_withheld_lectures_out_and_is_none_with_nothing_left():
    keys = analytics_service._BENCHMARK_METRIC_KEYS
    shown = {k: 10.0 for k in keys}
    withheld = {k: None for k in keys}
    summary = analytics_service._summarize_metric_pack([shown, withheld, {**shown, "avg_score": 30.0}])
    assert summary["completion_rate"] == {"avg": 10.0, "min": 10.0, "max": 10.0, "count": 2}
    assert summary["avg_score"]["avg"] == 20.0
    empty = analytics_service._summarize_metric_pack([withheld, withheld])
    assert empty["completion_rate"] == {"avg": None, "min": None, "max": None, "count": 0}


def test_a_course_of_withheld_lectures_is_none_not_zero():
    keys = analytics_service._BENCHMARK_METRIC_KEYS
    out = analytics_service._aggregate_course_metrics([{k: None for k in keys}, {k: None for k in keys}])
    assert all(v is None for v in out.values())
    mixed = analytics_service._aggregate_course_metrics([{k: None for k in keys}, {k: 40.0 for k in keys}])
    assert mixed["completion_rate"] == 40.0 and mixed["unique_students"] == 40


# ── the garden's evidence, Ask and the LLM request ──────────────────────────

def test_ai_queries_evidence_says_withheld_not_zero_under_five_askers(world):
    world[("learning_events", "ai_tutor_query")] = [
        {"user_id": f"u{i}", "created_at": "t",
         "event_data": {"lectureId": "L1", "slideId": "s1", "query": "why?"}} for i in range(4)]
    out = evidence.get_ai_queries_evidence("L1", "s1", "t")
    assert out["queries"] == [] and out["totalCount"] is None


def test_ai_queries_evidence_shows_the_slides_questions_from_five_askers(world):
    rows = [{"user_id": f"u{i}", "created_at": "t",
             "event_data": {"lectureId": "L1", "slideId": "s1" if i < 4 else "s2", "query": f"q{i}"}} for i in range(5)]
    world[("learning_events", "ai_tutor_query")] = rows
    out = evidence.get_ai_queries_evidence("L1", "s1", "t")
    assert out["totalCount"] == 4 and "user_id" not in repr(out)


def test_ask_worst_quiz_questions_says_too_few_when_every_question_is_withheld(monkeypatch):
    from backend.services.ai import ask_data

    rows = [{"question_id": "q", "question_text": "Q", "success_rate": None, "difficulty": None, "attempts": None}]
    monkeypatch.setattr(analytics_service, "get_quiz_analytics", lambda *a, **k: rows)
    out = ask_data._exec_worst_quiz_questions("L1", "t", {})
    assert "Too few" in out["answer_text"] and "recorded yet" not in out["answer_text"]
    monkeypatch.setattr(analytics_service, "get_quiz_analytics", lambda *a, **k: [])
    assert "recorded yet" in ask_data._exec_worst_quiz_questions("L1", "t", {})["answer_text"]


def test_the_insights_request_accepts_withheld_figures_and_the_prompt_leaves_them_out(monkeypatch):
    import asyncio

    from backend.api.v1.ai_content import AnalyticsStatsRequest
    from backend.services.ai import analytics as ai_analytics

    body = AnalyticsStatsRequest(total_students=6, average_score=None, total_attempts=None, total_correct=None)
    seen = []

    async def fake_generate(prompt, model):
        seen.append(prompt)
        return '{"summary": "s", "suggestions": ["a", "b", "c"]}'

    monkeypatch.setattr(ai_analytics, "generate_text", fake_generate)
    asyncio.run(ai_analytics.generate_analytics_insights(body.dict(), ai_model=body.ai_model))
    assert "'total_students': 6" in seen[0]
    assert "average_score" not in seen[0] and "total_attempts" not in seen[0] and "None" not in seen[0]


def test_the_metric_feedback_prompt_leaves_withheld_context_out(monkeypatch):
    import asyncio

    from backend.services.ai import analytics as ai_analytics

    seen = []

    async def fake_generate(prompt, model):
        seen.append(prompt)
        return "ok"

    monkeypatch.setattr(ai_analytics, "generate_text", fake_generate)
    asyncio.run(ai_analytics.generate_metric_feedback("Completion", 40, {"average_score": None, "total_students": 6}))
    assert "average_score" not in seen[0] and "None" not in seen[0] and "total_students" in seen[0]
