"""Real-Postgres guards for activation onboarding ownership and telemetry.

Course blueprints are deliberately backend-only tables: the FastAPI service
role enforces owner checks and direct authenticated access must disclose no
draft material.  These tests exercise the actual migration/RLS chain instead
of relying only on the in-memory API fake.
"""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.db


def _as_user(cur, uid: uuid.UUID) -> None:
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', 'authenticated', false)")


def _reset_user(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


def _seed_private_blueprint(cur, owner: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    batch_id, blueprint_id, source_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    cur.execute(
        """
        INSERT INTO public.material_sources (id, owner_id, batch_id, original_filename)
        VALUES (%s, %s, %s, 'private.pdf')
        """,
        (str(source_id), str(owner), str(batch_id)),
    )
    cur.execute(
        """
        INSERT INTO public.course_blueprints (id, owner_id, batch_id, title)
        VALUES (%s, %s, %s, 'Private blueprint')
        """,
        (str(blueprint_id), str(owner), str(batch_id)),
    )
    cur.execute(
        """
        INSERT INTO public.course_blueprint_items (blueprint_id, material_source_id, title, position)
        VALUES (%s, %s, 'Private item', 0)
        """,
        (str(blueprint_id), str(source_id)),
    )
    return batch_id, blueprint_id, source_id


def test_authenticated_user_cannot_read_or_mutate_another_users_blueprint_draft(db_conn, make_user):
    owner = make_user(role="student")
    attacker = make_user(role="student")
    with db_conn.cursor() as cur:
        _batch_id, blueprint_id, source_id = _seed_private_blueprint(cur, owner)
        _as_user(cur, attacker)

        # Read: no private blueprint, source, or item leaks to an arbitrary
        # browser client.  API reads use the service role only after its owner
        # lookup succeeds.
        cur.execute("SELECT id FROM public.course_blueprints WHERE id = %s", (str(blueprint_id),))
        assert cur.fetchall() == []
        cur.execute("SELECT id FROM public.material_sources WHERE id = %s", (str(source_id),))
        assert cur.fetchall() == []
        cur.execute("SELECT id FROM public.course_blueprint_items WHERE blueprint_id = %s", (str(blueprint_id),))
        assert cur.fetchall() == []

        # Update and split-equivalent insert cannot alter the owner's draft.
        cur.execute("UPDATE public.course_blueprints SET title = 'stolen' WHERE id = %s", (str(blueprint_id),))
        assert cur.rowcount == 0
        with pytest.raises(Exception):
            cur.execute(
                """
                INSERT INTO public.course_blueprint_items (blueprint_id, material_source_id, title, position)
                VALUES (%s, %s, 'forged split', 1)
                """,
                (str(blueprint_id), str(source_id)),
            )
        _reset_user(cur)

        cur.execute("SELECT title FROM public.course_blueprints WHERE id = %s", (str(blueprint_id),))
        assert cur.fetchone()[0] == "Private blueprint"
        cur.execute("SELECT count(*) FROM public.course_blueprint_items WHERE blueprint_id = %s", (str(blueprint_id),))
        assert cur.fetchone()[0] == 1


def test_completion_rpc_is_idempotent_and_emits_one_canonical_event(db_conn, make_user):
    student = make_user(role="student")
    with db_conn.cursor() as cur:
        _as_user(cur, student)
        cur.execute("SELECT public.complete_activation_onboarding('material', 'exam')")
        first = cur.fetchone()[0]
        cur.execute("SELECT public.complete_activation_onboarding('example', NULL)")
        second = cur.fetchone()[0]
        _reset_user(cur)

        assert first["completed"] is True
        assert first["path"] == "material"
        assert second["completed"] is False
        assert second["path"] == "material"
        cur.execute(
            "SELECT event_data FROM public.learning_events WHERE user_id = %s AND event_type = 'onboarding_completed'",
            (str(student),),
        )
        rows = cur.fetchall()
        assert len(rows) == 1
        assert rows[0][0]["path"] == "material"
        cur.execute("SELECT has_completed_activation_onboarding FROM public.profiles WHERE user_id = %s", (str(student),))
        assert cur.fetchone()[0] is True
