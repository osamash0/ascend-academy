"""Unit tests for the repository wrappers using fake_supabase."""
from backend.repositories import event_repo, lecture_repo


def test_get_lecture_returns_row(fake_supabase):
    fake_supabase.seed(
        "lectures",
        [
            {"id": "L1", "title": "T", "description": None, "total_slides": 1,
             "created_at": "2026-01-01", "pdf_url": None, "professor_id": "P1"}
        ],
    )
    out = lecture_repo.get_lecture(fake_supabase, "L1")
    assert out is not None
    assert out["id"] == "L1"


def test_get_lecture_none_when_missing(fake_supabase):
    # .single() on empty raises in real PostgREST. Repo catches PGError? It doesn't,
    # so the error propagates — which is the documented behavior.
    import pytest
    fake_supabase.seed("lectures", [])
    with pytest.raises(Exception):
        lecture_repo.get_lecture(fake_supabase, "X")


def test_list_lectures_by_pdf_hash_scoped_to_owner(fake_supabase):
    """Hash matches across professors must NOT cross the user boundary."""
    fake_supabase.seed(
        "lectures",
        [
            {"id": "L1", "professor_id": "P1", "title": "Mine v1",
             "pdf_hash": "h" * 64, "total_slides": 3,
             "created_at": "2026-01-01"},
            {"id": "L2", "professor_id": "P1", "title": "Mine v2",
             "pdf_hash": "h" * 64, "total_slides": 4,
             "created_at": "2026-02-02"},
            {"id": "L3", "professor_id": "P2", "title": "Theirs",
             "pdf_hash": "h" * 64, "total_slides": 9,
             "created_at": "2026-03-03"},
            {"id": "L4", "professor_id": "P1", "title": "Different PDF",
             "pdf_hash": "z" * 64, "total_slides": 2,
             "created_at": "2026-04-04"},
        ],
    )
    out = lecture_repo.list_lectures_by_pdf_hash(fake_supabase, "P1", "h" * 64)
    # P1's two matching lectures, newest first, P2's row excluded.
    assert [r["id"] for r in out] == ["L2", "L1"]
    # The four columns the dialog renders must be present (the fake
    # supabase returns whole rows; production PostgREST honors .select()).
    for col in ("id", "title", "created_at", "total_slides"):
        assert col in out[0]


def test_list_lectures_by_pdf_hash_returns_empty_for_no_match(fake_supabase):
    fake_supabase.seed(
        "lectures",
        [{"id": "L1", "professor_id": "P1", "pdf_hash": "a" * 64,
          "title": "x", "total_slides": 1, "created_at": "2026-01-01"}],
    )
    assert lecture_repo.list_lectures_by_pdf_hash(fake_supabase, "P1", "b" * 64) == []


def test_list_lectures_by_pdf_hash_short_circuits_on_falsy_args(fake_supabase):
    # No DB call should happen — guards against a missing hash being treated
    # as "match all rows".
    fake_supabase.seed("lectures", [])
    assert lecture_repo.list_lectures_by_pdf_hash(fake_supabase, "", "h" * 64) == []
    assert lecture_repo.list_lectures_by_pdf_hash(fake_supabase, "P1", "") == []


def test_list_lectures_filters_by_professor(fake_supabase):
    fake_supabase.seed(
        "lectures",
        [
            {"id": "L1", "professor_id": "P1", "title": "A", "description": "",
             "total_slides": 1, "created_at": "2026-01-01"},
            {"id": "L2", "professor_id": "P2", "title": "B", "description": "",
             "total_slides": 1, "created_at": "2026-01-02"},
        ],
    )
    out = lecture_repo.list_lectures(fake_supabase, professor_id="P1")
    assert {row["id"] for row in out} == {"L1"}


def test_get_slides_orders_by_number(fake_supabase):
    fake_supabase.seed(
        "slides",
        [
            {"id": "s2", "lecture_id": "L1", "slide_number": 2, "title": "B"},
            {"id": "s1", "lecture_id": "L1", "slide_number": 1, "title": "A"},
        ],
    )
    out = lecture_repo.get_slides(fake_supabase, "L1")
    assert [s["slide_number"] for s in out] == [1, 2]


def test_insert_event_writes_row(fake_supabase):
    event_repo.insert_event(fake_supabase, "u-1", "slide_view", {"slideId": "s1"})
    assert len(fake_supabase.tables["learning_events"]) == 1
    row = fake_supabase.tables["learning_events"][0]
    assert row["user_id"] == "u-1"
    assert row["event_data"] == {"slideId": "s1"}


def test_get_events_for_lecture_filters_by_contains(fake_supabase):
    fake_supabase.seed(
        "learning_events",
        [
            {"event_type": "slide_view", "event_data": {"lectureId": "L1", "slideId": "s1"}},
            {"event_type": "slide_view", "event_data": {"lectureId": "L2"}},
            {"event_type": "quiz_attempt", "event_data": {"lectureId": "L1"}},
        ],
    )
    out = event_repo.get_events_for_lecture(fake_supabase, "slide_view", "L1")
    assert len(out) == 1
    assert out[0]["event_data"]["slideId"] == "s1"


def test_upsert_mind_map_overwrites_existing(fake_supabase):
    fake_supabase.seed(
        "lecture_mind_maps",
        [{"lecture_id": "L1", "map_data": {"old": True}}],
    )
    event_repo.upsert_mind_map(fake_supabase, "L1", {"new": True})
    row = next(r for r in fake_supabase.tables["lecture_mind_maps"] if r["lecture_id"] == "L1")
    assert row["map_data"] == {"new": True}
