# backend/services/luna/context.py
"""What Luna can see of a Lesson: every page's title, and the text of the pages near the work."""
from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException

from backend.services.luna.prompts import LessonView
from backend.services.luna.validate import PageIndex
from backend.services.v4_reader_service import _lecture_row, get_lecture_content_for_locale

PAGE_CHARS = 2500


async def load_lesson(lecture_id: str, locale: str, around: list[int]) -> LessonView:
    meta = await _lecture_row(UUID(lecture_id))
    content, served = await get_lecture_content_for_locale(UUID(lecture_id), locale)
    slides = (content or {}).get("slides") or []
    by_no = {int(s["slide_number"]): s for s in slides if s.get("slide_number")}
    if not by_no:
        raise HTTPException(status_code=409, detail="This lecture is still being prepared.")
    want = {p + d for p in around for d in (-1, 0, 1)}
    texts = {
        (lecture_id, n): (by_no[n].get("content_text") or by_no[n].get("summary") or "").strip()[:PAGE_CHARS]
        for n in sorted(want) if n in by_no
    }
    return LessonView(
        lecture_id=lecture_id,
        title=str(meta["title"] or ""),
        served=served,
        titles=[(n, (by_no[n].get("title") or "").strip()) for n in sorted(by_no)],
        pages=PageIndex(totals={lecture_id: max(by_no)}, texts=texts),
        course_id=str(meta["course_id"]) if meta["course_id"] else None,
    )
