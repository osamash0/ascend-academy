"""
Backfill spaced-repetition review cards for every existing lecture.

Walks every row in `lectures`, calls `generate_review_cards`, and prints a
per-lecture report. Idempotent: rerunning does not duplicate cards (unique
on `review_cards(lecture_id, content_hash)`).

Usage:
    python -m backend.scripts.backfill_review_cards
    python -m backend.scripts.backfill_review_cards --lecture-id <uuid>
    python -m backend.scripts.backfill_review_cards --limit 5
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path
from typing import List, Optional

_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.core.database import supabase_admin
from backend.services.review.card_factory import generate_review_cards

logger = logging.getLogger(__name__)


def _list_lecture_ids() -> List[str]:
    out: List[str] = []
    page_size = 500
    start = 0
    while True:
        res = (
            supabase_admin.table("lectures")
            .select("id")
            .order("created_at", desc=False)
            .range(start, start + page_size - 1)
            .execute()
        )
        rows = res.data or []
        out.extend(r["id"] for r in rows if r.get("id"))
        if len(rows) < page_size:
            break
        start += page_size
    return out


async def backfill(*, lecture_id: Optional[str] = None, limit: Optional[int] = None) -> dict:
    ids = [lecture_id] if lecture_id else _list_lecture_ids()
    if limit is not None:
        ids = ids[:limit]

    totals = {"lectures": 0, "quiz_cards": 0, "failed": 0}
    for lid in ids:
        try:
            report = await generate_review_cards({}, lid)
        except Exception as e:
            logger.error("Backfill failed for %s: %s", lid, e)
            totals["failed"] += 1
            continue
        totals["lectures"] += 1
        totals["quiz_cards"] += report.get("quiz_cards", 0)
        print(f"  {lid}: {report}")
    return totals


def _parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Backfill spaced-repetition review cards.")
    p.add_argument("--lecture-id", help="Restrict to a single lecture id.")
    p.add_argument("--limit", type=int, default=None, help="Process at most N lectures.")
    return p.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = _parse_args(argv)
    totals = asyncio.run(backfill(lecture_id=args.lecture_id, limit=args.limit))
    print("\nBackfill summary:")
    for k, v in totals.items():
        print(f"  {k}: {v}")
    return 0 if totals["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
