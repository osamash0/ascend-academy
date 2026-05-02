"""
Backfill `slide_embeddings` for lectures parsed before grounded-tutor existed.

Older lectures have rows in `slide_parse_cache` (the per-slide checkpoint cache
written during parsing) but no rows in `slide_embeddings`, so the AI tutor's
retrieval step returns nothing and the model refuses to answer.

This script walks `slide_parse_cache`, finds every (pdf_hash, slide_index)
that doesn't yet have an embedding at the current pipeline_version, runs
the same embed-text → generate_embeddings → store_slide_embedding pipeline
that `_safe_embedding_task` uses during parsing, and finally attaches
`lecture_id` on the new embedding rows for any lecture whose pdf_hash
matches.

Idempotent: `store_slide_embedding` does delete-then-insert keyed on
(pdf_hash, slide_index, pipeline_version), so re-running the script is safe
and `--force` is provided for an explicit re-embed.

Usage:
    python -m backend.scripts.backfill_slide_embeddings
    python -m backend.scripts.backfill_slide_embeddings --pdf-hash <hash>
    python -m backend.scripts.backfill_slide_embeddings --dry-run
    python -m backend.scripts.backfill_slide_embeddings --force --limit 5
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import logging
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

# Make `backend.*` importable when run as a script outside the package.
_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.core.database import supabase_admin
from backend.services.ai.embeddings import generate_embeddings
from backend.services.cache import (
    attach_lecture_id_to_embeddings,
    store_slide_embedding,
)
from backend.services.file_parse_service import (
    PIPELINE_VERSION,
    _build_embedding_text,
)

logger = logging.getLogger(__name__)

# PostgREST defaults to a 1000-row response cap.  Pick a page size strictly
# below that so a `.range()` window is never silently truncated.
PAGE_SIZE = 500


def _paginated_select(
    table: str,
    columns: str,
    eq_filters: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Read every row matching `eq_filters`, walking PostgREST in pages.

    PostgREST returns at most ~1000 rows per request unless `Range` is set;
    a one-shot `.execute()` would silently drop the rest of a large legacy
    backlog, which is exactly the data this script needs to find.

    Raises on read failure rather than returning a partial result — callers
    catch and record the failure into BackfillStats so the script exits
    non-zero instead of silently completing with missing rows.
    """
    all_rows: List[Dict[str, Any]] = []
    start = 0
    while True:
        q = supabase_admin.table(table).select(columns)
        for col, val in eq_filters.items():
            q = q.eq(col, val)
        end = start + PAGE_SIZE - 1
        res = q.range(start, end).execute()
        batch = res.data or []
        all_rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    return all_rows


@dataclass
class BackfillStats:
    pdf_hashes_seen: int = 0
    slides_seen: int = 0
    slides_skipped_metadata: int = 0
    slides_skipped_no_text: int = 0
    slides_already_embedded: int = 0
    slides_embedded: int = 0
    slides_failed: int = 0
    lectures_linked: int = 0
    failures: List[str] = field(default_factory=list)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "pdf_hashes_seen": self.pdf_hashes_seen,
            "slides_seen": self.slides_seen,
            "slides_skipped_metadata": self.slides_skipped_metadata,
            "slides_skipped_no_text": self.slides_skipped_no_text,
            "slides_already_embedded": self.slides_already_embedded,
            "slides_embedded": self.slides_embedded,
            "slides_failed": self.slides_failed,
            "lectures_linked": self.lectures_linked,
        }


def _is_metadata_slide(slide: Dict[str, Any]) -> bool:
    """Mirror the skip-condition used by `_safe_embedding_task`."""
    return bool(slide.get("is_metadata") or slide.get("slide_type") == "metadata")


def _list_pdf_hashes(
    pipeline_version: str, stats: Optional["BackfillStats"] = None
) -> List[str]:
    """Return distinct pdf_hashes that have at least one cached slide."""
    try:
        rows = _paginated_select(
            "slide_parse_cache",
            "pdf_hash",
            {"pipeline_version": pipeline_version},
        )
    except Exception as e:
        logger.error("Failed to list pdf_hashes: %s", e)
        if stats is not None:
            stats.failures.append(f"list_pdf_hashes failed: {e}")
        return []
    seen: Set[str] = set()
    ordered: List[str] = []
    for row in rows:
        h = row.get("pdf_hash")
        if h and h not in seen:
            seen.add(h)
            ordered.append(h)
    return ordered


