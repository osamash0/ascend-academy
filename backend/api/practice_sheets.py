"""Practice Sheets API.

Supports two sheet kinds:
  auto   — generated from the lecture's quiz_questions; regenerated on demand.
  manual — professor-authored; supports multiple_choice, short_answer, free_form.

Endpoints:
  GET    /api/lectures/{lecture_id}/practice-sheets          list sheets for a lecture
  POST   /api/lectures/{lecture_id}/practice-sheets          create manual sheet
  POST   /api/lectures/{lecture_id}/practice-sheets/auto     generate/regenerate auto sheet
  GET    /api/practice-sheets/{sheet_id}                     get sheet + questions
  PATCH  /api/practice-sheets/{sheet_id}                     update sheet title/status
  DELETE /api/practice-sheets/{sheet_id}                     delete sheet
  POST   /api/practice-sheets/{sheet_id}/questions           add question to manual sheet
  PATCH  /api/practice-sheets/{sheet_id}/questions/{qid}    update question
  DELETE /api/practice-sheets/{sheet_id}/questions/{qid}    delete question
  POST   /api/practice-sheets/{sheet_id}/reorder             reorder questions
  POST   /api/practice-sheets/{sheet_id}/attempts            submit an attempt
  GET    /api/practice-sheets/{sheet_id}/attempts/mine       fetch caller's own attempts
"""
from __future__ import annotations

