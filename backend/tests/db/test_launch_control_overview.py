"""Launch Control overview against a real Postgres with every migration."""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.db

asyncpg = pytest.importorskip("asyncpg")


async def test_overview_measures_a_visible_lecture_and_counts_real_users_only(
    pg_dsn, db_conn, make_user, make_course, make_lecture, make_slide, make_quiz,
):
    tag = uuid.uuid4().hex[:8]
    prof = make_user(role="professor", email=f"prof-{tag}@uni-marburg.de")
    make_user(email=f"real-{tag}@gmail.com")
    make_user(email=f"seed-{tag}@example.com")
    course = make_course(prof, title=f"Kryptologie {tag}")
    lecture = make_lecture(prof, title=f"Differential Cryptanalysis {tag}")
    with db_conn.cursor() as cur:
        cur.execute("UPDATE public.lectures SET course_id = %s WHERE id = %s", (str(course), str(lecture)))
    for n in range(1, 5):
        slide = make_slide(lecture, slide_number=n)
        make_quiz(slide)
        make_quiz(slide)

    from backend.services.launch_control_service import build_overview

    conn = await asyncpg.connect(pg_dsn)
    try:
        overview = await build_overview(conn)
    finally:
        await conn.close()

    [row] = [l for l in overview["catalog"] if l["id"] == str(lecture)]
    assert (row["slides"], row["quizzes"], row["poster"]) == (4, 8, False)
    assert row["missing"] == ["concepts", "poster", "search index"]

    pulse = overview["pulse"]
    assert pulse["classification_ready"] is True
    assert pulse["totals"]["real_users"] < pulse["totals"]["all_users"]
    assert len(pulse["signups_daily"]) == 30
    assert {g["id"] for g in overview["gates"]} >= {"ai_mode", "real_users", "catalog", "starter"}
    assert len(overview["ai"]["daily"]) == 30
