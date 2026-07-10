"""Stage 4 — Embedding slide chunks.

Uses FastEmbed (ONNX, runs in-process, no API quota) to embed chunks of
slide markdown text into 384-d vectors stored in slide_chunks.

Chunking strategy: split slide markdown into segments of ≤ 400 tokens
(approx. 300 words) so each chunk is small enough for the tutor retrieval
to be precise.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional
from uuid import UUID

from backend.core.database import db_pool, init_db_pool
from backend.domain.parse_models import PIPELINE_VERSION, SlideContent

logger = logging.getLogger(__name__)

_CHUNK_MAX_WORDS = 300
_EMBED_BATCH_SIZE = 64


def _split_chunks(markdown: str) -> list[str]:
    """Split markdown into word-count-bounded chunks."""
    words = markdown.split()
    if not words:
        return []
    chunks: list[str] = []
    current: list[str] = []
    for word in words:
        current.append(word)
        if len(current) >= _CHUNK_MAX_WORDS:
            chunks.append(" ".join(current))
            current = []
    if current:
        chunks.append(" ".join(current))
    return chunks


async def _get_pool():
    global db_pool
    if db_pool is None:
        await init_db_pool()
    if db_pool is None:
        raise RuntimeError("Database pool unavailable — check DATABASE_URL")
    return db_pool


async def embed(
    lecture_id: UUID,
    run_id: UUID,
    slides: list[SlideContent],
    *,
    emit,
) -> None:
    """Stage 4 entry point.

    Loads FastEmbed model (cached after first call), embeds all slide chunks
    in batches, and upserts into slide_chunks via asyncpg.

    Args:
        lecture_id: Lecture this run belongs to.
        run_id: Current parse run (for logging).
        slides: Stage 3 results (only content slides are embedded).
        emit: Async callable for SSE events.
    """
    content_slides = [s for s in slides if not s.is_metadata and s.markdown.strip()]
    if not content_slides:
        logger.info("Run %s: no content slides to embed", run_id)
        return

    # Build (text, lecture_id, page_index, chunk_index, section) tuples
    chunk_rows: list[tuple] = []
    for slide in content_slides:
        chunks = _split_chunks(slide.markdown)
        for ci, text in enumerate(chunks):
            chunk_rows.append((text, lecture_id, slide.page_index, ci))

    if not chunk_rows:
        return

    # Embed all texts in one FastEmbed call (runs in thread)
    texts = [row[0] for row in chunk_rows]
    embeddings: Optional[list[list[float]]] = await asyncio.to_thread(_embed_texts, texts)

    if embeddings is None:
        logger.warning("Run %s: FastEmbed unavailable, skipping embeddings", run_id)
        return

    pool = await _get_pool()
    async with pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO slide_chunks (lecture_id, page_index, chunk_index, text, embedding, pipeline_version)
            VALUES ($1, $2, $3, $4, $5::vector, $6)
            ON CONFLICT (lecture_id, page_index, chunk_index, pipeline_version)
            DO UPDATE SET text = EXCLUDED.text, embedding = EXCLUDED.embedding
            """,
            [
                (
                    row[1],        # lecture_id
                    row[2],        # page_index
                    row[3],        # chunk_index
                    row[0],        # text
                    embeddings[i], # embedding (list[float])
                    PIPELINE_VERSION,
                )
                for i, row in enumerate(chunk_rows)
            ],
        )

    logger.info("Run %s: embedded %d chunks across %d slides", run_id, len(chunk_rows), len(content_slides))
    await emit("embedding_done", {"chunks": len(chunk_rows), "slides": len(content_slides)})


def _embed_texts(texts: list[str]) -> Optional[list[list[float]]]:
    """Synchronous FastEmbed encoding — called inside asyncio.to_thread."""
    try:
        from fastembed import TextEmbedding
        model = _get_embed_model()
        embeddings = list(model.embed(texts, batch_size=_EMBED_BATCH_SIZE))
        return [e.tolist() for e in embeddings]
    except Exception as e:
        logger.warning("FastEmbed error: %s", e)
        return None


_embed_model_cache = None


def _get_embed_model():
    global _embed_model_cache
    if _embed_model_cache is None:
        from fastembed import TextEmbedding
        _embed_model_cache = TextEmbedding("BAAI/bge-small-en-v1.5")
    return _embed_model_cache
