"""The export spec: every user-linked table, both sides of friendships,
AI chat transcripts, and no secret material."""
import pytest

from backend.services import account_service as acc

UID = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"


class _Res:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, rows):
        self._rows, self._f = rows, []

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self._f.append(lambda r: r.get(col) == val)
        return self

    def in_(self, col, vals):
        self._f.append(lambda r: r.get(col) in vals)
        return self

    def execute(self):
        return _Res([r for r in self._rows if all(f(r) for f in self._f)])


class FakeAdmin:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        if name not in self.tables:
            raise RuntimeError(f'relation "{name}" does not exist')
        return _Q(self.tables[name])


@pytest.fixture
def admin(monkeypatch):
    def _make(tables):
        fake = FakeAdmin(tables)
        monkeypatch.setattr(acc, "supabase_admin", fake)
        return fake
    return _make


@pytest.mark.asyncio
async def test_exports_both_sides_of_friend_requests(admin):
    admin({"friend_requests": [
        {"id": "a", "requester_id": UID, "addressee_id": OTHER},
        {"id": "b", "requester_id": OTHER, "addressee_id": UID},
        {"id": "c", "requester_id": OTHER, "addressee_id": "x"},
    ]})
    out = await acc.export_user_data(UID)
    assert sorted(r["id"] for r in out["friend_requests"]) == ["a", "b"]


@pytest.mark.asyncio
async def test_exports_tutor_transcripts_through_sessions(admin):
    admin({
        "tutor_sessions": [{"id": "s1", "user_id": UID}, {"id": "s2", "user_id": OTHER}],
        "tutor_messages": [
            {"id": "m1", "session_id": "s1", "content": "mine"},
            {"id": "m2", "session_id": "s2", "content": "theirs"},
        ],
    })
    out = await acc.export_user_data(UID)
    assert [m["id"] for m in out["tutor_messages"]] == ["m1"]


@pytest.mark.asyncio
async def test_redacts_token_hashes(admin):
    admin({"api_tokens": [{"id": "t", "user_id": UID, "token_hash": "secret", "name": "ci"}]})
    out = await acc.export_user_data(UID)
    assert out["api_tokens"] == [{"id": "t", "user_id": UID, "name": "ci"}]


@pytest.mark.asyncio
async def test_missing_table_is_skipped_not_fatal(admin):
    admin({})
    out = await acc.export_user_data(UID)
    assert out["profiles"] == [] and out["user_id"] == UID


def test_spec_covers_every_production_user_column():
    """The 2026-10-11 production catalog (see plan) — none may be uncovered."""
    prod = {
        ("achievements", "user_id"), ("assignment_enrollments", "user_id"),
        ("assignments", "professor_id"), ("concept_mastery", "user_id"),
        ("course_blueprints", "owner_id"), ("course_enrollments", "user_id"),
        ("course_visits", "user_id"), ("courses", "professor_id"),
        ("exam_attempts", "user_id"), ("friend_requests", "addressee_id"),
        ("friend_requests", "requester_id"), ("learning_events", "user_id"),
        ("lecture_visits", "user_id"), ("lectures", "professor_id"),
        ("lectures", "student_owner_id"), ("llm_calls", "user_id"),
        ("material_sources", "owner_id"), ("notification_preferences", "user_id"),
        ("notifications", "user_id"), ("nudge_dismissals", "user_id"),
        ("onboarding_progress", "user_id"), ("parse_runs", "user_id"),
        ("practice_attempts", "student_id"), ("practice_sheets", "created_by"),
        ("profiles", "user_id"), ("review_log", "user_id"), ("review_schedule", "user_id"),
        ("schedule_item_completions", "user_id"), ("student_catalog_courses", "user_id"),
        ("student_progress", "user_id"), ("tutor_sessions", "user_id"),
        ("upload_quotas", "user_id"), ("user_feedback", "user_id"), ("user_roles", "user_id"),
        ("v4_rehearsal_attempts", "user_id"), ("worksheets", "uploaded_by"),
        ("xp_events", "user_id"), ("api_tokens", "user_id"), ("course_access", "user_id"),
    }
    assert acc.uncovered(prod) == []