def _load_cached_slides(
    pdf_hash: str,
    pipeline_version: str,
    stats: Optional["BackfillStats"] = None,
) -> Optional[Dict[int, Dict[str, Any]]]:
    """Return {slide_index: slide_data} for one pdf_hash, or None on read failure."""
    try:
        rows = _paginated_select(
            "slide_parse_cache",
            "slide_index,slide_data",
            {"pdf_hash": pdf_hash, "pipeline_version": pipeline_version},
        )
    except Exception as e:
        logger.error("Failed to load slides for %s: %s", pdf_hash, e)
        if stats is not None:
            stats.failures.append(f"{pdf_hash}: load_cached_slides failed: {e}")
        return None
    return {
        int(row["slide_index"]): row.get("slide_data") or {}
        for row in rows
        if row.get("slide_index") is not None
    }


def _existing_embedding_indices(
    pdf_hash: str,
    pipeline_version: str,
    stats: Optional["BackfillStats"] = None,
) -> Optional[Set[int]]:
    """Return slide indices already embedded for one pdf_hash, or None on read failure."""
    try:
        rows = _paginated_select(
            "slide_embeddings",
            "slide_index",
            {"pdf_hash": pdf_hash, "pipeline_version": pipeline_version},
        )
    except Exception as e:
        logger.warning("Failed to read existing embeddings for %s: %s", pdf_hash, e)
        if stats is not None:
            stats.failures.append(f"{pdf_hash}: existing_embedding_indices failed: {e}")
        return None
    return {
        int(row["slide_index"])
        for row in rows
        if row.get("slide_index") is not None
    }


def _hashes_with_any_embedding(
    pipeline_version: str, stats: Optional["BackfillStats"] = None
) -> Optional[Set[str]]:
    """Single-shot lookup of every pdf_hash that already has ≥1 embedding.

    Used as a fast-path so the common case — legacy lectures with zero
    embedding rows — skips the per-hash `_existing_embedding_indices`
    query entirely.  Returns None on read failure so callers can fall
    back to the safe per-hash path instead of assuming "no embeddings".
    """
    try:
        rows = _paginated_select(
            "slide_embeddings",
            "pdf_hash",
            {"pipeline_version": pipeline_version},
        )
    except Exception as e:
        logger.warning("Pre-fetch of embedded hashes failed: %s", e)
        if stats is not None:
            stats.failures.append(f"hashes_with_any_embedding failed: {e}")
        return None
    return {row["pdf_hash"] for row in rows if row.get("pdf_hash")}


def _lecture_ids_for_pdf_hash(pdf_hash: str) -> List[str]:
    """Look up lecture rows whose pdf_hash matches (column added in 20260503000006)."""
    try:
        res = (
            supabase_admin.table("lectures")
            .select("id")
            .eq("pdf_hash", pdf_hash)
            .execute()
        )
    except Exception as e:
        logger.debug("Lecture lookup for %s failed: %s", pdf_hash, e)
        return []
    return [row["id"] for row in (res.data or []) if row.get("id")]


async def _embed_one_slide(
    pdf_hash: str,
    slide_index: int,
    slide: Dict[str, Any],
    pipeline_version: str,
    dry_run: bool,
    stats: BackfillStats,
) -> None:
    """Embed and persist one slide.  Mirrors `_safe_embedding_task` exactly."""
    if _is_metadata_slide(slide):
        stats.slides_skipped_metadata += 1
        return

    text = _build_embedding_text(slide)
    if not text:
        stats.slides_skipped_no_text += 1
        return

    try:
        embedding = await generate_embeddings(text)
    except Exception as e:
        stats.slides_failed += 1
        stats.failures.append(f"{pdf_hash}/{slide_index}: embed: {e}")
        logger.error("Embedding failed for %s/%d: %s", pdf_hash, slide_index, e)
        return

    if not embedding:
        stats.slides_failed += 1
        stats.failures.append(f"{pdf_hash}/{slide_index}: empty embedding")
        return

    if dry_run:
        stats.slides_embedded += 1
        return

    content_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
    meta = slide.get("_meta", {}) or {}
    metadata = {
        "slide_type": slide.get("slide_type"),
        "engine": meta.get("engine"),
        "has_math": meta.get("has_math", False),
        "title": slide.get("title"),
    }

    try:
        ok = await store_slide_embedding(
            lecture_id=None,
            slide_index=slide_index,
            embedding=embedding,
            metadata=metadata,
            content_hash=content_hash,
            pdf_hash=pdf_hash,
            pipeline_version=pipeline_version,
        )
    except Exception as e:
        stats.slides_failed += 1
        stats.failures.append(f"{pdf_hash}/{slide_index}: store: {e}")
        logger.error("Store failed for %s/%d: %s", pdf_hash, slide_index, e)
        return

    # store_slide_embedding swallows DB errors and returns False so the
    # parser's fire-and-forget callers don't crash; here we surface that.
    if ok:
        stats.slides_embedded += 1
    else:
        stats.slides_failed += 1
        stats.failures.append(f"{pdf_hash}/{slide_index}: store returned False")