import logging
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from backend.core.auth_middleware import _user_id, require_professor, verify_token
from backend.core.database import supabase_admin
from backend.core.rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter(tags=["practice_sheets"])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fetch_lecture(lecture_id: str) -> Optional[dict]:
    res = (
        supabase_admin.table("lectures")
        .select("id, professor_id")
        .eq("id", lecture_id)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _fetch_sheet(sheet_id: str) -> Optional[dict]:
    res = (
        supabase_admin.table("practice_sheets")
        .select("id, lecture_id, kind, title, status, created_by, created_at, updated_at")
        .eq("id", sheet_id)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _fetch_questions(sheet_id: str) -> List[dict]:
    res = (
        supabase_admin.table("practice_sheet_questions")
        .select(
            "id, sheet_id, order_index, type, prompt, choices, correct_answer, "
            "explanation, source_quiz_question_id, created_at, updated_at"
        )
        .eq("sheet_id", sheet_id)
        .order("order_index")
        .execute()
    )
    return res.data or []


def _user_can_read_lecture(user_id: str, lecture: dict) -> bool:
    """Professor owns it OR student is enrolled via any assignment."""
    if lecture["professor_id"] == user_id:
        return True
    enroll = (
        supabase_admin.table("assignment_enrollments")
        .select("assignment_id")
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    a_ids = [e["assignment_id"] for e in enroll if e.get("assignment_id")]
    if not a_ids:
        return False
    al = (
        supabase_admin.table("assignment_lectures")
        .select("lecture_id")
        .in_("assignment_id", a_ids)
        .eq("lecture_id", lecture["id"])
        .execute()
        .data
        or []
    )
    return bool(al)


def _is_professor_of_lecture(user_id: str, lecture: dict) -> bool:
    return lecture["professor_id"] == user_id


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class CreateSheetBody(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)


class UpdateSheetBody(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    status: Optional[str] = Field(default=None, pattern="^(draft|published)$")


class QuestionBody(BaseModel):
    type: str = Field(..., pattern="^(multiple_choice|short_answer|free_form)$")
    prompt: str = Field(..., min_length=1, max_length=4000)
    choices: Optional[List[str]] = Field(default=None, max_length=10)
    correct_answer: Optional[str] = Field(default=None, max_length=2000)
    explanation: Optional[str] = Field(default=None, max_length=2000)
    order_index: Optional[int] = Field(default=None, ge=0)


class ReorderBody(BaseModel):
    question_ids: List[str] = Field(..., min_length=1)


class SubmitAttemptBody(BaseModel):
    answers: dict = Field(default_factory=dict)
    is_preview: bool = False


# ---------------------------------------------------------------------------
# Endpoints — list / create
# ---------------------------------------------------------------------------

@router.get("/api/lectures/{lecture_id}/practice-sheets")
@limiter.limit("120/minute")
async def list_practice_sheets(
    request: Request,
    lecture_id: str,
    user: Any = Depends(verify_token),
):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _load():
        lec = _fetch_lecture(lecture_id)
        if not lec:
            raise HTTPException(status_code=404, detail="Lecture not found.")
        if not _user_can_read_lecture(uid, lec):
            raise HTTPException(status_code=404, detail="Lecture not found.")

        is_prof = _is_professor_of_lecture(uid, lec)

        q = (
            supabase_admin.table("practice_sheets")
            .select("id, lecture_id, kind, title, status, created_by, created_at, updated_at")
            .eq("lecture_id", lecture_id)
            .order("created_at")
        )
        if not is_prof:
            q = q.eq("status", "published")

        rows = q.execute().data or []

        if is_prof:
            for row in rows:
                qs = _fetch_questions(row["id"])
                row["question_count"] = len(qs)

        return rows

    try:
        data = await run_in_threadpool(_load)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Practice sheets list failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load practice sheets.")


@router.post("/api/lectures/{lecture_id}/practice-sheets", status_code=201)
@limiter.limit("30/minute")
async def create_manual_sheet(
    request: Request,
    lecture_id: str,
    body: CreateSheetBody,
    user: Any = Depends(require_professor),
):
    uid = _user_id(user)

    def _create():
        lec = _fetch_lecture(lecture_id)
        if not lec:
            raise HTTPException(status_code=404, detail="Lecture not found.")
        if not _is_professor_of_lecture(uid, lec):
            raise HTTPException(status_code=403, detail="You do not own this lecture.")

        ins = (
            supabase_admin.table("practice_sheets")
            .insert({
                "lecture_id": lecture_id,
                "kind": "manual",
                "title": body.title.strip(),
                "status": "draft",
                "created_by": uid,
            })
            .execute()
        )
        if not ins.data:
            raise HTTPException(status_code=500, detail="Failed to create sheet.")
        sheet = ins.data[0]
        sheet["question_count"] = 0
        return sheet

    try:
        data = await run_in_threadpool(_create)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Practice sheet create failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to create practice sheet.")


# ---------------------------------------------------------------------------
# Auto-generate endpoint
# ---------------------------------------------------------------------------

@router.post("/api/lectures/{lecture_id}/practice-sheets/auto", status_code=201)
@limiter.limit("10/minute")
async def generate_auto_sheet(
    request: Request,
    lecture_id: str,
    user: Any = Depends(require_professor),
):
    """Generate (or regenerate) the auto sheet for a lecture from its quiz_questions."""
    uid = _user_id(user)

    def _generate():
        lec = _fetch_lecture(lecture_id)
        if not lec:
            raise HTTPException(status_code=404, detail="Lecture not found.")
        if not _is_professor_of_lecture(uid, lec):
            raise HTTPException(status_code=403, detail="You do not own this lecture.")

        # Pull all slides + their quiz questions for this lecture
        slides_res = (
            supabase_admin.table("slides")
            .select("id, slide_number, title")
            .eq("lecture_id", lecture_id)
            .order("slide_number")
            .execute()
        )
        slide_rows = slides_res.data or []
        if not slide_rows:
            raise HTTPException(status_code=400, detail="This lecture has no slides yet.")

        slide_ids = [s["id"] for s in slide_rows]
        qq_res = (
            supabase_admin.table("quiz_questions")
            .select("id, slide_id, question_text, options, correct_answer, metadata")
            .in_("slide_id", slide_ids)
            .execute()
        )
        qq_rows = qq_res.data or []
        if not qq_rows:
            raise HTTPException(
                status_code=400,
                detail="No quiz questions found for this lecture. Generate quizzes first.",
            )

        # Check if auto sheet already exists
        existing = (
            supabase_admin.table("practice_sheets")
            .select("id")
            .eq("lecture_id", lecture_id)
            .eq("kind", "auto")
            .execute()
            .data
            or []
        )

        if existing:
            sheet_id = existing[0]["id"]
            # Delete existing questions
            supabase_admin.table("practice_sheet_questions").delete().eq(
                "sheet_id", sheet_id
            ).execute()
            # Reset to draft on regenerate
            supabase_admin.table("practice_sheets").update({"status": "draft", "title": "Auto-generated Practice Sheet"}).eq(
                "id", sheet_id
            ).execute()
        else:
            ins = (
                supabase_admin.table("practice_sheets")
                .insert({
                    "lecture_id": lecture_id,
                    "kind": "auto",
                    "title": "Auto-generated Practice Sheet",
                    "status": "draft",
                    "created_by": uid,
                })
                .execute()
            )
            if not ins.data:
                raise HTTPException(status_code=500, detail="Failed to create auto sheet.")
            sheet_id = ins.data[0]["id"]

        # Build questions from quiz_questions
        slide_by_id = {s["id"]: s for s in slide_rows}
        questions_to_insert = []
        for i, qq in enumerate(qq_rows):
            options = qq.get("options") or []
            if isinstance(options, list):
                choices = [str(o) for o in options]
            else:
                choices = []
            # Distinguish "no correct answer recorded" (None) from option 0 —
            # `or 0` previously mis-keyed null answers to the first choice.
            raw_correct = qq.get("correct_answer")
            correct_idx = raw_correct if isinstance(raw_correct, int) else None
            correct_text = choices[correct_idx] if correct_idx is not None and 0 <= correct_idx < len(choices) else None

            slide = slide_by_id.get(qq["slide_id"], {})
            prompt = qq.get("question_text") or ""

            metadata = qq.get("metadata") or {}
            explanation = metadata.get("explanation") if isinstance(metadata, dict) else None

            questions_to_insert.append({
                "sheet_id": sheet_id,
                "order_index": i,
                "type": "multiple_choice",
                "prompt": prompt,
                "choices": choices,
                "correct_answer": correct_text,
                "explanation": explanation,
                "source_quiz_question_id": qq["id"],
            })

        if questions_to_insert:
            supabase_admin.table("practice_sheet_questions").insert(questions_to_insert).execute()

        sheet = _fetch_sheet(sheet_id)
        sheet["questions"] = _fetch_questions(sheet_id)
        return sheet

    try:
        data = await run_in_threadpool(_generate)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Auto sheet generate failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate auto sheet.")


# ---------------------------------------------------------------------------
# Single sheet endpoints
# ---------------------------------------------------------------------------

@router.get("/api/practice-sheets/{sheet_id}")
@limiter.limit("120/minute")
async def get_practice_sheet(
    request: Request,
    sheet_id: str,
    user: Any = Depends(verify_token),
):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _load():
        sheet = _fetch_sheet(sheet_id)
        if not sheet:
            raise HTTPException(status_code=404, detail="Practice sheet not found.")
        lec = _fetch_lecture(sheet["lecture_id"])
        if not lec:
            raise HTTPException(status_code=404, detail="Lecture not found.")

        is_prof = _is_professor_of_lecture(uid, lec)
        if not is_prof:
            if sheet["status"] != "published":
                raise HTTPException(status_code=404, detail="Practice sheet not found.")
            if not _user_can_read_lecture(uid, lec):
                raise HTTPException(status_code=404, detail="Practice sheet not found.")

        sheet["questions"] = _fetch_questions(sheet_id)
        return sheet

    try:
        data = await run_in_threadpool(_load)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Practice sheet get failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load practice sheet.")


@router.patch("/api/practice-sheets/{sheet_id}")
@limiter.limit("60/minute")
async def update_practice_sheet(
    request: Request,
    sheet_id: str,
    body: UpdateSheetBody,
    user: Any = Depends(require_professor),
):
    uid = _user_id(user)

    def _update():
        sheet = _fetch_sheet(sheet_id)
        if not sheet:
            raise HTTPException(status_code=404, detail="Practice sheet not found.")
        if sheet["created_by"] != uid:
            raise HTTPException(status_code=403, detail="You do not own this sheet.")

        patch: dict = {}
        if body.title is not None:
            patch["title"] = body.title.strip()
        if body.status is not None:
            patch["status"] = body.status
        if patch:
            supabase_admin.table("practice_sheets").update(patch).eq("id", sheet_id).execute()
        return _fetch_sheet(sheet_id)

    try:
        data = await run_in_threadpool(_update)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Practice sheet update failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update practice sheet.")


@router.delete("/api/practice-sheets/{sheet_id}", status_code=204)
@limiter.limit("30/minute")
async def delete_practice_sheet(
    request: Request,
    sheet_id: str,
    user: Any = Depends(require_professor),
):
    uid = _user_id(user)

    def _delete():
        sheet = _fetch_sheet(sheet_id)
        if not sheet:
            raise HTTPException(status_code=404, detail="Practice sheet not found.")
        if sheet["created_by"] != uid:
            raise HTTPException(status_code=403, detail="You do not own this sheet.")
        supabase_admin.table("practice_sheets").delete().eq("id", sheet_id).execute()

    try:
        await run_in_threadpool(_delete)
        return None
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Practice sheet delete failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to delete practice sheet.")


# ---------------------------------------------------------------------------
# Question management (manual sheets only)
# ---------------------------------------------------------------------------

@router.post("/api/practice-sheets/{sheet_id}/questions", status_code=201)
@limiter.limit("60/minute")
async def add_question(
    request: Request,
    sheet_id: str,
    body: QuestionBody,
    user: Any = Depends(require_professor),
):
    uid = _user_id(user)

    def _add():
        sheet = _fetch_sheet(sheet_id)
        if not sheet:
            raise HTTPException(status_code=404, detail="Practice sheet not found.")
        if sheet["created_by"] != uid:
            raise HTTPException(status_code=403, detail="You do not own this sheet.")
        if sheet["kind"] != "manual":
            raise HTTPException(status_code=400, detail="Cannot manually add questions to an auto sheet.")

        # Determine next order_index
        existing = _fetch_questions(sheet_id)
        next_idx = (body.order_index if body.order_index is not None
                    else (len(existing)))

        ins = (
            supabase_admin.table("practice_sheet_questions")
            .insert({
                "sheet_id": sheet_id,
                "order_index": next_idx,
                "type": body.type,
                "prompt": body.prompt.strip(),
                "choices": body.choices,
                "correct_answer": body.correct_answer,
                "explanation": body.explanation,
            })
            .execute()
        )
        if not ins.data:
            raise HTTPException(status_code=500, detail="Failed to add question.")
        return ins.data[0]

    try:
        data = await run_in_threadpool(_add)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Add question failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to add question.")


@router.patch("/api/practice-sheets/{sheet_id}/questions/{question_id}")
@limiter.limit("60/minute")
async def update_question(
    request: Request,
    sheet_id: str,
    question_id: str,
    body: QuestionBody,
    user: Any = Depends(require_professor),
):
    uid = _user_id(user)

    def _update():
        sheet = _fetch_sheet(sheet_id)
        if not sheet or sheet["created_by"] != uid:
            raise HTTPException(status_code=403, detail="Not authorised.")

        patch: dict = {}
        if body.type is not None:
            patch["type"] = body.type
        if body.prompt is not None:
            patch["prompt"] = body.prompt.strip()
        if body.choices is not None:
            patch["choices"] = body.choices
        if body.correct_answer is not None:
            patch["correct_answer"] = body.correct_answer
        if body.explanation is not None:
            patch["explanation"] = body.explanation

        if patch:
            supabase_admin.table("practice_sheet_questions").update(patch).eq(
                "id", question_id
            ).eq("sheet_id", sheet_id).execute()

        res = (
            supabase_admin.table("practice_sheet_questions")
            .select("*")
            .eq("id", question_id)
            .execute()
        )
        rows = res.data or []
        if not rows:
            raise HTTPException(status_code=404, detail="Question not found.")
        return rows[0]

    try:
        data = await run_in_threadpool(_update)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Update question failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update question.")


@router.delete("/api/practice-sheets/{sheet_id}/questions/{question_id}", status_code=204)
@limiter.limit("60/minute")
async def delete_question(
    request: Request,
    sheet_id: str,
    question_id: str,
    user: Any = Depends(require_professor),
):
    uid = _user_id(user)

    def _delete():
        sheet = _fetch_sheet(sheet_id)
        if not sheet or sheet["created_by"] != uid:
            raise HTTPException(status_code=403, detail="Not authorised.")
        supabase_admin.table("practice_sheet_questions").delete().eq(
            "id", question_id
        ).eq("sheet_id", sheet_id).execute()
        # Re-normalise order_index so remaining questions are contiguous (0,1,2,…)
        remaining = _fetch_questions(sheet_id)
        for i, q in enumerate(remaining):
            if q["order_index"] != i:
                supabase_admin.table("practice_sheet_questions").update(
                    {"order_index": i}
                ).eq("id", q["id"]).execute()

    try:
        await run_in_threadpool(_delete)
        return None
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Delete question failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to delete question.")


@router.post("/api/practice-sheets/{sheet_id}/reorder")
@limiter.limit("60/minute")
async def reorder_questions(
    request: Request,
    sheet_id: str,
    body: ReorderBody,
    user: Any = Depends(require_professor),
):
    uid = _user_id(user)

    def _reorder():
        sheet = _fetch_sheet(sheet_id)
        if not sheet or sheet["created_by"] != uid:
            raise HTTPException(status_code=403, detail="Not authorised.")
        for i, qid in enumerate(body.question_ids):
            supabase_admin.table("practice_sheet_questions").update(
                {"order_index": i}
            ).eq("id", qid).eq("sheet_id", sheet_id).execute()
        return _fetch_questions(sheet_id)

    try:
        data = await run_in_threadpool(_reorder)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Reorder questions failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to reorder questions.")


# ---------------------------------------------------------------------------
# Attempts
# ---------------------------------------------------------------------------

def _grade_attempt(questions: List[dict], answers: dict) -> float:
    """Auto-grade MC and short_answer questions. Free-form are self-assessed (score=0 for now)."""
    gradeable = [q for q in questions if q["type"] in ("multiple_choice", "short_answer")]
    if not gradeable:
        return 0.0
    correct = 0
    for q in gradeable:
        answer = (answers.get(q["id"]) or "").strip().lower()
        expected = (q.get("correct_answer") or "").strip().lower()
        if answer and expected and answer == expected:
            correct += 1
    return round((correct / len(gradeable)) * 100, 1)


@router.post("/api/practice-sheets/{sheet_id}/attempts", status_code=201)
@limiter.limit("30/minute")
async def submit_attempt(
    request: Request,
    sheet_id: str,
    body: SubmitAttemptBody,
    user: Any = Depends(verify_token),
):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _submit():
        sheet = _fetch_sheet(sheet_id)
        if not sheet:
            raise HTTPException(status_code=404, detail="Practice sheet not found.")

        lec = _fetch_lecture(sheet["lecture_id"])
        if not lec:
            raise HTTPException(status_code=404, detail="Lecture not found.")

        is_prof = _is_professor_of_lecture(uid, lec)

        # Students can only submit on published sheets they can access
        if not is_prof:
            if sheet["status"] != "published":
                raise HTTPException(status_code=404, detail="Practice sheet not found.")
            if not _user_can_read_lecture(uid, lec):
                raise HTTPException(status_code=403, detail="Not enrolled.")

        # Professors can always preview their own sheets
        # Only professors may mark an attempt as a preview; ignore any student-supplied flag
        is_preview = is_prof and body.is_preview

        questions = _fetch_questions(sheet_id)
        score = _grade_attempt(questions, body.answers)

        ins = (
            supabase_admin.table("practice_attempts")
            .insert({
                "sheet_id": sheet_id,
                "student_id": uid,
                "answers": body.answers,
                "score": score,
                "is_preview": is_preview,
            })
            .execute()
        )
        if not ins.data:
            raise HTTPException(status_code=500, detail="Failed to save attempt.")

        attempt = ins.data[0]
        attempt["score"] = score
        attempt["questions"] = questions
        return attempt

    try:
        data = await run_in_threadpool(_submit)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Submit attempt failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to submit attempt.")


@router.get("/api/practice-sheets/{sheet_id}/attempts/mine")
@limiter.limit("60/minute")
async def get_my_attempts(
    request: Request,
    sheet_id: str,
    user: Any = Depends(verify_token),
):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _load():
        res = (
            supabase_admin.table("practice_attempts")
            .select("id, sheet_id, student_id, answers, score, is_preview, submitted_at")
            .eq("sheet_id", sheet_id)
            .eq("student_id", uid)
            .eq("is_preview", False)
            .order("submitted_at", desc=True)
            .execute()
        )
        return res.data or []

    try:
        data = await run_in_threadpool(_load)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Get attempts failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load attempts.")
