"""
Lecture repository — all database access for the lectures and slides domain.
Services import these functions instead of calling supabase directly,
so the storage layer can be swapped or mocked without touching business logic.
"""
from __future__ import annotations
from typing import Any
from supabase import Client


def get_lecture(client: Client, lecture_id: str) -> dict[str, Any] | None:
    res = (
        client.table("lectures")
        .select("id, title, description, total_slides, created_at, pdf_url, professor_id")
        .eq("id", lecture_id)
        .single()
        .execute()
    )
    return res.data


def list_lectures(client: Client, professor_id: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
    q = (
        client.table("lectures")
        .select("id, title, description, total_slides, created_at")
        .order("created_at", desc=True)
        .limit(limit)
    )
    if professor_id:
        q = q.eq("professor_id", professor_id)
    return q.execute().data or []


def get_slides(client: Client, lecture_id: str) -> list[dict[str, Any]]:
    return (
        client.table("slides")
        .select("id, slide_number, title, content_text, summary")
        .eq("lecture_id", lecture_id)
        .order("slide_number")
        .limit(500)
        .execute()
        .data
        or []
    )


def get_quiz_questions(client: Client, lecture_id: str) -> list[dict[str, Any]]:
    return (
        client.table("quiz_questions")
        .select("id, slide_id, question_text, options, correct_answer")
        .eq("lecture_id", lecture_id)
        .execute()
        .data
        or []
    )


def update_slide(client: Client, slide_id: str, patch: dict[str, Any]) -> None:
    client.table("slides").update(patch).eq("id", slide_id).execute()


def upsert_student_progress(client: Client, data: dict[str, Any]) -> None:
    client.table("student_progress").upsert(
        data, count="exact"
    ).execute()
