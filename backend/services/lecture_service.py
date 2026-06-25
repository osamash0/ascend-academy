import logging
from typing import Optional, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from backend.models.core import Lecture

logger = logging.getLogger(__name__)

async def fetch_lecture(session: AsyncSession, lecture_id: str) -> Optional[Lecture]:
    result = await session.exec(select(Lecture).where(Lecture.id == lecture_id))
    return result.first()

async def toggle_lecture_visibility(
    session: AsyncSession,
    lecture_id: str
) -> Tuple[bool, Optional[bool]]:
    """Toggles is_archived. Returns (success, new_state)."""
    lecture = await fetch_lecture(session, lecture_id)
    if not lecture:
        return False, None
    
    lecture.is_archived = not lecture.is_archived
    session.add(lecture)
    await session.commit()
    await session.refresh(lecture)
    
    return True, lecture.is_archived
