"""Re-enrich the text slides of ONE lecture that were stored without a summary.

Before the batch-mapping fix, a batch reply that came back without usable
items for some slides left them stored with summary='' and
review_reason='empty_content' (prod 2026-10-30: lecture 8915ce00… slides 9-16,
lecture 88a5c2ee… slides 20-24). This script fills just those slides through
the same batch path the parser uses (with its per-slide retry), and touches
nothing else.

Owner-run only. Default is a dry run that lists the empty slides and makes no
LLM call and no write. ``--apply`` generates the summaries, writes them, and
rebuilds the EN/DE reader snapshots (a summary UPDATE bumps the lecture's
content_revision, so the old snapshots stop being served until rebuilt).

    python -m backend.scripts.reenrich_empty_slides --lecture-id <uuid>
    python -m backend.scripts.reenrich_empty_slides --lecture-id <uuid> --apply

Idempotent: only slides whose summary is still empty are selected and
updated, so a second run does nothing.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
from typing import Any, Dict, List
from uuid import UUID

from backend.core.config import settings
from backend.core.database import get_db_connection

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Same floor the unified parse uses to send a slide down the text path.
MIN_TEXT_CHARS = 25
BATCH = 8

SELECT_EMPTY = """
    SELECT id, slide_number, title, content_text
    FROM slides
    WHERE lecture_id = $1
      AND (summary IS NULL OR btrim(summary) = '')
      AND length(btrim(coalesce(content_text, ''))) >= $2
    ORDER BY slide_number
"""

UPDATE_SUMMARY = """
    UPDATE slides
    SET summary = $2,
        needs_review = CASE WHEN review_reason = 'empty_content' THEN false ELSE needs_review END,
        review_reason = CASE WHEN review_reason = 'empty_content' THEN NULL ELSE review_reason END
    WHERE id = $1 AND (summary IS NULL OR btrim(summary) = '')
"""


async def generate_summaries(
    rows: List[Dict[str, Any]], lecture_context: str, ai_model: str, source_language: str,
) -> Dict[UUID, str]:
    """slide id -> new summary, for the rows the model gave a summary for."""
    from backend.services.parser.unified_orchestrator import _synthesize_text_slide_batch

    by_index = {r["slide_number"] - 1: r for r in rows}
    out: Dict[UUID, str] = {}
    indices = sorted(by_index)
    for start in range(0, len(indices), BATCH):
        chunk = indices[start:start + BATCH]
        results = await _synthesize_text_slide_batch(
            [(i, by_index[i]["content_text"]) for i in chunk],
            lecture_context, ai_model, b"", {}, source_language,
        )
        for i in chunk:
            res = results.get(i)
            summary = str(res.get("summary") or "").strip() if isinstance(res, dict) else ""
            if summary:
                out[by_index[i]["id"]] = summary
            else:
                logger.warning("slide %d: still no summary, left untouched", i + 1)
    return out


async def main(lecture_id: UUID, apply: bool, ai_model: str) -> None:
    async with await get_db_connection() as conn:
        lecture = await conn.fetchrow(
            "SELECT title, description, source_language FROM lectures WHERE id = $1",
            lecture_id,
        )
        if lecture is None:
            raise SystemExit(f"No lecture {lecture_id}")
        rows = [dict(r) for r in await conn.fetch(SELECT_EMPTY, lecture_id, MIN_TEXT_CHARS)]

    logger.info("Lecture %s (%s): %d text slide(s) without a summary: %s",
                lecture_id, lecture["title"], len(rows), [r["slide_number"] for r in rows])
    if not rows or not apply:
        if rows:
            logger.info("Dry run: nothing generated or written. Re-run with --apply.")
        return

    context = "\n".join(p for p in (lecture["title"], lecture["description"]) if p)
    summaries = await generate_summaries(rows, context, ai_model, lecture["source_language"] or "en")

    async with await get_db_connection() as conn:
        async with conn.transaction():
            for slide_id, summary in summaries.items():
                await conn.execute(UPDATE_SUMMARY, slide_id, summary)
    logger.info("Wrote %d of %d summaries.", len(summaries), len(rows))

    if summaries:
        from backend.services.localization_service import localize_lecture
        logger.info("Rebuilding the EN/DE reader snapshots…")
        await localize_lecture(lecture_id, ai_model)
        logger.info("Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--lecture-id", type=UUID, required=True)
    parser.add_argument("--apply", action="store_true",
                        help="generate, write and relocalize (default: list only)")
    parser.add_argument("--ai-model", default=settings.parser_llm_model or "openai")
    args = parser.parse_args()
    asyncio.run(main(args.lecture_id, args.apply, args.ai_model))
