"""launch_catalog.plan_for: which enrichment steps a visible lecture needs."""
from backend.scripts.launch_catalog import plan_for
from backend.services.launch_control_service import LectureHealth


def _l(**kw):
    base = dict(id="l", course_id="c", course="DBS", title="SQL", slides=40,
                quizzes=20, concepts=5, poster=True, embedded=30)
    base.update(kw)
    return LectureHealth(**base)


def test_complete_lecture_needs_nothing():
    assert plan_for(_l(), has_blueprint=True) == []


def test_missing_concepts_generates_a_blueprint_only_when_absent():
    assert plan_for(_l(concepts=0), has_blueprint=False) == ["blueprint", "concepts", "review"]
    assert plan_for(_l(concepts=0), has_blueprint=True) == ["concepts", "review"]


def test_thin_quiz_gets_a_deck_quiz():
    assert plan_for(_l(quizzes=2), has_blueprint=True) == ["quizzes", "review"]


def test_poster_and_index_are_left_to_their_own_backfills():
    assert plan_for(_l(poster=False, embedded=0), has_blueprint=True) == []
