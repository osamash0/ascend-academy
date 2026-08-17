"""
Repair `Cache-Control` on existing Supabase Storage objects.

Objects uploaded by the Python backend landed with `cache-control: no-cache`,
because storage3 reads the hyphenated `file_options["cache-control"]` key and the
call sites either omitted it or used the JavaScript spelling `cacheControl`
(silently ignored). `no-cache` forbids CDN *and* browser caching outright, so
every view of those objects was a full origin read -- a major contributor to the
egress overage, and one that a stable signed URL alone cannot fix.

Measured on 2026-08-17: 85 of 150 `lecture-pdfs` objects (134 MB) and all 141
`lecture-posters` were stored `no-cache`.

The upload call sites are fixed, so new objects are correct. This script repairs
the existing ones.

WHY IT COSTS EGRESS: Supabase serves Cache-Control from the stored S3 object
metadata, not from `storage.objects.metadata` -- updating that table is cosmetic
and desyncs the row from reality (verified). Setting the real header requires
re-uploading the bytes, and getting the bytes means downloading them. Uploads are
free; the download is the cost. `--local-dir` avoids it for any object whose
content you still have on disk (matched by SHA-256).

READ THIS BEFORE RUNNING IT ON A LARGE BUCKET. Measured on 2026-08-17 after
repairing `lecture-posters`: for **signed-URL reads of a private bucket**,
Supabase sets the response `Expires` from the signed URL's own token lifetime and
does not surface the object's stored `cache-control`. A CDN hit comes from
requesting a byte-identical URL, which is a frontend concern, not an object-
metadata one. So on this project the repair was close to a no-op for the private
buckets -- correct hygiene, but not the fix.

Concretely: do NOT run this over `lecture-pdfs` (134 MB of `no-cache` objects)
expecting an egress win. It would spend 134 MB of the very quota it is meant to
protect for no measured benefit. Run it only where objects are read directly or
from a public bucket.

Usage:
    python -m backend.scripts.fix_storage_cache_control --bucket lecture-posters --dry-run
    python -m backend.scripts.fix_storage_cache_control --bucket lecture-posters
    python -m backend.scripts.fix_storage_cache_control --bucket lecture-pdfs --local-dir ~/Downloads
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import logging
import sys
from pathlib import Path
from typing import Dict, Optional

_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.core.database import get_db_connection, get_client

logger = logging.getLogger("fix_storage_cache_control")

ONE_YEAR = "31536000"

# Only these are safe to declare immutable: content is addressed by hash or by a
# path that is replaced wholesale via upsert.
MIME_BY_BUCKET = {
    "lecture-posters": "image/webp",
    "lecture-pdfs": "application/pdf",
    "pdf-uploads": "application/pdf",
}


async def _objects_needing_fix(bucket: str) -> list[dict]:
    async with await get_db_connection() as conn:
        rows = await conn.fetch(
            """
            SELECT name, (metadata->>'size')::bigint AS size,
                   metadata->>'cacheControl' AS cache_control
            FROM storage.objects
            WHERE bucket_id = $1
              AND coalesce(metadata->>'cacheControl','') <> $2
            ORDER BY (metadata->>'size')::bigint ASC NULLS LAST
            """,
            bucket,
            f"max-age={ONE_YEAR}",
        )
    return [dict(r) for r in rows]


def _index_local(local_dir: Path) -> Dict[str, Path]:
    index: Dict[str, Path] = {}
    for path in local_dir.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in {".pdf", ".webp"}:
            continue
        try:
            index.setdefault(hashlib.sha256(path.read_bytes()).hexdigest(), path)
        except Exception:
            pass
    logger.info("indexed %d distinct local files from %s", len(index), local_dir)
    return index


def _reupload(bucket: str, name: str, data: bytes, mime: str) -> None:
    sb = get_client(use_admin=True)
    sb.storage.from_(bucket).upload(
        name,
        data,
        file_options={
            "content-type": mime,
            "upsert": "true",
            # Hyphenated -- the JS spelling `cacheControl` is ignored here.
            "cache-control": ONE_YEAR,
        },
    )


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bucket", required=True, choices=sorted(MIME_BY_BUCKET))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--local-dir", help="source bytes locally by SHA-256 to avoid egress")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    targets = await _objects_needing_fix(args.bucket)
    if args.limit:
        targets = targets[: args.limit]
    if not targets:
        logger.info("%s: every object already has max-age=%s", args.bucket, ONE_YEAR)
        return 0

    total = sum(t["size"] or 0 for t in targets)
    logger.info(
        "%s: %d object(s) to repair, %.1f MB of bytes to move",
        args.bucket, len(targets), total / 1024 / 1024,
    )
    if args.dry_run:
        for t in targets[:10]:
            logger.info("  %s  %s  %.0f KB", t["cache_control"], t["name"][:60], (t["size"] or 0) / 1024)
        logger.info("DRY RUN: nothing changed")
        return 0

    local = _index_local(Path(args.local_dir).expanduser()) if args.local_dir else {}
    mime = MIME_BY_BUCKET[args.bucket]
    sb = get_client(use_admin=True)

    fixed = failed = 0
    downloaded = 0
    for t in targets:
        name = t["name"]
        try:
            data: Optional[bytes] = None
            # Content-addressed buckets let us match local bytes by name.
            digest = Path(name).stem
            if digest in local:
                data = local[digest].read_bytes()
            if data is None:
                data = await asyncio.to_thread(sb.storage.from_(args.bucket).download, name)
                downloaded += len(data)
            await asyncio.to_thread(_reupload, args.bucket, name, data, mime)
            fixed += 1
            if fixed % 20 == 0:
                logger.info("  %d/%d repaired", fixed, len(targets))
        except Exception as exc:
            logger.warning("failed for %s: %s", name, exc)
            failed += 1

    logger.info(
        "done: %d repaired, %d failed, %.1f MB downloaded",
        fixed, failed, downloaded / 1024 / 1024,
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
