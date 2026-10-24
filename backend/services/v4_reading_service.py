"""Reading progress for the v4 reader.

The v4 reader used to record nothing: no student_progress, no visits, no
streak, no slide_view events. Home, Space progress, the professor's analytics
and Launch Control all read those tables, so a student reading in v4 looked
like a student who never came. One call per page left, in one transaction,
writing the same rows the old reader (src/pages/LectureView.tsx) writes.
"""
from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from backend.core.database import get_db_connection

#: A page glanced at for less than this is not counted as read.
MIN_SECONDS_TO_COUNT = 2

_PROGRESS_SQL = """
INSERT INTO student_progress (user_id, lecture_id, completed_slides, last_slide_viewed, updated_at)
VALUES ($1::uuid, $2, CASE WHEN $4 THEN ARRAY[$3]::int[] ELSE ARRAY[]::int[] END, $3, now())
ON CONFLICT (user_id, lecture_id) DO UPDATE SET
  completed_slides = CASE WHEN $4 THEN ARRAY(
      SELECT DISTINCT p FROM unnest(array_append(COALESCE(student_progress.completed_slides, '{}'), $3)) p
      ORDER BY p) ELSE COALESCE(student_progress.completed_slides, '{}') END,
  last_slide_viewed = $3,
  updated_at = now()
RETURNING completed_slides, completed_at
"""

# A new lecture_visits row at most every 30 minutes per lecture: the old reader
# logs one per open, and a long read must not become hundreds.
_RECENT_VISIT_SQL = """
SELECT EXISTS (SELECT 1 FROM lecture_visits
  WHERE user_id = $1::uuid AND lecture_id = $2
    AND visited_at > now() - interval '30 minutes')
"""

_COURSE_VISIT_SQL = """
INSERT INTO course_visits (user_id, course_id, last_visited_at, visit_count)
VALUES ($1::uuid, $2, now(), 1)
ON CONFLICT (user_id, course_id) DO UPDATE
  SET last_visited_at = now(), visit_count = course_visits.visit_count + 1
"""

# The streak rule of record_daily_activity(), which reads auth.uid() and so
# cannot be called on the user's behalf from the server.
_STREAK_SQL = """
UPDATE profiles SET
  current_streak = CASE
    WHEN last_active_date = CURRENT_DATE THEN current_streak
    WHEN last_active_date = CURRENT_DATE - 1 THEN COALESCE(current_streak, 0) + 1
    ELSE 1 END,
  best_streak = GREATEST(COALESCE(best_streak, 0), CASE
    WHEN last_active_date = CURRENT_DATE THEN COALESCE(current_streak, 0)
    WHEN last_active_date = CURRENT_DATE - 1 THEN COALESCE(current_streak, 0) + 1
    ELSE 1 END),
  last_active_date = CURRENT_DATE
WHERE user_id = $1::uuid
"""


async def record_reading(lecture_id: UUID, user_id: str, page: int, seconds: float) -> dict[str, Any]:
    async with await get_db_connection() as conn:
        async with conn.transaction():
            lec = await conn.fetchrow(
                "SELECT course_id, COALESCE(total_slides, 0) AS total FROM lectures WHERE id = $1",
                lecture_id,
            )
            if not lec:
                raise HTTPException(status_code=404, detail="Lecture not found.")
            total = lec["total"]
            if total and page > total:
                raise HTTPException(status_code=422, detail="No such page.")

            counted = seconds >= MIN_SECONDS_TO_COUNT
            row = await conn.fetchrow(_PROGRESS_SQL, user_id, lecture_id, page, counted)
            read = len(row["completed_slides"] or [])
            if total and read >= total and row["completed_at"] is None:
                await conn.execute(
                    "UPDATE student_progress SET completed_at = now() "
                    "WHERE user_id = $1::uuid AND lecture_id = $2",
                    user_id, lecture_id,
                )

            if not await conn.fetchval(_RECENT_VISIT_SQL, user_id, lecture_id):
                await conn.execute(
                    "INSERT INTO lecture_visits (user_id, lecture_id, course_id) VALUES ($1::uuid, $2, $3)",
                    user_id, lecture_id, lec["course_id"],
                )
                if lec["course_id"]:
                    await conn.execute(_COURSE_VISIT_SQL, user_id, lec["course_id"])

            await conn.execute(_STREAK_SQL, user_id)

            if counted:
                slide_id = await conn.fetchval(
                    "SELECT id FROM slides WHERE lecture_id = $1 AND slide_number = $2 LIMIT 1",
                    lecture_id, page,
                )
                # Same event shape as the old reader's slide_view, so the
                # professor's analytics count v4 reading without a change.
                await conn.execute(
                    "INSERT INTO learning_events (user_id, event_type, event_data) "
                    "VALUES ($1::uuid, 'slide_view', $2::jsonb)",
                    user_id,
                    json.dumps({
                        "lectureId": str(lecture_id),
                        "slideId": str(slide_id) if slide_id else None,
                        "page": page,
                        "duration_seconds": round(seconds),
                        "source": "v4_reader",
                    }),
                )

    if total and read >= total:
        percent = 100
    else:
        percent = min(100, round(read / total * 100)) if total else 0
    return {"pagesRead": read, "percentComplete": percent}
