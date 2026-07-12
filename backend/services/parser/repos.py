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
    *,
    batch_id: Optional[UUID] = None,
    user_id: Optional[UUID] = None,
    course_id: Optional[UUID] = None,
    filename: Optional[str] = None,
    parsing_mode: Optional[str] = None,
) -> ParseRun:
    """Return the run for (pdf_hash, pipeline_version), creating it if needed.

    Upserts on the existing UNIQUE(pdf_hash, pipeline_version) constraint:
    re-enqueuing byte-identical PDF content (e.g. the same file uploaded in a
    later batch) updates batch_id/user_id/course_id/filename/parsing_mode to
    the new values rather than silently keeping the first caller's — "last
    batch touching this hash wins" is made explicit instead of a latent
    surprise. All five use COALESCE so a call that doesn't know a value (e.g.
    the orchestrator's own internal re-fetch, which doesn't pass batch_id)
    never clobbers a value an earlier call already recorded — only an
    explicit new value overwrites. Known v1 sharp edge: this is not scoped by
    user_id, so two different professors uploading the same PDF share one run
    row — accepted for now, a candidate to scope by user_id in a fast-follow.
    """
    pool = await _pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO parse_runs (pdf_hash, lecture_id, pipeline_version, status,
                                     batch_id, user_id, course_id, filename, parsing_mode)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (pdf_hash, pipeline_version) DO UPDATE
                SET batch_id = COALESCE(EXCLUDED.batch_id, parse_runs.batch_id),
                    user_id = COALESCE(EXCLUDED.user_id, parse_runs.user_id),
                    course_id = COALESCE(EXCLUDED.course_id, parse_runs.course_id),
                    filename = COALESCE(EXCLUDED.filename, parse_runs.filename),
                    parsing_mode = COALESCE(EXCLUDED.parsing_mode, parse_runs.parsing_mode)
            RETURNING run_id, pdf_hash, lecture_id, pipeline_version, status,
                      page_count, started_at, finished_at, outline, error,
                      batch_id, user_id, course_id, filename, parsing_mode
            """,
            pdf_hash,
            lecture_id,
            pipeline_version,
            RunStatus.QUEUED.value,
            batch_id,
            user_id,
            course_id,
            filename,
            parsing_mode,
        )
        return _run_from_row(row)


async def get_run_by_id(run_id: UUID) -> Optional[ParseRun]:
    pool = await _pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT run_id, pdf_hash, lecture_id, pipeline_version, status,
                   page_count, started_at, finished_at, outline, error,
                   batch_id, user_id, course_id, filename, parsing_mode
            FROM parse_runs WHERE run_id = $1
            """,
            run_id,
        )
        return _run_from_row(row) if row else None


async def list_runs_by_user(
    user_id: UUID, batch_id: Optional[UUID] = None, limit: int = 100,
) -> list[ParseRun]:
    """Runs for the uploads UI: either every run in one batch, or — when
    batch_id is omitted — every non-terminal run plus anything that finished
    in the last 24h (recent-enough to still be worth showing/toasting)."""
    pool = await _pool()
    async with pool.acquire() as conn:
        if batch_id:
            rows = await conn.fetch(
                """
                SELECT run_id, pdf_hash, lecture_id, pipeline_version, status,
                       page_count, started_at, finished_at, outline, error,
                       batch_id, user_id, course_id, filename, parsing_mode
                FROM parse_runs WHERE user_id = $1 AND batch_id = $2
                ORDER BY started_at DESC
                """,
                user_id, batch_id,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT run_id, pdf_hash, lecture_id, pipeline_version, status,
                       page_count, started_at, finished_at, outline, error,
                       batch_id, user_id, course_id, filename, parsing_mode
                FROM parse_runs
                WHERE user_id = $1
                  AND (status NOT IN ('completed', 'failed', 'cancelled')
                       OR finished_at > now() - interval '24 hours')
                ORDER BY started_at DESC LIMIT $2
                """,
                user_id, limit,
            )
        return [_run_from_row(r) for r in rows]


async def get_batch_summary(batch_id: UUID, user_id: UUID) -> list[dict]:
    """Per-lecture rollup for the Phase-1 batch review screen: one row per
    parse_runs entry in the batch, with slide/quiz/flagged counts joined from
    the lecture it produced (if any yet). "Flagged" combines two distinct
    signals: a slide still awaiting AI enhancement (Skip-AI import), and the
    Roadmap Phase 5.1 persisted `needs_review` flag (synthesis failure, vision
    rescue, or empty output) — replacing the old query-time
    empty-summary heuristic now that a real signal is computed and stored at
    synthesis time."""
    pool = await _pool()
    async with pool.acquire() as conn:
        run_rows = await conn.fetch(
            """
            SELECT run_id, pdf_hash, lecture_id, status, error, filename, finished_at
            FROM parse_runs WHERE batch_id = $1 AND user_id = $2
            ORDER BY started_at
            """,
            batch_id, user_id,
        )
        lecture_ids = [r["lecture_id"] for r in run_rows if r["lecture_id"]]
        counts: dict = {}
        lectures: dict = {}
        if lecture_ids:
            agg_rows = await conn.fetch(
                """
                SELECT s.lecture_id,
                       COUNT(*) AS slide_count,
                       COUNT(*) FILTER (
                           WHERE s.ai_enhanced = false OR s.needs_review = true
                       ) AS flagged_count,
                       (SELECT COUNT(*) FROM quiz_questions q
                          JOIN slides s2 ON s2.id = q.slide_id
                         WHERE s2.lecture_id = s.lecture_id) AS quiz_count
                FROM slides s WHERE s.lecture_id = ANY($1::uuid[])
                GROUP BY s.lecture_id
                """,
                lecture_ids,
            )
            counts = {r["lecture_id"]: dict(r) for r in agg_rows}
            lecture_rows = await conn.fetch(
                "SELECT id, title, description FROM lectures WHERE id = ANY($1::uuid[])",
                lecture_ids,
            )
            lectures = {r["id"]: r for r in lecture_rows}

        out = []
        for r in run_rows:
            c = counts.get(r["lecture_id"], {})
            lec = lectures.get(r["lecture_id"])
            out.append({
                "run_id": r["run_id"],
                "status": r["status"],
                "error": r["error"],
                "filename": r["filename"],
                "lecture_id": r["lecture_id"],
                "title": (lec["title"] if lec else None) or r["filename"],
                "deck_summary": lec["description"] if lec else None,
                "slide_count": c.get("slide_count", 0),
                "quiz_count": c.get("quiz_count", 0),
                "flagged_count": c.get("flagged_count", 0),
            })
        return out


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
        batch_id=row["batch_id"] if "batch_id" in row.keys() else None,
        user_id=row["user_id"] if "user_id" in row.keys() else None,
        course_id=row["course_id"] if "course_id" in row.keys() else None,
        filename=row["filename"] if "filename" in row.keys() else None,
        parsing_mode=row["parsing_mode"] if "parsing_mode" in row.keys() else None,
    )
