"""
Backfill `lecture_layouts` (the Layout face) for lectures parsed before it existed.

New parses build their Layout pages inline when FEATURE_LAYOUT_FACE is on (see
backend/services/parser/layout/store.py). This script does the same for the
existing corpus: deterministic PyMuPDF work, no AI calls, no uploads.

Picks lectures that have no `lecture_layouts` rows, or any row whose `version` is
below LAYOUT_VERSION. `--force` picks every lecture (still honouring --lecture-id
and --limit).

EGRESS COST: reading a PDF out of Supabase Storage counts against egress. Same two
mitigations as backfill_lecture_posters:

  * PDFs come from the content-addressed `pdf-uploads` bucket, grouped by pdf_hash,
    so a PDF shared by N lectures is downloaded once, not N times.
  * `--local-dir` sources bytes from a local folder by SHA-256 match first (zero
    egress for any PDF you still have on disk).

Always run with `--dry-run` first: it lists the work and the PDFs that would be
downloaded, and downloads nothing.

Idempotent: rows are upserted per (lecture_id, page), so re-running is safe.

Usage:
    python -m backend.scripts.backfill_layouts --dry-run
    python -m backend.scripts.backfill_layouts --local-dir ~/Downloads
    python -m backend.scripts.backfill_layouts --limit 5
    python -m backend.scripts.backfill_layouts --force --lecture-id <uuid>
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional

# Make `backend.*` importable when run as a script outside the package.
_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.core.database import get_db_connection
from backend.scripts.backfill_lecture_posters import _download_pdf, _index_local_pdfs
from backend.services.parser.layout.build import LAYOUT_VERSION
from backend.services.parser.layout.store import build_layouts

logger = logging.getLogger("backfill_layouts")


async def _fetch_lectures(*, lecture_id: Optional[str] = None) -> List[dict]:
    """Every lecture that has a PDF, with its layout row count and lowest row version. Newest first."""
    params: list = []
    where = "(l.pdf_hash IS NOT NULL OR l.pdf_url IS NOT NULL)"
    if lecture_id:
        params.append(lecture_id)
        where += f" AND l.id = ${len(params)}::uuid"
    sql = f"""
        SELECT l.id::text AS id, l.title, l.pdf_hash, l.pdf_url,
               COALESCE(ll.n, 0) AS layout_rows, ll.min_version
        FROM lectures l
        LEFT JOIN (
            SELECT lecture_id, count(*) AS n, min(version) AS min_version
            FROM public.lecture_layouts GROUP BY lecture_id
        ) ll ON ll.lecture_id = l.id
        WHERE {where}
        ORDER BY l.created_at DESC
    """
    async with await get_db_connection() as conn:
        rows = await conn.fetch(sql, *params)
    return [dict(r) for r in rows]


def needs_layout(row: dict, *, force: bool) -> bool:
    """No layout rows, or any row older than LAYOUT_VERSION (or everything under --force)."""
    if force or not row["layout_rows"]:
        return True
    return row["min_version"] is None or row["min_version"] < LAYOUT_VERSION


async def run(
    *,
    dry_run: bool = False,
    force: bool = False,
    lecture_id: Optional[str] = None,
    limit: Optional[int] = None,
    local_dir: Optional[str] = None,
) -> int:
    lectures = await _fetch_lectures(lecture_id=lecture_id)
    targets = [r for r in lectures if needs_layout(r, force=force)]
    if limit:
        targets = targets[:limit]
    if not targets:
        logger.info("nothing to do -- every lecture already has current layouts")
        return 0

    # One download serves every lecture sharing that PDF.
    by_hash: Dict[str, List[dict]] = defaultdict(list)
    for row in targets:
        by_hash[row["pdf_hash"] or f"url:{row['pdf_url']}"].append(row)

    logger.info("%d lecture(s) need layouts across %d distinct PDF(s)", len(targets), len(by_hash))

    local_index: Dict[str, Path] = {}
    if local_dir:
        local_index = _index_local_pdfs(Path(local_dir).expanduser())

    if dry_run:
        local_hits = sum(1 for h in by_hash if h in local_index)
        logger.info(
            "DRY RUN: would build layouts for %d lecture(s); %d PDF(s) available locally (0 egress), "
            "%d would be downloaded from Supabase Storage",
            len(targets), local_hits, len(by_hash) - local_hits,
        )
        for h, rows in list(by_hash.items())[:10]:
            src = "local" if h in local_index else "storage"
            logger.info("  [%s] %s -> %d lecture(s)", src, h[:16], len(rows))
        return 0

    built = failed = 0
    downloaded_bytes = 0

    for digest, rows in by_hash.items():
        local = local_index.get(digest)
        if local:
            pdf_bytes = local.read_bytes()
        else:
            pdf_bytes = await asyncio.to_thread(_download_pdf, rows[0]["pdf_hash"], rows[0]["pdf_url"])
            if pdf_bytes:
                downloaded_bytes += len(pdf_bytes)

        if not pdf_bytes:
            logger.warning("no PDF bytes for %s -- skipping %d lecture(s)", digest[:16], len(rows))
            failed += len(rows)
            continue

        for row in rows:
            try:
                pages = await build_layouts(row["id"], pdf_bytes)
                built += 1
                logger.info("layouts %s (%d pages) <- %s", row["id"][:8], pages, (row["title"] or "")[:48])
            except Exception as exc:
                logger.warning("layouts failed for lecture %s: %s", row["id"], exc)
                failed += 1

    logger.info(
        "done: %d lecture(s) written, %d failed, %.1f MB downloaded",
        built, failed, downloaded_bytes / 1024 / 1024,
    )
    return 0 if failed == 0 else 1


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report work and egress cost, change nothing")
    parser.add_argument("--force", action="store_true", help="rebuild lectures that already have current layouts")
    parser.add_argument("--lecture-id", help="backfill a single lecture")
    parser.add_argument("--limit", type=int, help="cap the number of lectures processed")
    parser.add_argument("--local-dir", help="source PDFs from this folder by SHA-256 match (zero egress)")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )
    return await run(
        dry_run=args.dry_run, force=args.force, lecture_id=args.lecture_id,
        limit=args.limit, local_dir=args.local_dir,
    )


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
