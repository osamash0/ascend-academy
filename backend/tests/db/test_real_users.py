"""Real-user classification (migration 20261013000000).

Pins: test/seed/staff accounts are internal by email rule or admin role, a
manual override beats both, the funnel counts real users only, and none of
it is readable by anon or a signed-in student (profiles is world-readable to
signed-in users, which is why the flag lives in its own service-role view).
"""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.db


def _classify(cur, uid: uuid.UUID) -> tuple[bool, str | None]:
    cur.execute(
        "SELECT is_internal, internal_reason FROM public.account_classification WHERE user_id = %s",
        (str(uid),),
    )
    return cur.fetchone()


def test_rules_admin_role_and_overrides(db_conn, make_user):
    real = make_user(email=f"{uuid.uuid4().hex[:8]}@gmail.com")
    seeded = make_user(email=f"{uuid.uuid4().hex[:8]}@example.com")
    simulated = make_user(email=f"sim_user_{uuid.uuid4().hex[:6]}@gmail.com")
    lookalike = make_user(email=f"simXuserX{uuid.uuid4().hex[:6]}@gmail.com")
    staff = make_user(email=f"{uuid.uuid4().hex[:8]}@uni-marburg.de")
    with db_conn.cursor() as cur:
        cur.execute("INSERT INTO public.user_roles (user_id, role) VALUES (%s, 'admin')", (str(staff),))

        assert _classify(cur, real) == (False, None)
        assert _classify(cur, seeded) == (True, "seed / simulated users")
        assert _classify(cur, simulated) == (True, "analytics simulator")
        # The underscores in sim\_user\_ are literal, not LIKE wildcards.
        assert _classify(cur, lookalike) == (False, None)
        assert _classify(cur, staff) == (True, "admin role")

        cur.execute(
            "INSERT INTO public.internal_account_overrides (user_id, is_internal, reason) VALUES (%s, true, 'my phone')",
            (str(real),),
        )
        cur.execute(
            "INSERT INTO public.internal_account_overrides (user_id, is_internal) VALUES (%s, false)",
            (str(seeded),),
        )
        assert _classify(cur, real) == (True, "marked internal: my phone")
        assert _classify(cur, seeded) == (False, "marked real")


def test_funnel_counts_real_users_only(db_conn, make_user):
    tag = uuid.uuid4().hex[:8]
    real = make_user(email=f"real-{tag}@gmail.com")
    make_user(email=f"seed-{tag}@example.com")
    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.onboarding_progress (user_id, acquisition_source, completed_at, activated_at)
            VALUES (%s, %s, now(), now())
            """,
            (str(real), f"src-{tag}"),
        )
        cur.execute(
            """
            SELECT acquisition_source, signed_up, onboarded, activated, came_back
            FROM public.real_user_funnel_daily WHERE acquisition_source = %s
            """,
            (f"src-{tag}",),
        )
        assert cur.fetchall() == [(f"src-{tag}", 1, 1, 1, 0)]


@pytest.mark.parametrize("role", ["anon", "authenticated"])
@pytest.mark.parametrize(
    "relation",
    ["account_classification", "real_user_funnel_daily", "internal_email_rules", "internal_account_overrides"],
)
def test_not_readable_outside_service_role(db_conn, role, relation):
    with db_conn.cursor() as cur:
        cur.execute("SELECT has_table_privilege(%s, %s, 'SELECT')", (role, f"public.{relation}"))
        assert cur.fetchone() == (False,)


def test_erasure_cascades_override(db_conn, make_user):
    uid = make_user(email=f"{uuid.uuid4().hex[:8]}@gmail.com")
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.internal_account_overrides (user_id, is_internal) VALUES (%s, true)",
            (str(uid),),
        )
        cur.execute("DELETE FROM auth.users WHERE id = %s", (str(uid),))
        cur.execute("SELECT count(*) FROM public.internal_account_overrides WHERE user_id = %s", (str(uid),))
        assert cur.fetchone() == (0,)
