"""Parser v3 typed domain models.

Mirrors §4 of `project_docs/parser_v3_architecture.md`. These Pydantic v2
models are the single validated contract every later stage (orchestrator,
extractor, planner, embedder, tutor) uses to talk to the parser_v3 schema
introduced in `supabase/migrations/20260503000008_parser_v3_schema.sql`.

This module is the typed contract layer only — no app code is wired here.

Mapping to database column shapes:

    parse_runs row     ↔  ParseRun
    parse_pages row    ↔  ParsePage
    slide_chunks row   ↔  SlideChunk
    tutor_messages row ↔  TutorMessage

JSONB sub-documents live as nested models so the orchestrator never deals in
``dict[str, Any]``:

    parse_runs.outline    ↔  DeckOutline
    parse_pages.extract   ↔  ExtractedPage
    parse_pages.content   ↔  SlideContent
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field


PIPELINE_VERSION = "3"


# ── Enums ───────────────────────────────────────────────────────────────────


class SlideRoute(str, Enum):
    """Routing decision for one slide. Stored in `parse_pages.route`."""

    TITLE = "title"
    TEXT = "text"
    VISION = "vision"
    MIXED = "mixed"
    METADATA = "metadata"


class PageStatus(str, Enum):
    """State machine for `parse_pages.status` (per-page checkpoint, P2)."""

    PENDING = "pending"
    EXTRACTED = "extracted"
    ANALYZED = "analyzed"
    FAILED = "failed"


class RunStatus(str, Enum):
    """State machine for `parse_runs.status` (whole-deck pipeline state)."""

    QUEUED = "queued"
    EXTRACTING = "extracting"
    OUTLINING = "outlining"
    ANALYZING = "analyzing"
    EMBEDDING = "embedding"
    FINALIZING = "finalizing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TutorRole(str, Enum):
    """Mirrors the CHECK constraint on `tutor_messages.role`."""

    STUDENT = "student"
    TUTOR = "tutor"


# ── Stage 3 output: per-page extraction (parse_pages.extract jsonb) ─────────


class ExtractedPage(BaseModel):
    """Cheap, deterministic page features written before any LLM call."""

    page_index: int
    text: str
    word_count: int
    has_vector_drawings: bool
    image_count: int
    table_count: int
    image_url: Optional[str] = None
    route: SlideRoute


# ── Stage 4 output: deck outline (parse_runs.outline jsonb) ─────────────────


class OutlineSection(BaseModel):
    title: str
    page_indices: list[int]
    summary: str


class DeckOutline(BaseModel):
    """Single-call narrative pre-pass result; primes per-slide prompts."""

    course_topic: str
    sections: list[OutlineSection]
    glossary: dict[str, str] = Field(default_factory=dict)


# ── Stage 5 output: slide AI result (parse_pages.content jsonb) ─────────────


class QuizQuestion(BaseModel):
    question: str
    options: list[str] = Field(min_length=4, max_length=4)
    answer: Literal["A", "B", "C", "D"]
    explanation: str
    concept: str
    cognitive_level: Literal["recall", "apply", "analyze", "evaluate"]
    linked_slides: list[int] = Field(default_factory=list)


class SlideMeta(BaseModel):
    """Telemetry block attached to every analyzed slide (P7: pipeline_version)."""

    pipeline_version: str = PIPELINE_VERSION
    word_count: int
    vision_used: bool
    tokens_input: int
    tokens_output: int
    model: str
    latency_ms: int
    retried: int = 0


class SlideContent(BaseModel):
    page_index: int
    title: str
    markdown: str
    summary: str
    questions: list[QuizQuestion]
    is_metadata: bool
    route: SlideRoute
    parse_error: Optional[str] = None
    meta: SlideMeta


# ── Database row models ─────────────────────────────────────────────────────


class ParseRun(BaseModel):
    """One row of `public.parse_runs` — the run-level state machine."""

    run_id: UUID
    pdf_hash: str
    lecture_id: Optional[UUID] = None
    pipeline_version: str
    status: RunStatus
    page_count: Optional[int] = None
    started_at: datetime
    finished_at: Optional[datetime] = None
    outline: Optional[DeckOutline] = None
    error: Optional[str] = None


class ParsePage(BaseModel):
    """One row of `public.parse_pages` — per-page checkpoint (P2)."""

    run_id: UUID
    page_index: int
    status: PageStatus
    route: Optional[SlideRoute] = None
    extract: Optional[ExtractedPage] = None
    content: Optional[SlideContent] = None
    image_url: Optional[str] = None
    error: Optional[str] = None
    updated_at: datetime


class SlideChunk(BaseModel):
    """One row of `public.slide_chunks` — tutor grounding store (P5).

    `id` is `None` until the row is INSERTed and the BIGSERIAL is returned.
    `embedding` is `None` until Stage 6 (FastEmbed bge-small, 384-d) writes it.
    """

    id: Optional[int] = None
    lecture_id: UUID
    page_index: int
    chunk_index: int
    text: str
    section: Optional[str] = None
    embedding: Optional[list[float]] = None
    pipeline_version: str = PIPELINE_VERSION


class TutorMessage(BaseModel):
    """One row of `public.tutor_messages` — Socratic tutor conversation log."""

    id: Optional[int] = None
    lecture_id: UUID
    user_id: UUID
    role: TutorRole
    content: str
    cited_pages: list[int] = Field(default_factory=list)
    created_at: Optional[datetime] = None
