"""DB regression tests for 20260719010000_llm_calls_cost_accounting.sql.

Asserts the schema shape backend/services/ai/cost.py's log_llm_call() and
get_user_monthly_spend_from_db() actually depend on, that RLS is
service-role-only (no anon/authenticated access — the exact class of bug
P0-1 found in a different table), and that user/course deletion nulls the
FK (ON DELETE SET NULL) rather than losing the cost row entirely.

Gated behind the `db` marker (boots a real Postgres via testcontainers).
"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.db


def test_llm_calls_has_expected_columns(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'llm_calls'"
        )
        columns = {r[0] for r in cur.fetchall()}
    assert columns == {
        "id", "created_at", "user_id", "course_id", "feature", "provider",
        "model", "prompt_tokens", "completion_tokens", "est_cost_usd",
    }


def test_llm_calls_rls_has_no_anon_or_authenticated_policy(db_conn):
    """The exact class of bug P0-1 found (PUBLIC-executable destructive RPCs):
    confirm this table has ONLY service_role policies, so PostgREST denies
    anon/authenticated by default (RLS enabled, no matching permissive
    policy)."""
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT pg_get_expr(polqual, polrelid),
                   pg_get_expr(polwithcheck, polrelid)
            FROM pg_policy
            WHERE polrelid = 'public.llm_calls'::regclass
            """
        )
        rows = cur.fetchall()
    assert rows, "llm_calls must have RLS policies defined"
    # Each policy carries its predicate in polqual (USING, for SELECT/DELETE)
    # or polwithcheck (WITH CHECK, for INSERT) — coalesce both and confirm
    # every predicate is the service_role guard, so no anon/authenticated
    # caller can ever match a permissive policy.
    exprs = [q or wc for q, wc in rows]
    assert all(e == "(auth.role() = 'service_role'::text)" for e in exprs), exprs


def test_insert_and_sum_monthly_spend(db_conn, make_user, make_course):
    """Mirrors log_llm_call()'s INSERT and get_user_monthly_spend_from_db()'s
    SUM query — the two operations cost.py actually performs."""
    prof = make_user(role="professor")
    course = make_course(prof)

    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.llm_calls
                (user_id, course_id, feature, provider, model,
                 prompt_tokens, completion_tokens, est_cost_usd)
            VALUES (%s, %s, 'ask_professor_chat', 'openai', 'gpt-4o-mini', 1200, 300, 0.00036)
            """,
            (str(prof), str(course)),
        )
        cur.execute(
            """
            INSERT INTO public.llm_calls
                (user_id, course_id, feature, provider, model,
                 prompt_tokens, completion_tokens, est_cost_usd)
            VALUES (%s, NULL, 'generate_text_bulk', 'cerebras', 'gpt-oss-120b', 2000, 500, 0)
            """,
            (str(prof),),
        )
        cur.execute(
            """
            SELECT COALESCE(SUM(est_cost_usd), 0)::float8
            FROM public.llm_calls
            WHERE user_id = %s AND created_at >= date_trunc('month', now())
            """,
            (str(prof),),
        )
        total = cur.fetchone()[0]

    assert total == pytest.approx(0.00036)


def test_user_deletion_nulls_fk_instead_of_dropping_the_row(db_conn, make_user):
    """ON DELETE SET NULL: a deleted user's LLM cost history must survive
    (for aggregate/fleet reporting) even though it's no longer attributable
    to that specific user_id."""
    user = make_user(role="student")
    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.llm_calls (user_id, feature, provider, model, est_cost_usd)
            VALUES (%s, 'generate_text', 'openai', 'gpt-4o-mini', 0.001)
            """,
            (str(user),),
        )
        cur.execute("DELETE FROM auth.users WHERE id = %s", (str(user),))
        cur.execute(
            "SELECT user_id, feature, est_cost_usd FROM public.llm_calls WHERE feature = 'generate_text'"
        )
        row = cur.fetchone()

    assert row is not None
    assert row[0] is None
    # est_cost_usd is a numeric column -> psycopg returns Decimal; compare as float.
    assert float(row[2]) == pytest.approx(0.001)
