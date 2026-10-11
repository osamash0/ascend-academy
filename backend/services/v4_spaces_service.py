"""v4 on real data: the shapes the v4 namespace renders, read from the
existing product tables. Each function returns exactly the TypeScript type it
is named after in src/features/spaces/types.ts, so the frontend's live
repository is a thin transport and never reshapes."""
from __future__ import annotations

from typing import Any, Dict, Optional

from backend.core.database import get_db_connection


def _person(row: Any) -> Dict[str, Any]:
    """profiles row → Person. Content is never anonymous, so a missing name
    falls back to the email's local part rather than to nothing."""
    name = (row["display_name"] or row["full_name"] or "").strip()
    if not name and row["email"]:
        name = row["email"].split("@", 1)[0]
    return {"id": str(row["user_id"]), "name": name or "Learner", "avatarUrl": row["avatar_url"]}


async def get_person(user_id: str) -> Optional[Dict[str, Any]]:
    conn_cm = await get_db_connection()
    async with conn_cm as conn:
        row = await conn.fetchrow(
            "SELECT user_id, display_name, full_name, email, avatar_url "
            "FROM public.profiles WHERE user_id = $1::uuid",
            user_id,
        )
    return _person(row) if row else None
