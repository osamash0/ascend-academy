"""Profile trust fields and activity-bound XP, exercised under real RLS roles."""
from __future__ import annotations

import json
import uuid
from contextlib import contextmanager

import psycopg
import pytest

pytestmark = pytest.mark.db


@contextmanager
def as_user(cur, uid):
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', 'authenticated', false)")
    try:
        yield
    finally:
        cur.execute("RESET ROLE")
        cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
        cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


def profile_values(cur, uid):
    cur.execute(
        "SELECT total_xp, current_level, current_streak, best_streak, institution_verified "
        "FROM public.profiles WHERE user_id = %s", (str(uid),),
    )
    return cur.fetchone()


def make_card(cur, lecture):
    cid = uuid.uuid4()
    cur.execute(
        "INSERT INTO public.review_cards (id, lecture_id, source_type, front, back, content_hash) "
        "VALUES (%s, %s, 'concept_qa', '{}'::jsonb, '{}'::jsonb, %s)",
        (str(cid), str(lecture), str(cid)),
    )
    return cid


def test_client_profile_creation_cannot_forge_privileged_fields(db_conn, make_user):
    uid = make_user()
    with db_conn.cursor() as cur:
        # Model an absent profile. Prod also permits own-profile deletion, but
        # the historical migration replay does not carry that manual policy.
        cur.execute("DELETE FROM public.profiles WHERE user_id = %s", (str(uid),))
        with as_user(cur, uid):
            cur.execute(
                "INSERT INTO public.profiles (user_id, email, total_xp, current_level, "
                "current_streak, best_streak, institution_verified, display_name) "
                "VALUES (%s, 'own@test.local', 99999, 999, 999, 999, true, 'My name')",
                (str(uid),),
            )
        assert profile_values(cur, uid) == (0, 1, 0, 0, False)
        cur.execute("SELECT display_name FROM public.profiles WHERE user_id = %s", (str(uid),))
        assert cur.fetchone()[0] == "My name"


def test_update_preserves_trust_fields_and_allows_profile_edits(db_conn, make_user):
    uid = make_user()
    with db_conn.cursor() as cur:
        cur.execute(
            "UPDATE public.profiles SET total_xp=120, current_level=2, current_streak=3, "
            "best_streak=4, institution_verified=true WHERE user_id=%s", (str(uid),),
        )
        with as_user(cur, uid):
            cur.execute(
                "UPDATE public.profiles SET total_xp=99999, current_level=999, "
                "current_streak=999, best_streak=999, institution_verified=false, "
                "display_name='Edited' WHERE user_id=%s", (str(uid),),
            )
        assert profile_values(cur, uid) == (120, 2, 3, 4, True)
        cur.execute("SELECT display_name FROM public.profiles WHERE user_id=%s", (str(uid),))
        assert cur.fetchone()[0] == "Edited"


@pytest.mark.parametrize("operation", ["insert", "update"])
def test_forged_level_cannot_unlock_avatar_in_same_write(db_conn, make_user, operation):
    uid = make_user()
    with db_conn.cursor() as cur:
        cur.execute("SELECT id, slot FROM public.avatar_items WHERE unlock_kind='level' "
                    "AND unlock_value::integer > 1 LIMIT 1")
        item, slot = cur.fetchone()
        loadout = json.dumps({slot: item})
        if operation == "insert":
            cur.execute("DELETE FROM public.profiles WHERE user_id=%s", (str(uid),))
        with as_user(cur, uid), pytest.raises(psycopg.errors.InsufficientPrivilege):
            if operation == "insert":
                cur.execute(
                    "INSERT INTO public.profiles (user_id,email,current_level,luna_loadout) "
                    "VALUES (%s,'own@test.local',999,%s::jsonb)", (str(uid), loadout),
                )
            else:
                cur.execute("UPDATE public.profiles SET current_level=999,luna_loadout=%s::jsonb "
                            "WHERE user_id=%s", (loadout, str(uid)))


def test_trusted_profile_creation_and_updates_keep_server_values(db_conn, make_user):
    uid = make_user()
    with db_conn.cursor() as cur:
        cur.execute("DELETE FROM public.profiles WHERE user_id=%s", (str(uid),))
        cur.execute("SET ROLE service_role")
        try:
            cur.execute(
                "INSERT INTO public.profiles (user_id,email,total_xp,institution_verified) "
                "VALUES (%s,'server@test.local',120,true)", (str(uid),),
            )
            cur.execute("UPDATE public.profiles SET current_level=2 WHERE user_id=%s", (str(uid),))
        finally:
            cur.execute("RESET ROLE")
        assert profile_values(cur, uid) == (120, 2, 0, 0, True)


@pytest.mark.parametrize("reason,key", [
    ("quiz_correct", None), ("invented", "invented:1"),
    ("badge:Polymath", "badge:Polymath"),
    ("review", "review:invented"), (None, "invented:1"),
])
def test_arbitrary_xp_claims_cannot_mint_rewards(db_conn, make_user, reason, key):
    uid = make_user()
    with db_conn.cursor() as cur:
        with as_user(cur, uid), pytest.raises(psycopg.errors.RaiseException):
            cur.execute("SELECT public.grant_xp(500, %s, %s)", (reason, key))
        assert profile_values(cur, uid)[0] == 0


def test_quiz_checks_answer_and_awards_once(db_conn, make_user, make_lecture, make_slide, make_quiz):
    uid = make_user()
    qid = make_quiz(make_slide(make_lecture(uid)))
    with db_conn.cursor() as cur:
        with as_user(cur, uid):
            for selected, expected in [(0, 0), (-1, 0), (None, 0), (3, 10), (3, 0)]:
                cur.execute("SELECT public.grant_quiz_xp(%s,%s)", (str(qid), selected))
                assert cur.fetchone()[0] == expected
        assert profile_values(cur, uid)[:2] == (10, 1)


