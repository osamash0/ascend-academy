"""The export spec: every user-linked table, both sides of friendships,
AI chat transcripts, and no secret material."""
import pytest
from postgrest.exceptions import APIError

from backend.services import account_service as acc

UID = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"


class _Res:
    def __init__(self, data):
        self.data = data


def _api_error(code):
    return APIError({"code": code, "message": f"error {code}"})


class _Q:
    MAX_ROWS = 1000  # PostgREST's max-rows cap: an unranged read is truncated

    def __init__(self, admin, name):
        self._admin, self._name, self._f, self._range = admin, name, [], None

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self._check(col)
        self._f.append(lambda r: r.get(col) == val)
        return self

    def in_(self, col, vals):
        self._check(col)
        self._admin.in_sizes.append(len(vals))
        self._f.append(lambda r: r.get(col) in vals)
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def _check(self, col):
        if (self._name, col) in self._admin.missing_columns:
            self._admin.pending_error = _api_error("42703")

    def execute(self):
        if self._admin.pending_error is not None:
            e, self._admin.pending_error = self._admin.pending_error, None
            raise e
        if self._name in self._admin.errors:
            raise self._admin.errors[self._name]
        if self._name not in self._admin.tables:
            raise _api_error("PGRST205")
        hit = [r for r in self._admin.tables[self._name] if all(f(r) for f in self._f)]
        start, end = self._range or (0, self.MAX_ROWS - 1)
        return _Res(hit[start:min(end + 1, start + self.MAX_ROWS)])


class FakeAdmin:
    def __init__(self, tables):
        self.tables = tables
        self.errors: dict = {}
        self.missing_columns: set = set()
        self.pending_error = None
        self.in_sizes: list[int] = []

    def table(self, name):
        return _Q(self, name)


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


@pytest.mark.asyncio
async def test_missing_table_pgrst205_is_skipped(admin):
    fake = admin({"profiles": [{"id": "p", "user_id": UID}]})
    fake.errors["api_tokens"] = _api_error("PGRST205")
    fake.errors["course_access"] = _api_error("42P01")
    out = await acc.export_user_data(UID)
    assert out["api_tokens"] == [] and out["course_access"] == []
    assert out["profiles"] == [{"id": "p", "user_id": UID}]


@pytest.mark.asyncio
async def test_missing_column_on_an_ordinary_table_fails_the_export(admin):
    fake = admin({"profiles": []})
    fake.missing_columns.add(("profiles", "user_id"))
    with pytest.raises(APIError):
        await acc.export_user_data(UID)


@pytest.mark.asyncio
async def test_any_other_error_fails_the_export_never_partial(admin):
    fake = admin({"profiles": []})
    fake.errors["xp_events"] = RuntimeError("connection reset")
    with pytest.raises(RuntimeError):
        await acc.export_user_data(UID)


@pytest.mark.asyncio
async def test_pages_past_the_1000_row_cap(admin):
    rows = [{"id": f"e{i}", "user_id": UID} for i in range(2500)]
    admin({"learning_events": rows + [{"id": "x", "user_id": OTHER}]})
    out = await acc.export_user_data(UID)
    assert len(out["learning_events"]) == 2500


@pytest.mark.asyncio
async def test_exact_multiple_of_the_page_size_is_complete(admin):
    admin({"xp_events": [{"id": f"x{i}", "user_id": UID} for i in range(2000)]})
    out = await acc.export_user_data(UID)
    assert len(out["xp_events"]) == 2000


@pytest.mark.asyncio
async def test_session_ids_are_chunked_and_messages_paged(admin):
    sessions = [{"id": f"s{i}", "user_id": UID} for i in range(250)]
    msgs = [{"id": f"m{i}", "session_id": f"s{i % 250}"} for i in range(1200)]
    fake = admin({"tutor_sessions": sessions, "tutor_messages": msgs})
    fake.missing_columns.add(("tutor_messages", "user_id"))
    out = await acc.export_user_data(UID)
    assert len(out["tutor_messages"]) == 1200
    assert fake.in_sizes and max(fake.in_sizes) <= acc.IN_CHUNK


@pytest.mark.asyncio
async def test_tutor_messages_by_user_id_are_merged_and_deduped(admin):
    """Migrated schema: tutor_messages carries user_id (and maybe a session)."""
    admin({
        "tutor_sessions": [{"id": "s1", "user_id": UID}],
        "tutor_messages": [
            {"id": "m1", "session_id": "s1", "user_id": UID},
            {"id": "m2", "user_id": UID, "lecture_id": "L1"},
            {"id": "m3", "user_id": OTHER},
        ],
    })
    out = await acc.export_user_data(UID)
    assert sorted(m["id"] for m in out["tutor_messages"]) == ["m1", "m2"]


@pytest.mark.asyncio
async def test_production_tutor_messages_without_user_id_still_export(admin):
    """Production: no user_id column (42703) is tolerated for tutor_messages only."""
    fake = admin({
        "tutor_sessions": [{"id": "s1", "user_id": UID}],
        "tutor_messages": [{"id": "m1", "session_id": "s1"}, {"id": "m2", "session_id": "s9"}],
    })
    fake.missing_columns.add(("tutor_messages", "user_id"))
    out = await acc.export_user_data(UID)
    assert [m["id"] for m in out["tutor_messages"]] == ["m1"]


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


@pytest.mark.asyncio
async def test_exports_luna_sessions_turns_memory_and_owned_cards(admin):
    admin({
        "luna_sessions": [{"id": "ls1", "user_id": UID}, {"id": "ls2", "user_id": OTHER}],
        "luna_turns": [{"id": "lt1", "user_id": UID}, {"id": "lt2", "user_id": OTHER}],
        "learner_memory": [{"id": "lm1", "user_id": UID}, {"id": "lm2", "user_id": OTHER}],
        "review_cards": [{"id": "rc1", "owner_id": UID}, {"id": "rc2", "owner_id": None}],
    })
    out = await acc.export_user_data(UID)
    assert [r["id"] for r in out["luna_sessions"]] == ["ls1"]
    assert [r["id"] for r in out["luna_turns"]] == ["lt1"]
    assert [r["id"] for r in out["learner_memory"]] == ["lm1"]
    assert [r["id"] for r in out["review_cards"]] == ["rc1"]


@pytest.mark.asyncio
async def test_review_cards_without_owner_id_column_is_tolerated(admin):
    """Before the luna migration is applied, review_cards has no owner_id (42703)."""
    fake = admin({"review_cards": [{"id": "rc1"}], "profiles": [{"id": "p", "user_id": UID}]})
    fake.missing_columns.add(("review_cards", "owner_id"))
    out = await acc.export_user_data(UID)
    assert out["review_cards"] == []
    assert out["profiles"] == [{"id": "p", "user_id": UID}]
