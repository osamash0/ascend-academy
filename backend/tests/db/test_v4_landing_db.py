"""End to end on a real schema: the owner's own reading and other Spaces never count."""
from __future__ import annotations

import json
import uuid

import pytest

pytestmark = pytest.mark.db
asyncpg = pytest.importorskip("asyncpg")


async def test_the_owners_view_counts_its_members_and_no_one_else(
    throwaway_db, monkeypatch, db_conn, make_user, make_course, make_lecture, make_course_enrollment,
):
    import backend.services.v4_landing_service as service

    async def passthrough(key, view, compute, **kw):
        return await compute()

    monkeypatch.setattr(service.analytics_cache, "get_or_compute_async", passthrough)

    tag = uuid.uuid4().hex[:6]
    owner = make_user(email=f"owner-{tag}@gmail.com")
    members = [make_user(email=f"m{i}-{tag}@gmail.com") for i in range(6)]
    outsider = make_user(email=f"out-{tag}@gmail.com")
    space = make_course(owner, title=f"DBS {tag}")
    lesson = make_lecture(owner, title="Normalization")
    with db_conn.cursor() as cur:
        cur.execute("UPDATE lectures SET course_id = %s, total_slides = 4 WHERE id = %s", (str(space), str(lesson)))
    for m in members:
        make_course_enrollment(m, space)
    make_course_enrollment(owner, space)

    def read(user):
        with db_conn.cursor() as cur:
            cur.execute(
                "INSERT INTO public.learning_events (user_id, event_type, event_data) VALUES (%s, 'slide_view', %s::jsonb)",
                (str(user), json.dumps({"lectureId": str(lesson), "page": 1, "duration_seconds": 30,
                                        "sessionId": str(user), "timestamp": "x"})),
            )

    for user in [*members, owner, outsider]:
        read(user)

    body = await service.get_landing(space, str(owner), "en")
    assert (body["members"], body["readers"]) == (6, 6)
    assert body["lessons"][0]["readers"] == 6

    with pytest.raises(Exception) as denied:
        await service.get_landing(space, str(members[0]), "en")
    assert getattr(denied.value, "status_code", None) == 403