def test_quiz_shares_live_reader_dedupe_key(db_conn, make_user, make_lecture, make_slide, make_quiz):
    uid = make_user()
    qid = make_quiz(make_slide(make_lecture(uid)))
    with db_conn.cursor() as cur:
        cur.execute("INSERT INTO public.xp_events(user_id,xp,reason,dedupe_key) "
                    "VALUES (%s,10,'quiz_correct',%s)", (str(uid), f"v4quiz:{qid}"))
        with as_user(cur, uid):
            cur.execute("SELECT public.grant_quiz_xp(%s,3)", (str(qid),))
            assert cur.fetchone()[0] == 0
        cur.execute("SELECT count(*) FROM public.xp_events WHERE user_id=%s", (str(uid),))
        assert cur.fetchone()[0] == 1


def test_cannot_claim_quiz_in_another_users_private_lesson(db_conn, make_user, make_slide, make_quiz):
    owner, other = make_user(), make_user()
    lid = uuid.uuid4()
    with db_conn.cursor() as cur:
        cur.execute("INSERT INTO public.lectures(id,title,student_owner_id,visibility,total_slides) "
                    "VALUES (%s,'Private',%s,'private_student',1)", (str(lid), str(owner)))
    qid = make_quiz(make_slide(lid))
    with db_conn.cursor() as cur:
        with as_user(cur, other), pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute("SELECT public.grant_quiz_xp(%s,3)", (str(qid),))
        assert profile_values(cur, other)[0] == 0


def test_completion_reward_requires_progress_and_canonical_amount(db_conn, make_user, make_lecture, make_progress):
    uid = make_user()
    lid = make_lecture(uid)
    make_progress(uid, lid)
    key = f"lecture:{lid}"
    with db_conn.cursor() as cur:
        with as_user(cur, uid), pytest.raises(psycopg.errors.RaiseException):
            cur.execute("SELECT public.grant_xp(20,'lecture_complete',%s)", (key,))
        cur.execute("UPDATE public.student_progress SET completed_at=now() "
                    "WHERE user_id=%s AND lecture_id=%s", (str(uid), str(lid)))
        with as_user(cur, uid):
            with pytest.raises(psycopg.errors.RaiseException):
                cur.execute("SELECT public.grant_xp(500,'lecture_complete',%s)", (key,))
            cur.execute("SELECT public.grant_xp(20,'lecture_complete',%s)", (key,))
            cur.execute("SELECT public.grant_xp(20,'lecture_complete',%s)", (key,))
            with pytest.raises(psycopg.errors.RaiseException):
                cur.execute("SELECT public.grant_xp(20,'lecture_complete',%s)", (key + ':again',))
        assert profile_values(cur, uid)[0] == 20


def test_review_claim_needs_backend_log_and_cannot_rewrite_key(db_conn, make_user, make_lecture):
    uid = make_user()
    with db_conn.cursor() as cur:
        card = make_card(cur, make_lecture(uid))
        cur.execute("SELECT (now() AT TIME ZONE 'UTC')::date")
        day = cur.fetchone()[0]
        key = f"review:{uid}:{card}:{day}"
        with as_user(cur, uid):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("INSERT INTO public.review_log(user_id,card_id,rating) VALUES (%s,%s,4)",
                            (str(uid), str(card)))
            with pytest.raises(psycopg.errors.RaiseException):
                cur.execute("SELECT public.grant_xp(5,'review',%s)", (key,))
        cur.execute("INSERT INTO public.review_log(user_id,card_id,rating) VALUES (%s,%s,4)",
                    (str(uid), str(card)))
        with as_user(cur, uid):
            for bad_key in [key.replace(str(uid), str(uuid.uuid4())), key[:-10] + '2099-01-01']:
                with pytest.raises(psycopg.errors.RaiseException):
                    cur.execute("SELECT public.grant_xp(5,'review',%s)", (bad_key,))
            cur.execute("SELECT public.grant_xp(5,'review',%s)", (key,))
            cur.execute("SELECT public.grant_xp(5,'review',%s)", (key,))
        assert profile_values(cur, uid)[0] == 5


def test_awarded_badge_reward_is_preserved_and_cannot_be_replayed(db_conn, make_user):
    uid = make_user()
    with db_conn.cursor() as cur:
        with as_user(cur, uid):
            cur.execute("SELECT public.award_badge('Voice Heard')")
            cur.execute("SELECT public.award_badge('Voice Heard')")
        cur.execute("SELECT xp_reward FROM public.badge_definitions WHERE key='Voice Heard'")
        reward = cur.fetchone()[0]
        assert profile_values(cur, uid)[0] == reward
        with as_user(cur, uid):
            cur.execute("SELECT public.grant_xp(%s,'badge:Voice Heard','badge:Voice Heard')", (reward,))
        assert profile_values(cur, uid)[0] == reward


@pytest.mark.parametrize("function", [
    "public._record_xp(uuid,integer,text,text)",
    "public.update_user_streak(boolean)",
])
def test_internal_stat_writers_have_no_client_execute(db_conn, function):
    with db_conn.cursor() as cur:
        for role in ["anon", "authenticated"]:
            cur.execute("SELECT has_function_privilege(%s,%s,'EXECUTE')", (role, function))
            assert cur.fetchone()[0] is False


def test_quiz_rpc_is_not_anonymous(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT public.grant_quiz_xp(%s,3)", (str(uuid.uuid4()),))
        finally:
            cur.execute("RESET ROLE")
