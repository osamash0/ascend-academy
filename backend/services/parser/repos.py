"""asyncpg helpers for parse_runs and parse_pages tables.

All helpers acquire a connection from the shared db_pool; callers never deal
with raw SQL or connection management.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import AsyncIterator, Optional
from uuid import UUID

import backend.core.database as _db
from backend.domain.parse_models import (
    DeckOutline,
    ExtractedPage,
    PageStatus,
    ParsePage,
    ParseRun,
    RunStatus,
    SlideContent,
    PIPELINE_VERSION,
)

logger = logging.getLogger(__name__)


async def _pool():
    # Read the pool live from the core module. Importing the name directly
    # (`from ... import db_pool`) captures a stale ``None`` that never updates
    # after init_db_pool() rebinds the core global, so _pool() would always
    # raise once initialized. This bug was latent because the only caller (v3)
    # is dormant — the unified pipeline (v5) exercises it on every parse.
    if _db.db_pool is None:
        await _db.init_db_pool()
    if _db.db_pool is None:
        raise RuntimeError("Database pool not available — check DATABASE_URL")
    return _db.db_pool


# ── Run-level helpers ────────────────────────────────────────────────────────


async def get_or_create_run(
    pdf_hash: str,
    lecture_id: Optional[UUID],
    pipeline_version: str = PIPELINE_VERSION,
) -> ParseRun:
    """Return an existing run or INSERT a new QUEUED one."""
    pool = await _pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT run_id, pdf_hash, lecture_id, pipeline_version, status,
                   page_count, started_at, finished_at, outline, error
            FROM parse_runs
            WHERE pdf_hash = $1 AND pipeline_version = $2
            """,
            pdf_hash,
            pipeline_version,
        )
        if row:
            return _run_from_row(row)

        row = await conn.fetchrow(
            """
            INSERT INTO parse_runs (pdf_hash, lecture_id, pipeline_version, status)
            VALUES ($1, $2, $3, $4)
            RETURNING run_id, pdf_hash, lecture_id, pipeline_version, status,
                      page_count, started_at, finished_at, outline, error
            """,
            pdf_hash,
            lecture_id,
            pipeline_version,
            RunStatus.QUEUED.value,
        )
        return _run_from_row(row)


async def get_run_by_id(run_id: UUID) -> Optional[ParseRun]:
    pool = await _pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT run_id, pdf_hash, lecture_id, pipeline_version, status,
                   page_count, started_at, finished_at, outline, error
            FROM parse_runs WHERE run_id = $1
            """,
            run_id,
        )
        return _run_from_row(row) if row else None


async def set_status(run_id: UUID, status: RunStatus) -> None:
    pool = await _pool()
    kwargs: dict = {"status": status.value, "run_id": run_id}
    finished_at = datetime.now(timezone.utc) if status in (RunStatus.COMPLETED, RunStatus.FAILED) else None
    async with pool.acquire() as conn:
        if finished_at:
            await conn.execute(
                "UPDATE parse_runs SET status = $1, finished_at = $2 WHERE run_id = $3",
                status.value, finished_at, run_id,
            )
        else:
            await conn.execute(
                "UPDATE parse_runs SET status = $1 WHERE run_id = $2",
                status.value, run_id,
            )


async def set_page_count(run_id: UUID, page_count: int) -> None:
    pool = await _pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE parse_runs SET page_count = $1 WHERE run_id = $2",
            page_count, run_id,
        )


async def set_outline(run_id: UUID, outline: DeckOutline) -> None:
    pool = await _pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE parse_runs SET outline = $1::jsonb WHERE run_id = $2",
            outline.model_dump_json(), run_id,
        )


async def set_error(run_id: UUID, error: str) -> None:
    pool = await _pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE parse_runs SET status = $1, error = $2, finished_at = $3 WHERE run_id = $4",
            RunStatus.FAILED.value, error, datetime.now(timezone.utc), run_id,
        )


# ── Page-level helpers ────────────────────────────────────────────────────────


async def ensure_page_rows(run_id: UUID, page_count: int) -> None:
    """INSERT IGNORE rows for all pages (idempotent)."""
    pool = await _pool()
    async with pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO parse_pages (run_id, page_index, status)
            VALUES ($1, $2, $3)
            ON CONFLICT (run_id, page_index) DO NOTHING
            """,
            [(run_id, i, PageStatus.PENDING.value) for i in range(page_count)],
        )


