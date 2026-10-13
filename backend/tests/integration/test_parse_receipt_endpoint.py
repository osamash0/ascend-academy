"""GET /api/v1/lectures/{lecture_id}/parse-receipt — ownership (Arc 5).

Driven through the FastAPI app against fake_supabase, which applies NO RLS:
the only thing keeping professor B out of professor A's receipt is the
endpoint's own ownership check (the RLS policy is covered separately in
backend/tests/db/test_parse_receipts_rls.py). A non-owner gets the same 404
as a missing lecture, so lecture ids are not enumerable.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import verify_token

LECTURE_A = "aaaaaaaa-0000-4000-8000-00000000000a"
PRIVATE_LECTURE = "aaaaaaaa-0000-4000-8000-00000000000b"
RUN_NEW = "bbbbbbbb-0000-4000-8000-00000000000a"
RUN_OLD = "bbbbbbbb-0000-4000-8000-0000000000a0"


@pytest.fixture
def client(app):
    return TestClient(app)


def _auth_as(app, user) -> None:
    app.dependency_overrides[verify_token] = lambda: user


def _url(lecture_id: str) -> str:
    return f"/api/v1/lectures/{lecture_id}/parse-receipt"


def _seed_lecture(fake, *, lecture_id, professor_id=None, student_owner_id=None) -> None:
    fake.table("lectures").insert({
        "id": lecture_id, "title": "Graphs", "course_id": None,
        "professor_id": professor_id, "student_owner_id": student_owner_id,
        "visibility": "private_student" if student_owner_id else "course",
    }).execute()


def _seed_receipt(fake, *, run_id, lecture_id, created_at, kept=3, llm_usage=None) -> None:
    fake.table("parse_receipts").insert({
        "run_id": run_id,
        "lecture_id": lecture_id,
        "deck_skeleton": {
            "boilerplate": ["footer seite #"],
            "slides": [{"index": 0, "role": "title", "section": 0, "chars": 12}],
            "sections": [{"index": 0, "title": "Graphs", "start": 0, "end": 0}],
        },
        "slide_provenance": [{
            "index": 0, "route": "batch", "prompt": "BATCH_SLIDE_PROMPT", "prompt_version": "v3",
            "requested_model": "cerebras", "synthesis_failed": False,
            "needs_review": False, "review_reason": None,
        }],
        "quiz_grounding": {"proposed": 4, "kept": kept, "repaired": 1,
                           "dropped": 4 - kept, "drop_reasons": {"no_source": 4 - kept}},
        "llm_usage": llm_usage,
        "created_at": created_at,
    }).execute()


def test_owner_gets_the_latest_receipt(client, app, fake_supabase, professor_user):
    _auth_as(app, professor_user)
    _seed_lecture(fake_supabase, lecture_id=LECTURE_A, professor_id=professor_user.id)
    _seed_receipt(fake_supabase, run_id=RUN_OLD, lecture_id=LECTURE_A,
                  created_at="2026-10-01T10:00:00+00:00", kept=1)
    _seed_receipt(fake_supabase, run_id=RUN_NEW, lecture_id=LECTURE_A,
                  created_at="2026-10-12T10:00:00+00:00", kept=3)

    r = client.get(_url(LECTURE_A))

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True
    data = body["data"]
    assert set(data) == {"run_id", "lecture_id", "deck_skeleton", "slide_provenance",
                         "quiz_grounding", "llm_usage", "created_at"}
    assert data["run_id"] == RUN_NEW
    assert data["quiz_grounding"]["kept"] == 3
    assert data["deck_skeleton"]["boilerplate"] == ["footer seite #"]
    assert data["slide_provenance"][0]["route"] == "batch"


def test_other_professor_gets_404_and_no_receipt(client, app, fake_supabase,
                                                 professor_user, other_professor_user):
    _auth_as(app, other_professor_user)
    _seed_lecture(fake_supabase, lecture_id=LECTURE_A, professor_id=professor_user.id)
    _seed_receipt(fake_supabase, run_id=RUN_NEW, lecture_id=LECTURE_A,
                  created_at="2026-10-12T10:00:00+00:00")

    r = client.get(_url(LECTURE_A))

    assert r.status_code == 404
    assert r.json()["detail"] == "Lecture not found."
    assert "deck_skeleton" not in r.text


def test_404_when_owned_lecture_has_no_receipt(client, app, fake_supabase, professor_user):
    _auth_as(app, professor_user)
    _seed_lecture(fake_supabase, lecture_id=LECTURE_A, professor_id=professor_user.id)

    r = client.get(_url(LECTURE_A))

    assert r.status_code == 404
    assert r.json()["detail"] == "No parse receipt for this lecture."


def test_404_for_unknown_lecture(client, app, fake_supabase, professor_user):
    _auth_as(app, professor_user)
    r = client.get(_url(LECTURE_A))
    assert r.status_code == 404
    assert r.json()["detail"] == "Lecture not found."


def test_private_upload_owner_reads_own_receipt(client, app, fake_supabase, student_user):
    _auth_as(app, student_user)
    _seed_lecture(fake_supabase, lecture_id=PRIVATE_LECTURE, student_owner_id=student_user.id)
    _seed_receipt(fake_supabase, run_id=RUN_NEW, lecture_id=PRIVATE_LECTURE,
                  created_at="2026-10-12T10:00:00+00:00")

    r = client.get(_url(PRIVATE_LECTURE))

    assert r.status_code == 200, r.text
    assert r.json()["data"]["run_id"] == RUN_NEW


def test_non_uuid_lecture_id_is_rejected(client, app, fake_supabase, professor_user):
    _auth_as(app, professor_user)
    assert client.get(_url("not-a-uuid")).status_code == 422


def test_unauthenticated_request_is_401(client, fake_supabase):
    assert client.get(_url(LECTURE_A)).status_code == 401


def test_enrolled_student_gets_404(client, app, fake_supabase, professor_user, student_user):
    _auth_as(app, student_user)
    _seed_lecture(fake_supabase, lecture_id=LECTURE_A, professor_id=professor_user.id)
    _seed_receipt(fake_supabase, run_id=RUN_NEW, lecture_id=LECTURE_A,
                  created_at="2026-10-12T10:00:00+00:00")

    r = client.get(_url(LECTURE_A))

    assert r.status_code == 404
    assert r.json()["detail"] == "Lecture not found."
    assert "deck_skeleton" not in r.text


_USAGE = {"calls": 2, "prompt_tokens": 2500, "completion_tokens": 1100, "cost_usd": 0.0009,
          "by_prompt": {"BATCH_SLIDE_PROMPT": {"calls": 1, "cost_usd": 0.0009}},
          "by_provider": {"openai": {"calls": 1, "cost_usd": 0.0009}}, "vision_metered": True,
          "unmetered": ["embeddings", "admin_slide_classifier"]}


def test_owner_gets_llm_usage(client, app, fake_supabase, professor_user):
    _auth_as(app, professor_user)
    _seed_lecture(fake_supabase, lecture_id=LECTURE_A, professor_id=professor_user.id)
    _seed_receipt(fake_supabase, run_id=RUN_NEW, lecture_id=LECTURE_A,
                  created_at="2026-10-12T10:00:00+00:00", llm_usage=_USAGE)
    r = client.get(_url(LECTURE_A))
    assert r.status_code == 200, r.text
    assert r.json()["data"]["llm_usage"] == _USAGE


def test_llm_usage_is_not_leaked_to_non_owners(client, app, fake_supabase, professor_user,
                                               other_professor_user, student_user):
    _seed_lecture(fake_supabase, lecture_id=LECTURE_A, professor_id=professor_user.id)
    _seed_receipt(fake_supabase, run_id=RUN_NEW, lecture_id=LECTURE_A,
                  created_at="2026-10-12T10:00:00+00:00", llm_usage=_USAGE)
    for who in (other_professor_user, student_user):
        _auth_as(app, who)
        r = client.get(_url(LECTURE_A))
        assert r.status_code == 404
        assert "llm_usage" not in r.text and "cost_usd" not in r.text
