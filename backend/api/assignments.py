"""Weekly assignments API.

Professors create lightweight assignments that bundle one or more existing
lectures with a due date and an optional minimum quiz score. Students see
each assignment with a computed status (not_started / in_progress /
completed / overdue) derived from existing student_progress data — there
is no separate "submission" entity.

Endpoints:
    GET    /api/assignments               — list (role-aware)
    GET    /api/assignments/{id}          — single assignment
    POST   /api/assignments                — professor create
    PATCH  /api/assignments/{id}          — professor update
    DELETE /api/assignments/{id}          — professor delete

Status computation is done server-side so the same logic powers both the
student dashboard panel and the upcoming nudge engine.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from backend.core.auth_middleware import (
    _user_id,
    require_professor,
    verify_token,
)
from backend.core.database import supabase_admin
from backend.core.rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/assignments", tags=["assignments"])


# ── Models ──────────────────────────────────────────────────────────────────

class AssignmentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=4000)
    lecture_ids: List[str] = Field(..., min_length=1, max_length=50)
    # Optional roster. When omitted, the assignment is created with no
    # enrolled students (invisible to anyone but the owning professor)
    # until they're added via PATCH. Per task spec, create only requires
    # title/lectures/due date/min score.
    student_ids: Optional[List[str]] = Field(default=None, max_length=2000)
    due_at: datetime
    min_quiz_score: Optional[int] = Field(default=None, ge=0, le=100)
    course_id: Optional[str] = None


class AssignmentUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=4000)
    lecture_ids: Optional[List[str]] = Field(default=None, min_length=1, max_length=50)
    student_ids: Optional[List[str]] = Field(default=None, max_length=2000)
    due_at: Optional[datetime] = None
    min_quiz_score: Optional[int] = Field(default=None, ge=0, le=100)


# ── Helpers ─────────────────────────────────────────────────────────────────

def _fetch_assignment(assignment_id: str) -> Optional[dict]:
    res = (
        supabase_admin.table("assignments")
        .select("id, professor_id, course_id, title, description, due_at, min_quiz_score, created_at")
        .eq("id", assignment_id)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _fetch_lecture_ids_for_assignment(assignment_id: str) -> List[str]:
    res = (
        supabase_admin.table("assignment_lectures")
        .select("lecture_id")
        .eq("assignment_id", assignment_id)
        .execute()
    )
    return [r["lecture_id"] for r in (res.data or [])]


def _verify_lectures_owned(lecture_ids: List[str], professor_id: str) -> None:
    """Raise 400/403 if any lecture is missing or not owned by the professor."""
    if not lecture_ids:
        raise HTTPException(status_code=400, detail="At least one lecture is required.")
    res = (
        supabase_admin.table("lectures")
        .select("id, professor_id")
        .in_("id", lecture_ids)
        .execute()
    )
    found = res.data or []
    if len(found) != len(set(lecture_ids)):
        raise HTTPException(status_code=400, detail="One or more lectures do not exist.")
    for row in found:
        if row.get("professor_id") != professor_id:
            raise HTTPException(
                status_code=403,
                detail="You can only assign lectures you own.",
            )


def compute_status_for_user(
    user_id: str,
    lecture_ids: List[str],
    due_at: datetime,
    min_quiz_score: Optional[int],
) -> dict:
    """Return {status, completed_count, total_count, progress_percentage}.

    Status values: 'not_started' | 'in_progress' | 'completed' | 'overdue'.
    'completed' beats 'overdue' — finishing late still counts as done.
    """
    total = len(lecture_ids)
    if total == 0:
        return {
            "status": "not_started",
            "completed_count": 0,
            "total_count": 0,
            "progress_percentage": 0,
        }

    res = (
        supabase_admin.table("student_progress")
        .select("lecture_id, quiz_score, completed_at")
        .eq("user_id", user_id)
        .in_("lecture_id", lecture_ids)
        .execute()
    )
    progress_rows = res.data or []
    progress_by_lecture = {p["lecture_id"]: p for p in progress_rows}

    completed = 0
    started = 0
    for lid in lecture_ids:
        p = progress_by_lecture.get(lid)
        if not p:
            continue
        started += 1
        if p.get("completed_at") is None:
            continue
        if min_quiz_score is not None and (p.get("quiz_score") or 0) < min_quiz_score:
            continue
        completed += 1

    pct = round((completed / total) * 100) if total else 0

    now = datetime.now(timezone.utc)
    due_aware = due_at if due_at.tzinfo else due_at.replace(tzinfo=timezone.utc)

    if completed == total:
        status_str = "completed"
    elif now > due_aware:
        status_str = "overdue"
    elif started > 0:
        status_str = "in_progress"
    else:
        status_str = "not_started"

    return {
        "status": status_str,
        "completed_count": completed,
        "total_count": total,
        "progress_percentage": pct,
    }


def _serialize(
    assignment: dict,
    lecture_ids: List[str],
    *,
    user_id: Optional[str] = None,
    include_status: bool = False,
) -> dict:
    out = {
        "id": assignment["id"],
        "professor_id": assignment["professor_id"],
        "course_id": assignment.get("course_id"),
        "title": assignment["title"],
        "description": assignment.get("description"),
        "due_at": assignment["due_at"],
        "min_quiz_score": assignment.get("min_quiz_score"),
        "created_at": assignment.get("created_at"),
        "lecture_ids": lecture_ids,
    }
    if include_status and user_id:
        due_at = assignment["due_at"]
        if isinstance(due_at, str):
            try:
                due_at = datetime.fromisoformat(due_at.replace("Z", "+00:00"))
            except ValueError:
                due_at = datetime.now(timezone.utc)
        out.update(
            compute_status_for_user(
                user_id=user_id,
                lecture_ids=lecture_ids,
                due_at=due_at,
                min_quiz_score=assignment.get("min_quiz_score"),
            )
        )
    return out


def _enrolled_assignment_ids(user_id: str) -> set[str]:
    """Return the set of assignment ids this student is enrolled in.

    This is the single source of truth for student-side visibility; it
    matches the RLS policy on `assignments` so the API and DB agree.
    """
    res = (
        supabase_admin.table("assignment_enrollments")
        .select("assignment_id")
        .eq("user_id", user_id)
        .execute()
    )
    return {r["assignment_id"] for r in (res.data or []) if r.get("assignment_id")}


def _enrolled_user_ids(assignment_id: str) -> List[str]:
    res = (
        supabase_admin.table("assignment_enrollments")
        .select("user_id")
        .eq("assignment_id", assignment_id)
        .execute()
    )
    return [r["user_id"] for r in (res.data or []) if r.get("user_id")]


def _is_professor(user: Any) -> bool:
    meta = getattr(user, "app_metadata", None)
    if meta is None and isinstance(user, dict):
        meta = user.get("app_metadata") or {}
    if isinstance(meta, dict) and meta.get("role") == "professor":
        return True
    # Fallback: user_roles table
    uid = _user_id(user)
    if not uid:
        return False
    try:
        res = supabase_admin.table("user_roles").select("role").eq("user_id", uid).execute()
        return any(r.get("role") == "professor" for r in (res.data or []))
    except Exception:
        return False


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("")
@limiter.limit("60/minute")
async def list_assignments(request: Request, user: Any = Depends(verify_token)):
    """Role-aware list.

    Professor → their own assignments (no per-user status).
    Student   → every assignment with a per-user computed status.
    """
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    is_prof = await run_in_threadpool(_is_professor, user)

    def _load() -> List[dict]:
        q = supabase_admin.table("assignments").select(
            "id, professor_id, course_id, title, description, due_at, min_quiz_score, created_at"
        )
        if is_prof:
            q = q.eq("professor_id", uid)
        rows = q.order("due_at").execute().data or []

        # Students only see assignments they are explicitly enrolled in.
        if not is_prof:
            enrolled = _enrolled_assignment_ids(uid)
            rows = [r for r in rows if r["id"] in enrolled]

        # Batch-load join rows.
        by_id: dict[str, List[str]] = {r["id"]: [] for r in rows}
        if rows:
            ids = [r["id"] for r in rows]
            join_rows = (
                supabase_admin.table("assignment_lectures")
                .select("assignment_id, lecture_id")
                .in_("assignment_id", ids)
                .execute()
                .data
                or []
            )
            for jr in join_rows:
                by_id.setdefault(jr["assignment_id"], []).append(jr["lecture_id"])

        # For professors, batch-load enrollments so the dashboard can show
        # roster size without a per-row round-trip.
        roster_by_id: dict[str, List[str]] = {}
        if is_prof and rows:
            ids = [r["id"] for r in rows]
            enroll_rows = (
                supabase_admin.table("assignment_enrollments")
                .select("assignment_id, user_id")
                .in_("assignment_id", ids)
                .execute()
                .data
                or []
            )
            for er in enroll_rows:
                roster_by_id.setdefault(er["assignment_id"], []).append(er["user_id"])

        out = []
        for r in rows:
            base = _serialize(
                r,
                by_id.get(r["id"], []),
                user_id=uid,
                include_status=not is_prof,
            )
            if is_prof:
                base["student_ids"] = roster_by_id.get(r["id"], [])
            out.append(base)
        return out

    try:
        data = await run_in_threadpool(_load)
        return {"success": True, "data": data}
    except Exception as e:
        logger.error("Assignments list failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load assignments.")


@router.get("/{assignment_id}")
@limiter.limit("120/minute")
async def get_assignment(request: Request, assignment_id: str, user: Any = Depends(verify_token)):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _load():
        a = _fetch_assignment(assignment_id)
        if not a:
            return ("missing", None)
        is_owner = a.get("professor_id") == uid
        if not is_owner:
            enrolled = _enrolled_assignment_ids(uid)
            if assignment_id not in enrolled:
                # Hide existence: 404 instead of 403 to avoid leaking ids.
                return ("forbidden", None)
        lecture_ids = _fetch_lecture_ids_for_assignment(assignment_id)
        payload = _serialize(
            a,
            lecture_ids,
            user_id=uid,
            include_status=not is_owner,
        )
        if is_owner:
            payload["student_ids"] = _enrolled_user_ids(assignment_id)
        return ("ok", payload)

    outcome, data = await run_in_threadpool(_load)
    if outcome != "ok":
        raise HTTPException(status_code=404, detail="Assignment not found.")
    return {"success": True, "data": data}


@router.get("/_meta/students")
@limiter.limit("60/minute")
async def list_enrollable_students(
    request: Request,
    user=Depends(verify_token),
    _professor=Depends(require_professor),
):
    """Return the students this professor has already taught — i.e. those
    who have at least one `student_progress` row on a lecture this
    professor authored. This scopes the roster picker to least-privilege:
    a professor sees only "their" students, never the global student
    directory. Returns minimal fields (id + display name only — email is
    omitted) to limit PII exposure.

    Endpoint is professor-gated. Service-role is required because
    `user_roles`/`profiles` RLS restricts SELECT to the row owner.
    """
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _load() -> List[dict]:
        # 1. Lectures owned by this professor.
        lectures = (
            supabase_admin.table("lectures")
            .select("id")
            .eq("professor_id", uid)
            .execute()
            .data
            or []
        )
        lecture_ids = [l["id"] for l in lectures if l.get("id")]
        if not lecture_ids:
            return []
        # 2. Students who progressed on any of those lectures.
        progress = (
            supabase_admin.table("student_progress")
            .select("user_id")
            .in_("lecture_id", lecture_ids)
            .execute()
            .data
            or []
        )
        student_ids = list({p["user_id"] for p in progress if p.get("user_id")})
        if not student_ids:
            return []
        # 3. Hydrate display names. Email is intentionally NOT returned
        # to keep PII exposure minimal.
        profiles = (
            supabase_admin.table("profiles")
            .select("user_id, full_name")
            .in_("user_id", student_ids)
            .execute()
            .data
            or []
        )
        by_id = {p["user_id"]: p.get("full_name") for p in profiles if p.get("user_id")}
        out = [
            {"id": sid, "full_name": by_id.get(sid)}
            for sid in student_ids
        ]
        out.sort(key=lambda p: ((p["full_name"] or "").lower(), p["id"]))
        return out

    data = await run_in_threadpool(_load)
    return {"success": True, "data": data}


@router.post("", status_code=201)
@limiter.limit("30/minute")
async def create_assignment(
    request: Request,
    body: AssignmentCreate,
    user: Any = Depends(require_professor),
):
    uid = _user_id(user)

    def _create():
        _verify_lectures_owned(body.lecture_ids, uid)
        ins = (
            supabase_admin.table("assignments")
            .insert(
                {
                    "professor_id": uid,
                    "course_id": body.course_id,
                    "title": body.title.strip(),
                    "description": (body.description or "").strip() or None,
                    "due_at": body.due_at.isoformat(),
                    "min_quiz_score": body.min_quiz_score,
                }
            )
            .execute()
        )
        if not ins.data:
            raise HTTPException(status_code=500, detail="Failed to create assignment.")
        new_id = ins.data[0]["id"]
        supabase_admin.table("assignment_lectures").insert(
            [{"assignment_id": new_id, "lecture_id": lid} for lid in body.lecture_ids]
        ).execute()
        # Roster: enroll the chosen students up-front so RLS visibility
        # works the moment the assignment lands. Empty/None roster is
        # allowed — the professor can grow the roster later via PATCH.
        student_ids = list(dict.fromkeys(body.student_ids or []))
        if student_ids:
            supabase_admin.table("assignment_enrollments").insert(
                [{"assignment_id": new_id, "user_id": sid} for sid in student_ids]
            ).execute()
        return {
            **_serialize(ins.data[0], body.lecture_ids),
            "student_ids": student_ids,
        }

    try:
        data = await run_in_threadpool(_create)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Assignment create failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to create assignment.")


@router.patch("/{assignment_id}")
@limiter.limit("30/minute")
async def update_assignment(
    request: Request,
    assignment_id: str,
    body: AssignmentUpdate,
    user: Any = Depends(require_professor),
):
    uid = _user_id(user)

    def _update():
        existing = _fetch_assignment(assignment_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Assignment not found.")
        if existing["professor_id"] != uid:
            raise HTTPException(status_code=403, detail="You do not own this assignment.")

        patch: dict[str, Any] = {}
        if body.title is not None:
            patch["title"] = body.title.strip()
        if body.description is not None:
            patch["description"] = body.description.strip() or None
        if body.due_at is not None:
            patch["due_at"] = body.due_at.isoformat()
        # Distinguish "field omitted" from "explicitly set to null". Using
        # model_fields_set lets a client clear min_quiz_score by sending
        # `{"min_quiz_score": null}`; omitting the key leaves it untouched.
        if "min_quiz_score" in body.model_fields_set:
            patch["min_quiz_score"] = body.min_quiz_score

        if patch:
            supabase_admin.table("assignments").update(patch).eq("id", assignment_id).execute()

        if body.lecture_ids is not None:
            _verify_lectures_owned(body.lecture_ids, uid)
            supabase_admin.table("assignment_lectures").delete().eq(
                "assignment_id", assignment_id
            ).execute()
            supabase_admin.table("assignment_lectures").insert(
                [{"assignment_id": assignment_id, "lecture_id": lid} for lid in body.lecture_ids]
            ).execute()

        if body.student_ids is not None:
            new_roster = list(dict.fromkeys(body.student_ids))
            supabase_admin.table("assignment_enrollments").delete().eq(
                "assignment_id", assignment_id
            ).execute()
            if new_roster:
                supabase_admin.table("assignment_enrollments").insert(
                    [{"assignment_id": assignment_id, "user_id": sid} for sid in new_roster]
                ).execute()

        refreshed = _fetch_assignment(assignment_id) or existing
        lecture_ids = _fetch_lecture_ids_for_assignment(assignment_id)
        student_ids = _enrolled_user_ids(assignment_id)
        return {**_serialize(refreshed, lecture_ids), "student_ids": student_ids}

    try:
        data = await run_in_threadpool(_update)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Assignment update failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update assignment.")


@router.delete("/{assignment_id}", status_code=204)
@limiter.limit("30/minute")
async def delete_assignment(
    request: Request,
    assignment_id: str,
    user: Any = Depends(require_professor),
):
    uid = _user_id(user)

    def _delete():
        existing = _fetch_assignment(assignment_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Assignment not found.")
        if existing["professor_id"] != uid:
            raise HTTPException(status_code=403, detail="You do not own this assignment.")
        # ON DELETE CASCADE in the migration removes assignment_lectures rows.
        supabase_admin.table("assignments").delete().eq("id", assignment_id).execute()

    try:
        await run_in_threadpool(_delete)
        return None
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Assignment delete failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to delete assignment.")
