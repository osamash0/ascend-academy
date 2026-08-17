"""Backfill complete EN/DE variants for existing lectures before rollout.

Run after applying 20260721000000_preferred_language_study_content.sql and
before deploying the frontend that reads /localized-content. The job is
intentionally sequential: it is safe to restart and avoids overwhelming the
configured LLM provider.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
from uuid import UUID

from backend.core.config import settings
from backend.core.database import get_db_connection
from backend.services.localization_service import detect_source_language, localize_course, localize_lecture

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main(limit: int | None, ai_model: str) -> None:
    async with await get_db_connection() as conn:
        rows = await conn.fetch(
            """
            SELECT l.id, l.course_id
            FROM lectures l
            WHERE NOT EXISTS (
              SELECT 1 FROM lecture_localizations ll
              WHERE ll.lecture_id = l.id AND ll.locale = 'en'
                AND ll.status = 'ready' AND ll.source_revision = l.content_revision
            ) OR NOT EXISTS (
              SELECT 1 FROM lecture_localizations ll
              WHERE ll.lecture_id = l.id AND ll.locale = 'de'
                AND ll.status = 'ready' AND ll.source_revision = l.content_revision
            )
            ORDER BY l.created_at
            LIMIT $1
            """,
            limit or 1000000,
        )
    course_ids: set[UUID] = set()
    for row in rows:
        lecture_id = row["id"]
        async with await get_db_connection() as conn:
            source_text = await conn.fetchval(
                "SELECT coalesce(string_agg(content_text, ' '), '') FROM slides WHERE lecture_id = $1",
                lecture_id,
            )
            source_language = detect_source_language(source_text or "")
            await conn.execute(
                "UPDATE lectures SET source_language = $1 WHERE id = $2",
                source_language, lecture_id,
            )
        logger.info("Localizing lecture %s", lecture_id)
        await localize_lecture(lecture_id, ai_model)
        if row["course_id"]:
            course_ids.add(row["course_id"])
    for course_id in course_ids:
        logger.info("Localizing course %s", course_id)
        await localize_course(course_id, ai_model)
    logger.info("Localized %d lectures", len(rows))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--ai-model", default=settings.parser_llm_model or "cerebras")
    args = parser.parse_args()
    asyncio.run(main(args.limit, args.ai_model))
