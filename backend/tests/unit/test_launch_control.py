"""Launch Control's pure decisions: the lecture quality gate and the gates."""
from __future__ import annotations

from backend.services.launch_control_service import LectureHealth, evaluate_gates


def _lecture(**kw) -> LectureHealth:
    base = dict(
        id="l1", course_id="c1", course="Datenbanksysteme", title="Normalization",
        slides=80, quizzes=40, concepts=6, poster=True, embedded=70,
    )
    base.update(kw)
    return LectureHealth(**base)


def test_a_complete_lecture_passes():
    assert _lecture().missing == []


def test_each_gap_is_named():
    assert _lecture(quizzes=2).missing == ["quizzes"]
    assert _lecture(concepts=0).missing == ["concepts"]
    assert _lecture(poster=False).missing == ["poster"]
    assert _lecture(embedded=1).missing == ["search index"]
    assert _lecture(slides=0, embedded=0).missing == ["slides"]


def test_test_uploads_are_flagged_but_real_titles_are_not():
    assert "test content" in _lecture(title="E2E Gamification Lecture").missing
    assert "test content" in _lecture(title="test-lecture").missing
    assert "test content" in _lecture(course="Cache Invalidation Proof 2").missing
    # Real lectures that merely mention the word.
    assert _lecture(title="Introduction to Testing").missing == []
    assert _lecture(title="Testverfahren").missing == []


def _gates(**kw):
    base = dict(
        openai_only=True, provider_error=None, ceiling_usd=10, user_cap_usd=2,
        classification_ready=True, lectures=[_lecture()], starter_courses=1,
        v4_reader_on=True,
    )
    base.update(kw)
    return {g["id"]: g for g in evaluate_gates(**base)}


def test_everything_ready_leaves_only_human_confirmations():
    statuses = {gid: g["status"] for gid, g in _gates().items()}
    assert statuses.pop("backup") == "confirm"
    assert statuses.pop("privacy") == "confirm"
    assert set(statuses.values()) == {"pass"}


def test_failures_explain_themselves():
    g = _gates(openai_only=False)
    assert g["ai_mode"]["status"] == "fail"
    g = _gates(provider_error="AI_PROVIDER_MODE=openai_only but other provider keys are set: GROQ_API_KEY.")
    assert "GROQ_API_KEY" in g["ai_mode"]["detail"]
    assert _gates(starter_courses=0)["starter"]["status"] == "fail"
    assert _gates(starter_courses=2)["starter"]["status"] == "fail"
    assert _gates(classification_ready=False)["real_users"]["status"] == "fail"
    assert _gates(lectures=[])["catalog"]["status"] == "fail"
    g = _gates(lectures=[_lecture(), _lecture(id="l2", title="test-lecture")])
    assert g["no_junk"]["status"] == "fail"
    assert g["catalog"]["detail"] == "1 of 2 pass"