async def list_pending_pages(run_id: UUID) -> list[int]:
    """Return page indices whose status is still PENDING."""
    pool = await _pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT page_index FROM parse_pages WHERE run_id = $1 AND status = $2 ORDER BY page_index",
            run_id, PageStatus.PENDING.value,
        )
        return [r["page_index"] for r in rows]


async def list_unanalyzed_pages(run_id: UUID) -> list[int]:
    """Return page indices not yet in ANALYZED state."""
    pool = await _pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT page_index FROM parse_pages
            WHERE run_id = $1 AND status != $2
            ORDER BY page_index
            """,
            run_id, PageStatus.ANALYZED.value,
        )
        return [r["page_index"] for r in rows]


async def commit_extract(run_id: UUID, page: ExtractedPage) -> None:
    pool = await _pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE parse_pages
            SET status = $1, route = $2, extract = $3::jsonb, image_url = $4,
                updated_at = now()
            WHERE run_id = $5 AND page_index = $6
            """,
            PageStatus.EXTRACTED.value,
            page.route.value,
            page.model_dump_json(),
            page.image_url,
            run_id,
            page.page_index,
        )


async def commit_content(run_id: UUID, content: SlideContent) -> None:
    pool = await _pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE parse_pages
            SET status = $1, content = $2::jsonb, updated_at = now()
            WHERE run_id = $3 AND page_index = $4
            """,
            PageStatus.ANALYZED.value,
            content.model_dump_json(),
            run_id,
            content.page_index,
        )


async def get_extracted_pages(run_id: UUID) -> list[ExtractedPage]:
    """Return all pages that have been extracted (for stage 2+ input)."""
    pool = await _pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT extract FROM parse_pages
            WHERE run_id = $1 AND extract IS NOT NULL
            ORDER BY page_index
            """,
            run_id,
        )
        result = []
        for r in rows:
            try:
                result.append(ExtractedPage.model_validate_json(r["extract"]))
            except Exception as e:
                logger.warning("Failed to deserialize extract for run %s: %s", run_id, e)
        return result


async def get_completed_pages(run_id: UUID) -> list[SlideContent]:
    """Return all pages with analyzed content (for SSE replay)."""
    pool = await _pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT content FROM parse_pages
            WHERE run_id = $1 AND status = $2 AND content IS NOT NULL
            ORDER BY page_index
            """,
            run_id, PageStatus.ANALYZED.value,
        )
        result = []
        for r in rows:
            try:
                result.append(SlideContent.model_validate_json(r["content"]))
            except Exception as e:
                logger.warning("Failed to deserialize content for run %s: %s", run_id, e)
        return result


async def replay_slides(run_id: UUID) -> AsyncIterator[SlideContent]:
    """Async generator yielding SlideContent for a completed run."""
    for slide in await get_completed_pages(run_id):
        yield slide


# ── Internal helpers ──────────────────────────────────────────────────────────


def _run_from_row(row) -> ParseRun:
    outline_data = row["outline"]
    outline = None
    if outline_data:
        try:
            raw = outline_data if isinstance(outline_data, str) else json.dumps(outline_data)
            outline = DeckOutline.model_validate_json(raw)
        except Exception:
            pass

    return ParseRun(
        run_id=row["run_id"],
        pdf_hash=row["pdf_hash"],
        lecture_id=row["lecture_id"],
        pipeline_version=row["pipeline_version"],
        status=RunStatus(row["status"]),
        page_count=row["page_count"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        outline=outline,
        error=row["error"],
    )
