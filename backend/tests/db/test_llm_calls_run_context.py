"""DB tests for 20261012010000_llm_calls_run_context.sql (Arc 7).

llm_calls gains nullable run context (run_id, slide_indices, prompt_name) and
is locked down at the privilege layer: Supabase's default privileges grant
anon/authenticated full table rights directly, and 20260719010000 relied on
RLS alone, so the migration revokes them and grants service_role back."""
from __future__ import annotations

import uuid

import psycopg
import pytest

pytestmark = pytest.mark.db

_INSERT = (
    "INSERT INTO public.llm_calls (user_id, feature, provider, model, prompt_tokens, "
    "completion_tokens, est_cost_usd, run_id, slide_indices, prompt_name) "
    "VALUES (%s, 'generate_text_bulk', 'groq', 'gpt-oss-20b', 900, 120, 0, %s, %s, "
    "'BATCH_SLIDE_PROMPT')"
)


def _as_user(cur, uid) -> None:
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', %s, false)", ("authenticated",))


def _reset(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


def test_run_context_columns_are_nullable_with_expected_types(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT column_name, data_type, udt_name, is_nullable "
            "FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = 'llm_calls' "
            "AND column_name IN ('run_id', 'slide_indices', 'prompt_name') "
            "ORDER BY column_name"
        )
        rows = cur.fetchall()
    assert rows == [
        ("prompt_name", "text", "text", "YES"),
        ("run_id", "uuid", "uuid", "YES"),
        ("slide_indices", "ARRAY", "_int4", "YES"),
    ]


def test_run_id_has_a_partial_index(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT indexdef FROM pg_indexes "
            "WHERE schemaname = 'public' AND indexname = 'idx_llm_calls_run_id'"
        )
        row = cur.fetchone()
    assert row is not None
    assert "(run_id)" in row[0] and "WHERE (run_id IS NOT NULL)" in row[0]


def test_select_by_run_id_round_trips_the_slide_array(db_conn, make_user):
    user = make_user(role="professor")
    run_id = uuid.uuid4()
    with db_conn.cursor() as cur:
        cur.execute(_INSERT, (str(user), str(run_id), [0, 1, 2]))
        cur.execute(_INSERT, (str(user), str(uuid.uuid4()), [5]))
        cur.execute(
            "SELECT slide_indices, prompt_name FROM public.llm_calls WHERE run_id = %s",
            (str(run_id),),
        )
        assert cur.fetchall() == [([0, 1, 2], "BATCH_SLIDE_PROMPT")]


def test_legacy_insert_without_run_context_still_works(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.llm_calls (feature, provider, model) "
            "VALUES ('tutor_chat', 'groq', 'm') RETURNING run_id, slide_indices, prompt_name"
        )
        assert cur.fetchone() == (None, None, None)


def test_run_id_is_not_a_foreign_key(db_conn):
    # A billed call must never be lost because its parse_runs row is missing.
    orphan = uuid.uuid4()
    with db_conn.cursor() as cur:
        cur.execute(_INSERT, (None, str(orphan), [0]))
        cur.execute("SELECT count(*) FROM public.llm_calls WHERE run_id = %s", (str(orphan),))
        assert cur.fetchone()[0] == 1


def test_privilege_catalog_is_locked_down(db_conn):
    privs = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]
    with db_conn.cursor() as cur:
        def has(role, priv):
            cur.execute("SELECT has_table_privilege(%s, 'public.llm_calls', %s)", (role, priv))
            return cur.fetchone()[0]
        assert {p: has("anon", p) for p in privs} == dict.fromkeys(privs, False)
        assert {p: has("authenticated", p) for p in privs} == dict.fromkeys(privs, False)
        assert has("service_role", "SELECT") is True and has("service_role", "INSERT") is True


def test_authenticated_user_cannot_read_anyones_calls(db_conn, make_user):
    owner = make_user(role="professor")
    other = make_user(role="professor")
    with db_conn.cursor() as cur:
        cur.execute(_INSERT, (str(owner), str(uuid.uuid4()), [0]))
        for uid in (other, owner):
            _as_user(cur, uid)
            try:
                with pytest.raises(psycopg.errors.InsufficientPrivilege):
                    cur.execute("SELECT id FROM public.llm_calls")
            finally:
                _reset(cur)


def test_anon_cannot_read_calls(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(_INSERT, (None, str(uuid.uuid4()), [0]))
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT id FROM public.llm_calls")
        finally:
            cur.execute("RESET ROLE")


def test_service_role_writes_and_reads_calls(db_conn):
    run_id = uuid.uuid4()
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE service_role")
        cur.execute("SELECT set_config('request.jwt.claim.role', 'service_role', false)")
        try:
            cur.execute(_INSERT, (None, str(run_id), [3]))
            cur.execute("SELECT slide_indices FROM public.llm_calls WHERE run_id = %s", (str(run_id),))
            assert cur.fetchone() == ([3],)
        finally:
            _reset(cur)


@pytest.fixture
async def wired_pool(pg_dsn, applied_migrations):
    """Point the app's global asyncpg pool at the throwaway database."""
    import asyncpg
    import backend.core.database as core

    pool = await asyncpg.create_pool(pg_dsn, min_size=1, max_size=2, statement_cache_size=0)
    old = core.db_pool
    core.db_pool = pool
    try:
        yield pool
    finally:
        core.db_pool = old
        await pool.close()


async def test_log_llm_call_round_trips_run_context_through_asyncpg(wired_pool, db_conn):
    from backend.services.ai.cost import LLMUsage, log_llm_call

    run_id = uuid.uuid4()
    await log_llm_call(
        user_id=None, course_id=None, feature="batch_analyze_text_slides",
        provider_id="groq", model="gpt-oss-20b",
        usage=LLMUsage(prompt_tokens=900, completion_tokens=120), cost_usd=0.0,
        run_id=str(run_id), slide_indices=(0, 1, 2), prompt_name="BATCH_SLIDE_PROMPT",
    )
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT provider, model, prompt_tokens, completion_tokens, slide_indices, prompt_name "
            "FROM public.llm_calls WHERE run_id = %s",
            (str(run_id),),
        )
        assert cur.fetchall() == [("groq", "gpt-oss-20b", 900, 120, [0, 1, 2], "BATCH_SLIDE_PROMPT")]