async def _backfill_one_pdf(
    pdf_hash: str,
    *,
    pipeline_version: str,
    force: bool,
    dry_run: bool,
    stats: BackfillStats,
    has_any_embedding: Optional[bool] = None,
) -> None:
    cached = _load_cached_slides(pdf_hash, pipeline_version, stats)
    if cached is None:
        # Read failed; the failure was already recorded in stats.  Skip
        # the lecture-attach step too — we don't know what we'd be
        # attaching to.
        return
    if not cached:
        return

    if force:
        existing: Set[int] = set()
    elif has_any_embedding is False:
        # Common case: legacy lecture with zero embedding rows — skip
        # the per-hash existing-indices query entirely.
        existing = set()
    else:
        loaded = _existing_embedding_indices(pdf_hash, pipeline_version, stats)
        if loaded is None:
            # Don't risk re-embedding everything (and racing the parser)
            # when we can't tell what's already there.
            return
        existing = loaded

    for slide_index in sorted(cached):
        stats.slides_seen += 1
        if slide_index in existing:
            stats.slides_already_embedded += 1
            continue
        await _embed_one_slide(
            pdf_hash,
            slide_index,
            cached[slide_index],
            pipeline_version,
            dry_run,
            stats,
        )

    if dry_run:
        return

    for lecture_id in _lecture_ids_for_pdf_hash(pdf_hash):
        try:
            updated = await attach_lecture_id_to_embeddings(pdf_hash, lecture_id)
        except Exception as e:
            stats.failures.append(f"{pdf_hash} attach {lecture_id}: {e}")
            logger.error("attach_lecture_id failed for %s/%s: %s", pdf_hash, lecture_id, e)
            continue
        # attach_lecture_id_to_embeddings returns the row count it updated
        # (0 on failure or when no rows matched).  Only count a real link.
        if updated:
            stats.lectures_linked += 1
        else:
            stats.failures.append(
                f"{pdf_hash} attach {lecture_id}: 0 rows updated"
            )


async def backfill(
    *,
    pdf_hash: Optional[str] = None,
    pipeline_version: str = PIPELINE_VERSION,
    force: bool = False,
    dry_run: bool = False,
    limit: Optional[int] = None,
) -> BackfillStats:
    """Run the backfill.  Returns counts so callers (and tests) can assert."""
    stats = BackfillStats()

    if pdf_hash:
        hashes = [pdf_hash]
    else:
        hashes = _list_pdf_hashes(pipeline_version, stats)

    if limit is not None:
        hashes = hashes[:limit]

    # Pre-compute which hashes already have any embeddings so the common
    # "fully-missing legacy lecture" case skips a per-hash read.  Falls
    # back to the safe per-hash path on lookup failure.
    embedded_hashes: Optional[Set[str]] = None
    if hashes and not force:
        embedded_hashes = _hashes_with_any_embedding(pipeline_version, stats)

    for h in hashes:
        stats.pdf_hashes_seen += 1
        has_any = (
            None if embedded_hashes is None else (h in embedded_hashes)
        )
        await _backfill_one_pdf(
            h,
            pipeline_version=pipeline_version,
            force=force,
            dry_run=dry_run,
            stats=stats,
            has_any_embedding=has_any,
        )

    return stats


def _parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Backfill slide_embeddings for legacy lectures."
    )
    p.add_argument("--pdf-hash", help="Restrict to a single pdf_hash.")
    p.add_argument(
        "--pipeline-version",
        default=PIPELINE_VERSION,
        help=f"Pipeline version to backfill (default: {PIPELINE_VERSION}).",
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="Re-embed slides even if an embedding row already exists.",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute embeddings but do not write to Supabase.",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process at most N pdf_hashes (useful for smoke tests).",
    )
    return p.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    args = _parse_args(argv)

    stats = asyncio.run(
        backfill(
            pdf_hash=args.pdf_hash,
            pipeline_version=args.pipeline_version,
            force=args.force,
            dry_run=args.dry_run,
            limit=args.limit,
        )
    )

    print("Backfill summary:")
    for k, v in stats.as_dict().items():
        print(f"  {k}: {v}")
    if stats.failures:
        print(f"\nFirst {min(10, len(stats.failures))} failures:")
        for line in stats.failures[:10]:
            print(f"  - {line}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
