"""
Pydantic domain models for internal service-to-service communication.
These are NOT API response schemas — those live in backend/api/*.py.
"""
from __future__ import annotations
from datetime import datetime
from typing import Any
from pydantic import BaseModel


class LectureModel(BaseModel):
    id: str
    title: str
    description: str | None = None
    total_slides: int
    created_at: datetime
    pdf_url: str | None = None
    professor_id: str | None = None


class SlideModel(BaseModel):
    id: str
    lecture_id: str
    slide_number: int
    title: str | None = None
    content_text: str | None = None
    summary: str | None = None


class StudentProgressModel(BaseModel):
    user_id: str
    lecture_id: str
    completed_slides: list[int] = []
    quiz_score: float = 0.0
    total_questions_answered: int = 0
    correct_answers: int = 0
    last_slide_viewed: int | None = None
    completed_at: datetime | None = None


class LearningEventModel(BaseModel):
    id: str | None = None
    user_id: str
    event_type: str
    event_data: dict[str, Any] = {}
    created_at: datetime | None = None
