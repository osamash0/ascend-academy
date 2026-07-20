"""
S-6 (Foundation 10x roadmap, §14) — seeded cross-tenant-leak canary.

Acceptance criterion: "A deliberately-introduced cross-tenant leak (seeded)
fails CI." This file is the proof-of-mechanism test for that criterion.

Rather than actually removing a real RLS policy from a migration (which
would leave the repo genuinely vulnerable between commit and revert, and
would race with every other test in this suite), this test *seeds* the
exact same failure mode — RLS silently disabled on a table that holds
cross-tenant data — inside a single throwaway transaction on the test's own
connection, observes the leak, then rolls the transaction back so the
schema is untouched for every other test in the session.

This directly demonstrates the causal claim the roadmap asks for: if a
future migration ever drops/disables the RLS policy on `student_progress`,
`test_student_cannot_see_other_students_progress` in test_rls_policies.py
(the "real" regression test, always run with RLS intact) is exercising the
identical query shape used here, under the identical failure condition
reproduced below. This test is the receipt showing that query WOULD fail
loudly if that ever happened for real.
"""
from __future__ import annotations

import psycopg
import pytest

pytestmark = pytest.mark.db


def _as_user(cur, uid):
    """Same helper as test_rls_policies.py — switch to `authenticated`/uid."""
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute(
        "SELECT set_config('request.jwt.claim.role', %s, false)", ("authenticated",)
    )


def test_seeded_rls_removal_leaks_cross_tenant_progress_then_is_restored(
    db_conn, make_user, make_lecture, make_progress
):
    """
    The canary.

    Phase 1 (seed the leak): inside one explicit transaction on this
    connection, disable RLS on `student_progress` — the exact regression a
    careless future migration could introduce — and prove that a student
    can now read another student's row. This is the "would CI have caught
    a real leak" proof: it demonstrably WOULD, because this is the same
    assertion shape as the always-on regression test, just run against a
    deliberately broken schema.

    Phase 2 (rollback + restore): roll the transaction back. RLS
    enable/disable is transactional DDL, so ROLLBACK undoes it — no other
    test in this session observes a schema without the policy.

    Phase 3 (confirm restored protection): re-run the identical query
    outside the seeded transaction and confirm the leak is gone, proving
    the rollback fully restored the boundary and this test left no residue.
    """
    professor = make_user(role="professor")
    student_a = make_user(role="student")
    student_b = make_user(role="student")
    lecture = make_lecture(professor)

    progress_a = make_progress(student_a, lecture, xp=11)
    progress_b = make_progress(student_b, lecture, xp=22)

    # ── Phase 1 + 2: seed the leak inside a rolled-back transaction ────────
    with db_conn.cursor() as cur:
        cur.execute("BEGIN")
        try:
            # This is the seeded vulnerability: the exact statement a
            # careless migration author might run (or a migration that
            # forgets to re-enable RLS after a maintenance ALTER TABLE).
            cur.execute(
                "ALTER TABLE public.student_progress DISABLE ROW LEVEL SECURITY"
            )

            _as_user(cur, student_a)
            cur.execute("SELECT id FROM public.student_progress")
            leaked_visible = {row[0] for row in cur.fetchall()}

            assert progress_b in leaked_visible, (
                "canary setup bug: disabling RLS did not even reproduce the "
                "leak inside the seeded transaction — the canary can't "
                "prove anything if this assertion doesn't hold. Expected "
                f"student {student_a}, with RLS off, to see student "
                f"{student_b}'s row {progress_b}; got {leaked_visible!r}"
            )
            assert progress_a in leaked_visible

            cur.execute("RESET ROLE")
        finally:
            # Always roll back, whether the leak assertions above passed or
            # raised — the seeded vulnerability must never survive this
            # test regardless of outcome.
            cur.execute("ROLLBACK")

    # ── Phase 3: confirm the real (non-seeded) schema still protects ───────
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT relrowsecurity FROM pg_class WHERE relname = 'student_progress'"
        )
        (rls_enabled,) = cur.fetchone()
        assert rls_enabled is True, (
            "ROLLBACK did not restore RLS on student_progress — the "
            "canary's own transaction handling is broken, not just the "
            "thing it's testing."
        )

        _as_user(cur, student_a)
        try:
            cur.execute("SELECT id FROM public.student_progress")
            protected_visible = {row[0] for row in cur.fetchall()}
        finally:
            cur.execute("RESET ROLE")

    assert progress_a in protected_visible, (
        f"student {student_a} cannot see their own progress row after "
        "canary rollback — over-correction, RLS is now too strict"
    )
    assert progress_b not in protected_visible, (
        "SECURITY: cross-tenant leak persisted after rollback — "
        f"student {student_a} can still see student {student_b}'s row "
        f"{progress_b}. This means either the canary's ROLLBACK failed to "
        "restore RLS, or the real 'Students view own progress' policy "
        "itself is broken independent of this test's seeding."
    )


def test_seeded_leak_canary_would_fail_if_policy_stayed_disabled(
    db_conn, make_user, make_lecture, make_progress
):
    """
    Meta-proof, without any cleanup: run the *identical* leak assertion as
    test_student_cannot_see_other_students_progress (test_rls_policies.py)
    but with RLS forced off first, inside a transaction we deliberately
    let raise instead of gracefully handling — pytest.raises confirms the
    protection assertion itself is what would fail CI, not some unrelated
    error. This is the direct "seeded leak fails CI" receipt requested by
    the S-6 acceptance criterion, independent of the restore-path test
    above.
    """
    professor = make_user(role="professor")
    student_a = make_user(role="student")
    student_b = make_user(role="student")
    lecture = make_lecture(professor)

    make_progress(student_a, lecture, xp=1)
    progress_b = make_progress(student_b, lecture, xp=2)

    with db_conn.cursor() as cur:
        cur.execute("BEGIN")
        try:
            cur.execute(
                "ALTER TABLE public.student_progress DISABLE ROW LEVEL SECURITY"
            )
            _as_user(cur, student_a)
            cur.execute("SELECT id FROM public.student_progress WHERE id = %s", (str(progress_b),))
            row = cur.fetchone()

            # This mirrors the real regression test's assertion verbatim.
            # With RLS seeded-off, `row` IS found — i.e. if this exact
            # assertion appeared (unmodified) in test_rls_policies.py
            # against a schema that had genuinely lost the policy, it
            # would raise AssertionError and fail CI. We assert that
            # failure condition explicitly here via pytest.raises so the
            # canary is self-verifying rather than just narrated.
            with pytest.raises(AssertionError):
                assert row is None, (
                    f"RLS leak: student {student_a} can see student "
                    f"{student_b}'s progress row {progress_b}"
                )
            cur.execute("RESET ROLE")
        finally:
            cur.execute("ROLLBACK")
