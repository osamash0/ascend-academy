"""
Backfill the cross-course concept graph for every existing lecture.

Walks every row in `lectures`, calls `ingest_lecture_concepts`, and
prints a per-lecture report.  Idempotent: rerunning replaces existing
`concept_lectures` rows via the upsert and reuses concepts via
embedding-similarity dedupe.

Usage:
    python -m backend.scripts.backfill_concept_graph
    python -m backend.scripts.backfill_concept_graph --lecture-id <uuid>
    python -m backend.scripts.backfill_concept_graph --limit 5
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
from backend.services.concept_graph import ingest_lecture_concepts

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


async def backfill(
    *, lecture_id: Optional[str] = None, limit: Optional[int] = None
) -> dict:
    if lecture_id:
        ids = [lecture_id]
    else:
        ids = _list_lecture_ids()

    if limit is not None:
        ids = ids[:limit]

    totals = {"lectures": 0, "concepts": 0, "linked": 0, "created": 0, "failed": 0}
    for lid in ids:
        try:
            report = await ingest_lecture_concepts(lid)
        except Exception as e:
            logger.error("Backfill failed for %s: %s", lid, e)
            totals["failed"] += 1
            continue
        totals["lectures"] += 1
        totals["concepts"] += report.get("concepts", 0)
        totals["linked"] += report.get("linked", 0)
        totals["created"] += report.get("created", 0)
        print(f"  {lid}: {report}")
    return totals


def _parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Backfill the cross-course concept graph.")
    p.add_argument("--lecture-id", help="Restrict to a single lecture id.")
    p.add_argument(
        "--limit", type=int, default=None,
        help="Process at most N lectures (useful for smoke tests).",
    )
    return p.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    logging.basicConfig(level=logging.INFO,
                       format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = _parse_args(argv)
    totals = asyncio.run(backfill(lecture_id=args.lecture_id, limit=args.limit))
    print("\nBackfill summary:")
    for k, v in totals.items():
        print(f"  {k}: {v}")
    return 0 if totals["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
