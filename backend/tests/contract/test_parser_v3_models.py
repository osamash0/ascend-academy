"""Round-trip contract tests for parser v3 typed domain models.

These freeze the wire shape between the parser_v3 schema
(`supabase/migrations/20260503000008_parser_v3_schema.sql`) and the Pydantic
models in `backend/domain/parse_models.py`. Every test seeds a row exactly as
psycopg / supabase-py would hand it back from a `SELECT *` (UUIDs as `UUID`,
timestamps as aware `datetime`, JSONB as `dict`, INT[] as `list[int]`,
pgvector as `list[float]`), validates it into the typed model, dumps it back
with `model_dump(mode="json")`, and asserts a round-trip equality.

A failure here means an upstream reader/writer would silently corrupt rows.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from backend.domain.parse_models import (
    PIPELINE_VERSION,
    DeckOutline,
    ExtractedPage,
    OutlineSection,
    PageStatus,
    ParsePage,
    ParseRun,
    QuizQuestion,
    RunStatus,
    SlideChunk,
    SlideContent,
    SlideMeta,
    SlideRoute,
    TutorMessage,
    TutorRole,
)


pytestmark = pytest.mark.contract


# ── Helpers ─────────────────────────────────────────────────────────────────


def _outline_dict() -> dict:
    return {
        "course_topic": "Intro to ML",
        "sections": [
            {"title": "Setup", "page_indices": [0, 1], "summary": "Basics."},
            {"title": "k-NN", "page_indices": [2, 3, 4], "summary": "Distance."},
        ],
        "glossary": {"k-NN": "k-Nearest Neighbours"},
    }


def _extract_dict(idx: int = 0) -> dict:
    return {
        "page_index": idx,
        "text": "hello world",
        "word_count": 2,
        "has_vector_drawings": False,
        "image_count": 0,
        "table_count": 0,
        "image_url": None,
        "route": "text",
    }


def _content_dict(idx: int = 0) -> dict:
    return {
        "page_index": idx,
        "title": "Slide 1",
        "markdown": "# Hi",
        "summary": "Says hi.",
        "questions": [
            {
                "question": "What does the slide say?",
                "options": ["hi", "bye", "yo", "sup"],
                "answer": "A",
                "explanation": "It says hi.",
                "concept": "greetings",
                "cognitive_level": "recall",
                "linked_slides": [],
            }
        ],
        "is_metadata": False,
        "route": "text",
        "parse_error": None,
        "meta": {
            "pipeline_version": PIPELINE_VERSION,
            "word_count": 2,
            "vision_used": False,
            "tokens_input": 100,
            "tokens_output": 80,
            "model": "gemini-1.5-flash",
            "latency_ms": 532,
            "retried": 0,
        },
    }


# ── Enums pin the exact spec values ─────────────────────────────────────────


class TestEnums:
    def test_run_status_values(self):
        assert {s.value for s in RunStatus} == {
            "queued",
            "extracting",
            "outlining",
            "analyzing",
            "embedding",
            "finalizing",
            "completed",
            "failed",
            "cancelled",
        }

    def test_page_status_values(self):
        assert {s.value for s in PageStatus} == {
            "pending",
            "extracted",
            "analyzed",
            "failed",
        }

    def test_slide_route_values(self):
        assert {s.value for s in SlideRoute} == {
            "title",
            "text",
            "vision",
            "mixed",
            "metadata",
        }

    def test_tutor_role_matches_db_check_constraint(self):
        # tutor_messages.role CHECK is ('student','tutor'); these must agree.
        assert {r.value for r in TutorRole} == {"student", "tutor"}


# ── ParseRun ────────────────────────────────────────────────────────────────


class TestParseRunRoundTrip:
    def test_full_row_with_outline_jsonb(self):
        run_id = uuid4()
        lecture_id = uuid4()
        started = datetime(2026, 5, 3, 12, 0, tzinfo=timezone.utc)
        finished = datetime(2026, 5, 3, 12, 30, tzinfo=timezone.utc)

        # Shape psycopg / supabase-py returns from `SELECT * FROM parse_runs`.
        row = {
            "run_id": run_id,
            "pdf_hash": "abc123",
            "lecture_id": lecture_id,
            "pipeline_version": PIPELINE_VERSION,
            "status": "completed",
            "page_count": 42,
            "started_at": started,
            "finished_at": finished,
            "outline": _outline_dict(),
            "error": None,
        }

        run = ParseRun.model_validate(row)
        assert run.status is RunStatus.COMPLETED
        assert isinstance(run.outline, DeckOutline)
        assert run.outline.sections[1].page_indices == [2, 3, 4]
        assert run.outline.glossary["k-NN"] == "k-Nearest Neighbours"

        dumped = run.model_dump(mode="json")
        assert dumped["status"] == "completed"
        assert dumped["run_id"] == str(run_id)
        assert dumped["lecture_id"] == str(lecture_id)
        assert isinstance(dumped["started_at"], str)
        assert dumped["outline"]["sections"][0]["title"] == "Setup"

        # JSON-mode dump must validate back to an equal model.
        assert ParseRun.model_validate(dumped) == run

    def test_minimal_queued_row(self):
        row = {
            "run_id": uuid4(),
            "pdf_hash": "h",
            "lecture_id": None,
            "pipeline_version": PIPELINE_VERSION,
            "status": "queued",
            "page_count": None,
            "started_at": datetime.now(timezone.utc),
            "finished_at": None,
            "outline": None,
            "error": None,
        }
        run = ParseRun.model_validate(row)
        assert run.outline is None
        assert run.lecture_id is None
        assert run.page_count is None
        assert run.finished_at is None
        # JSON dump preserves the nulls so an UPDATE will not stomp columns.
        dumped = run.model_dump(mode="json")
        for nullable in ("lecture_id", "page_count", "finished_at", "outline", "error"):
            assert dumped[nullable] is None

    def test_failed_run_keeps_error_message(self):
        row = {
            "run_id": uuid4(),
            "pdf_hash": "h",
            "lecture_id": uuid4(),
            "pipeline_version": PIPELINE_VERSION,
            "status": "failed",
            "page_count": 10,
            "started_at": datetime.now(timezone.utc),
            "finished_at": datetime.now(timezone.utc),
            "outline": None,
            "error": "vision LLM rate limited",
        }
        run = ParseRun.model_validate(row)
        assert run.status is RunStatus.FAILED
        assert run.error == "vision LLM rate limited"


# ── ParsePage ───────────────────────────────────────────────────────────────


class TestParsePageRoundTrip:
    def test_analyzed_page_with_extract_and_content(self):
        run_id = uuid4()
        updated = datetime(2026, 5, 3, 13, 0, tzinfo=timezone.utc)
        row = {
            "run_id": run_id,
            "page_index": 0,
            "status": "analyzed",
            "route": "text",
            "extract": _extract_dict(0),
            "content": _content_dict(0),
            "image_url": None,
            "error": None,
            "updated_at": updated,
        }

        page = ParsePage.model_validate(row)
        assert page.status is PageStatus.ANALYZED
        assert page.route is SlideRoute.TEXT
        assert isinstance(page.extract, ExtractedPage)
        assert isinstance(page.content, SlideContent)
        assert page.content.questions[0].answer == "A"
        assert page.content.meta.pipeline_version == PIPELINE_VERSION

        dumped = page.model_dump(mode="json")
        assert dumped["run_id"] == str(run_id)
        assert dumped["status"] == "analyzed"
        assert dumped["route"] == "text"
        assert dumped["extract"]["route"] == "text"
        assert dumped["content"]["meta"]["model"] == "gemini-1.5-flash"

        assert ParsePage.model_validate(dumped) == page

    def test_pending_page_has_no_extract_or_content(self):
        row = {
            "run_id": uuid4(),
            "page_index": 17,
            "status": "pending",
            "route": None,
            "extract": None,
            "content": None,
            "image_url": None,
            "error": None,
            "updated_at": datetime.now(timezone.utc),
        }
        page = ParsePage.model_validate(row)
        assert page.status is PageStatus.PENDING
        assert page.route is None
        assert page.extract is None
        assert page.content is None

    def test_vision_page_carries_storage_url(self):
        row = {
            "run_id": uuid4(),
            "page_index": 4,
            "status": "extracted",
            "route": "vision",
            "extract": {**_extract_dict(4), "route": "vision",
                        "image_url": "runs/abc/4.jpg"},
            "content": None,
            "image_url": "runs/abc/4.jpg",
            "error": None,
            "updated_at": datetime.now(timezone.utc),
        }
        page = ParsePage.model_validate(row)
        assert page.route is SlideRoute.VISION
        assert page.image_url == "runs/abc/4.jpg"
        assert page.extract is not None and page.extract.image_url == "runs/abc/4.jpg"

    def test_failed_page_keeps_error_message(self):
        row = {
            "run_id": uuid4(),
            "page_index": 5,
            "status": "failed",
            "route": "vision",
            "extract": None,
            "content": None,
            "image_url": None,
            "error": "render_page_jpeg timed out",
            "updated_at": datetime.now(timezone.utc),
        }
        page = ParsePage.model_validate(row)
        assert page.status is PageStatus.FAILED
        assert page.error == "render_page_jpeg timed out"


# ── SlideChunk (vector embedding) ───────────────────────────────────────────


class TestSlideChunkRoundTrip:
    def test_chunk_with_384d_embedding(self):
        lecture_id = uuid4()
        # pgvector returns the column as a Python list of floats.
        embedding = [0.01 * i for i in range(384)]
        row = {
            "id": 7,
            "lecture_id": lecture_id,
            "page_index": 12,
            "chunk_index": 0,
            "text": "k-NN is a non-parametric method.",
            "section": "k-NN",
            "embedding": embedding,
            "pipeline_version": PIPELINE_VERSION,
        }

        chunk = SlideChunk.model_validate(row)
        assert chunk.embedding is not None
        assert len(chunk.embedding) == 384
        assert chunk.embedding[100] == pytest.approx(1.0)

        dumped = chunk.model_dump(mode="json")
        assert dumped["lecture_id"] == str(lecture_id)
        assert dumped["embedding"][0] == pytest.approx(0.0)
        assert len(dumped["embedding"]) == 384

        again = SlideChunk.model_validate(dumped)
        assert again.embedding == chunk.embedding
        assert again == chunk

    def test_chunk_before_stage_6_has_no_embedding(self):
        # Pre-INSERT shape: BIGSERIAL `id` is None, embedding column is NULL.
        row = {
            "id": None,
            "lecture_id": uuid4(),
            "page_index": 0,
            "chunk_index": 0,
            "text": "before stage 6",
            "section": None,
            "embedding": None,
            "pipeline_version": PIPELINE_VERSION,
        }
        chunk = SlideChunk.model_validate(row)
        assert chunk.id is None
        assert chunk.embedding is None
        # `pipeline_version` defaults to PIPELINE_VERSION when omitted.
        bare = SlideChunk(
            lecture_id=row["lecture_id"], page_index=0, chunk_index=0, text="x"
        )
        assert bare.pipeline_version == PIPELINE_VERSION


# ── TutorMessage (INT[] cited_pages) ────────────────────────────────────────


class TestTutorMessageRoundTrip:
    def test_tutor_row_with_cited_pages_int_array(self):
        lecture_id = uuid4()
        user_id = uuid4()
        created = datetime(2026, 5, 3, 12, 0, tzinfo=timezone.utc)
        row = {
            "id": 99,
            "lecture_id": lecture_id,
            "user_id": user_id,
            "role": "tutor",
            "content": "Per slide 12, k-NN's cost is O(N).",
            "cited_pages": [11, 12, 13],
            "created_at": created,
        }

        msg = TutorMessage.model_validate(row)
        assert msg.role is TutorRole.TUTOR
        assert msg.cited_pages == [11, 12, 13]

        dumped = msg.model_dump(mode="json")
        assert dumped["role"] == "tutor"
        assert dumped["cited_pages"] == [11, 12, 13]
        assert dumped["lecture_id"] == str(lecture_id)
        assert dumped["user_id"] == str(user_id)

        assert TutorMessage.model_validate(dumped) == msg

    def test_student_row_default_empty_cited_pages(self):
        # The DB DEFAULT '{}' on cited_pages comes back as [].
        row = {
            "id": 1,
            "lecture_id": uuid4(),
            "user_id": uuid4(),
            "role": "student",
            "content": "I'm confused about k-NN.",
            "cited_pages": [],
            "created_at": datetime.now(timezone.utc),
        }
        msg = TutorMessage.model_validate(row)
        assert msg.role is TutorRole.STUDENT
        assert msg.cited_pages == []

    def test_pre_insert_message_has_no_id_or_timestamp(self):
        msg = TutorMessage(
            lecture_id=uuid4(),
            user_id=uuid4(),
            role=TutorRole.STUDENT,
            content="hi",
        )
        assert msg.id is None
        assert msg.created_at is None
        assert msg.cited_pages == []


# ── Inner JSONB models also round-trip in isolation ────────────────────────


class TestJsonbInnerModels:
    def test_deck_outline_round_trip(self):
        out = DeckOutline.model_validate(_outline_dict())
        assert isinstance(out.sections[0], OutlineSection)
        assert DeckOutline.model_validate(out.model_dump(mode="json")) == out

    def test_extracted_page_round_trip(self):
        ex = ExtractedPage.model_validate(_extract_dict(3))
        assert ex.route is SlideRoute.TEXT
        assert ExtractedPage.model_validate(ex.model_dump(mode="json")) == ex

    def test_slide_content_round_trip(self):
        sc = SlideContent.model_validate(_content_dict(0))
        assert isinstance(sc.meta, SlideMeta)
        assert isinstance(sc.questions[0], QuizQuestion)
        assert SlideContent.model_validate(sc.model_dump(mode="json")) == sc

    def test_quiz_question_enforces_four_options(self):
        from pydantic import ValidationError

        bad = {
            "question": "?",
            "options": ["a", "b", "c"],  # only 3
            "answer": "A",
            "explanation": "",
            "concept": "x",
            "cognitive_level": "recall",
        }
        with pytest.raises(ValidationError):
            QuizQuestion.model_validate(bad)
