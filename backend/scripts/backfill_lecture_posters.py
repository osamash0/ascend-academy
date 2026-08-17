"""
Backfill `lectures.poster_url` for lectures ingested before posters existed.

The console hero used to paint its key art by handing the lecture's source PDF to
react-pdf and rendering page 1. pdf.js auto-fetches the rest of a document, so
focusing a lecture in the library pulled its entire PDF -- 1.6 MB on average, up
to 6.9 MB -- purely as decoration. That was the dominant contributor to the
Supabase egress overage (2.96 GB uncached vs 0.06 GB cached at only 15 MAU).

New ingests render a poster inline from the PDF bytes already in memory (see
backend/services/parser/poster.py). This script does the same for the existing
corpus.

EGRESS COST: downloading a PDF out of Supabase Storage counts against the egress
quota -- the very thing we are trying to reduce. Two mitigations:

  * PDFs are fetched from the content-addressed `pdf-uploads` bucket and grouped
    by pdf_hash, so a PDF shared by N lectures is downloaded once, not N times.
    On the current corpus that is 67 distinct downloads (~128 MB) covering 150
    lecture objects (238 MB).
  * `--local-dir` sources bytes from a local folder by SHA-256 match first, which
    costs zero egress for any PDF you still have on disk. Point it at the folder
    you originally uploaded from and the backfill may cost nothing at all.

Always run with `--dry-run` first: it reports exactly how many bytes would be
downloaded before anything is transferred.

Idempotent: only lectures with a NULL poster_url are considered, and poster
uploads upsert at a deterministic path, so re-running is safe. `--force`
re-renders lectures that already have a poster.

Usage:
    python -m backend.scripts.backfill_lecture_posters --dry-run
    python -m backend.scripts.backfill_lecture_posters --local-dir ~/Downloads
    python -m backend.scripts.backfill_lecture_posters --limit 5
    python -m backend.scripts.backfill_lecture_posters --force --lecture-id <uuid>
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import logging
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional

# Make `backend.*` importable when run as a script outside the package.
_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.core.database import get_db_connection, get_client
from backend.services.parser.poster import (
    POSTER_BUCKET,
    POSTER_CACHE_CONTROL,
    poster_path,
    render_poster,
)

logger = logging.getLogger("backfill_lecture_posters")


async def _fetch_targets(
    *, force: bool, lecture_id: Optional[str], limit: Optional[int]
) -> List[dict]:
    """Lectures needing a poster, newest first."""
    where = ["l.pdf_hash IS NOT NULL OR l.pdf_url IS NOT NULL"]
    params: list = []
    if not force:
        where.append("l.poster_url IS NULL")
    if lecture_id:
        params.append(lecture_id)
        where.append(f"l.id = ${len(params)}::uuid")

    sql = f"""
        SELECT l.id::text AS id, l.title, l.pdf_hash, l.pdf_url
        FROM lectures l
        WHERE ({where[0]}){''.join(' AND ' + c for c in where[1:])}
        ORDER BY l.created_at DESC
    """
    if limit:
        params.append(limit)
        sql += f" LIMIT ${len(params)}"

    async with await get_db_connection() as conn:
        rows = await conn.fetch(sql, *params)
    return [dict(r) for r in rows]


def _index_local_pdfs(local_dir: Path) -> Dict[str, Path]:
    """Map SHA-256 -> path for every PDF under `local_dir`.

    Lets the backfill source bytes from disk instead of paying egress. The hash
    is the same content address the parse pipeline keys `pdf-uploads` on.
    """
    index: Dict[str, Path] = {}
    pdfs = sorted(local_dir.rglob("*.pdf"))
    for path in pdfs:
        try:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            index.setdefault(digest, path)
        except Exception as exc:
            logger.debug("could not hash %s: %s", path, exc)
    logger.info("indexed %d local PDFs (%d distinct) from %s", len(pdfs), len(index), local_dir)
    return index


def _download_pdf(pdf_hash: Optional[str], pdf_url: Optional[str]) -> Optional[bytes]:
    """Fetch PDF bytes, preferring the content-addressed bucket."""
    sb = get_client(use_admin=True)
    if pdf_hash:
        try:
            return sb.storage.from_("pdf-uploads").download(f"{pdf_hash}.pdf")
        except Exception as exc:
            logger.debug("pdf-uploads miss for %s: %s", pdf_hash, exc)
    if pdf_url:
        # Stored path-only for new rows; tolerate a legacy full URL.
        path = pdf_url.split("lecture-pdfs/", 1)[-1]
        try:
            return sb.storage.from_("lecture-pdfs").download(path)
        except Exception as exc:
            logger.warning("lecture-pdfs download failed for %s: %s", path, exc)
    return None


def _upload_poster(lecture_id: str, webp: bytes) -> str:
    path = poster_path(lecture_id)
    sb = get_client(use_admin=True)
    sb.storage.from_(POSTER_BUCKET).upload(
        path,
        webp,
        file_options={
            # Hyphenated: the Python client ignores the JS spelling `cacheControl`
            # and silently stores `no-cache`. See poster.POSTER_CACHE_CONTROL.
            "content-type": "image/webp",
            "upsert": "true",
            "cache-control": POSTER_CACHE_CONTROL,
        },
    )
    return path


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report work and egress cost, change nothing")
    parser.add_argument("--force", action="store_true", help="re-render lectures that already have a poster")
    parser.add_argument("--lecture-id", help="backfill a single lecture")
    parser.add_argument("--limit", type=int, help="cap the number of lectures processed")
    parser.add_argument("--local-dir", help="source PDFs from this folder by SHA-256 match (zero egress)")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )

    targets = await _fetch_targets(force=args.force, lecture_id=args.lecture_id, limit=args.limit)
    if not targets:
        logger.info("nothing to do -- every lecture already has a poster")
        return 0

    # Group by content address: one download and one render serves every lecture
    # sharing that PDF. The corpus has ~150 lecture objects over ~67 distinct PDFs.
    by_hash: Dict[str, List[dict]] = defaultdict(list)
    for row in targets:
        by_hash[row["pdf_hash"] or f"url:{row['pdf_url']}"].append(row)

    logger.info(
        "%d lecture(s) need a poster across %d distinct PDF(s)",
        len(targets), len(by_hash),
    )

    local_index: Dict[str, Path] = {}
    if args.local_dir:
        local_index = _index_local_pdfs(Path(args.local_dir).expanduser())

    if args.dry_run:
        local_hits = sum(1 for h in by_hash if h in local_index)
        logger.info(
            "DRY RUN: would render %d poster(s); %d PDF(s) available locally (0 egress), "
            "%d would be downloaded from Supabase Storage",
            len(targets), local_hits, len(by_hash) - local_hits,
        )
        for h, rows in list(by_hash.items())[:10]:
            src = "local" if h in local_index else "storage"
            logger.info("  [%s] %s -> %d lecture(s)", src, h[:16], len(rows))
        return 0

    rendered = failed = 0
    downloaded_bytes = 0

    for digest, rows in by_hash.items():
        local = local_index.get(digest)
        if local:
            pdf_bytes = local.read_bytes()
        else:
            pdf_bytes = await asyncio.to_thread(
                _download_pdf, rows[0]["pdf_hash"], rows[0]["pdf_url"]
            )
            if pdf_bytes:
                downloaded_bytes += len(pdf_bytes)

        if not pdf_bytes:
            logger.warning("no PDF bytes for %s -- skipping %d lecture(s)", digest[:16], len(rows))
            failed += len(rows)
            continue

        webp = await asyncio.to_thread(render_poster, pdf_bytes)
        if not webp:
            logger.warning("render failed for %s -- skipping %d lecture(s)", digest[:16], len(rows))
            failed += len(rows)
            continue

        for row in rows:
            try:
                path = await asyncio.to_thread(_upload_poster, row["id"], webp)
                async with await get_db_connection() as conn:
                    await conn.execute(
                        "UPDATE lectures SET poster_url = $1 WHERE id = $2::uuid", path, row["id"]
                    )
                rendered += 1
                logger.info(
                    "poster %s (%.1f KB) <- %s",
                    row["id"][:8], len(webp) / 1024, (row["title"] or "")[:48],
                )
            except Exception as exc:
                logger.warning("poster failed for lecture %s: %s", row["id"], exc)
                failed += 1

    logger.info(
        "done: %d poster(s) written, %d failed, %.1f MB downloaded",
        rendered, failed, downloaded_bytes / 1024 / 1024,
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
