"""How it's landing — the owner's view of a Space, computed on the server.

Who may open it is decided first (`assert_space_owner`); then the Space's
activity is read once, folded into facts, run through the insight engine,
floored and translated into the `Landing` shape. Nothing in the payload
names a member or quotes one (spec §0).
"""
from __future__ import annotations

from typing import Any, Optional
from uuid import UUID

from backend.core.database import get_db_connection
from backend.services.v4_personal import is_personal

_SPACE_SQL = """
SELECT c.id, c.title, c.professor_id,
       EXISTS (SELECT 1 FROM course_enrollments e
               WHERE e.course_id = c.id AND e.user_id = $2::uuid) AS is_member
FROM courses c
WHERE c.id = $1
"""


async def space_row(space_id: UUID, user_id: str) -> Optional[dict[str, Any]]:
    """The Space's owner and whether the caller belongs to it; None for the
    caller's personal Space (no owner's view) or a Space that does not exist."""
    if is_personal(space_id, user_id):
        return None
    async with await get_db_connection() as conn:
        row = await conn.fetchrow(_SPACE_SQL, space_id, user_id)
    return dict(row) if row else None
