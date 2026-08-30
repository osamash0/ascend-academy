"""Platform Administration API.

Exposes tools for user auditing, activity logs monitoring, error tracking
(via Sentry Web API), course/lecture visibility management, database
backup/restore, and server/deployment diagnostics.
"""
import os
import logging
from typing import Any
import json
from fastapi import APIRouter, Depends, HTTPException, Query, Request
import httpx
from pydantic import BaseModel

from fastapi.concurrency import run_in_threadpool

from backend.core.auth_middleware import (
    require_role,
    _user_id,
)
from backend.core.database import supabase_admin, DB_POOL_MIN_SIZE, DB_POOL_MAX_SIZE
from backend.core.rate_limit import limiter
from backend.services.account_service import erase_user_storage_and_derived_data

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])

# Secure all endpoints strictly to users with the 'admin' role
require_admin = require_role("admin")


# ── User Auditing & Activity Logs ───────────────────────────────────────────

@router.get("/users")
@limiter.limit("30/minute")
async def list_users(
    request: Request, 
    user: Any = Depends(require_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    search: str = Query(None),
    role: str = Query(None),
    sort_by: str = Query("created_at"),
    sort_desc: bool = Query(True)
):
    """List all user profiles along with their assigned roles and aggregate statistics."""
    offset = (page - 1) * limit
    order_dir = "DESC" if sort_desc else "ASC"
    
    # Mapping safe sort columns
    sort_mapping = {
        "created_at": "p.created_at",
        "full_name": "p.full_name",
        "total_xp": "p.total_xp",
        "current_level": "p.current_level"
    }
    safe_sort_col = sort_mapping.get(sort_by, "p.created_at")

    where_clauses = []
    params = []
    
    if search:
        params.append(f"%{search}%")
        where_clauses.append(f"(p.full_name ILIKE ${len(params)} OR p.email ILIKE ${len(params)})")
        
    where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
    
    # We use a subquery to filter by role if needed, or join
    # If role filter is active, we add to WHERE
    if role:
        params.append(role)
        where_sql += f"{' AND ' if where_clauses else 'WHERE '}EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.user_id AND ur.role = ${len(params)})"

    # Total count query
    count_query = f"SELECT count(*) FROM public.profiles p {where_sql}"

    query = f"""
        SELECT 
            p.user_id, 
            p.email, 
            p.full_name, 
            p.display_name, 
            p.avatar_url, 
            p.total_xp, 
            p.current_level, 
            p.created_at,
            (SELECT max(created_at) FROM public.learning_events e WHERE e.user_id = p.user_id) as last_seen,
            COALESCE(
                (SELECT json_agg(ur.role) FROM public.user_roles ur WHERE ur.user_id = p.user_id),
                '[]'::json
            ) as roles
        FROM public.profiles p
        {where_sql}
        ORDER BY {safe_sort_col} {order_dir} NULLS LAST
        LIMIT ${len(params) + 1} OFFSET ${len(params) + 2};
    """
    try:
        from backend.core.database import db_pool, init_db_pool
        if not db_pool:
            await init_db_pool()
        async with db_pool.acquire() as conn:
            total_count = await conn.fetchval(count_query, *params)
            
            # Execute main query
            query_params = params + [limit, offset]
            rows = await conn.fetch(query, *query_params)
            
            users_list = []
            for r in rows:
                users_list.append({
                    "user_id": str(r["user_id"]),
                    "email": r["email"],
                    "full_name": r["full_name"],
                    "display_name": r["display_name"],
                    "avatar_url": r["avatar_url"],
                    "total_xp": r["total_xp"],
                    "current_level": r["current_level"],
                    "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                    "last_seen": r["last_seen"].isoformat() if r["last_seen"] else None,
                    "roles": json.loads(r["roles"]) if r["roles"] else []
                })
            return {
                "success": True, 
                "data": users_list,
                "meta": {
                    "total": total_count,
                    "page": page,
                    "limit": limit,
                    "total_pages": (total_count + limit - 1) // limit
                }
            }
    except Exception as e:
        logger.error("Admin list users failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve users list.")
        
class RoleManagementRequest(BaseModel):
    action: str
    role: str

@router.post("/users/{target_user_id}/roles")
@limiter.limit("10/minute")
async def manage_user_roles(target_user_id: str, body: RoleManagementRequest, request: Request, user: Any = Depends(require_admin)):
    """Add or remove a role from a user."""
    if body.action not in ("add", "remove"):
        raise HTTPException(status_code=400, detail="Action must be 'add' or 'remove'")
    
    if body.role not in ("admin", "professor", "student"):
        raise HTTPException(status_code=400, detail="Invalid role specified")
        
    try:
        from backend.core.database import db_pool, init_db_pool
        if not db_pool:
            await init_db_pool()
        async with db_pool.acquire() as conn:
            if body.action == "add":
                # Check if role exists
                exists = await conn.fetchval("SELECT 1 FROM public.user_roles WHERE user_id = $1 AND role = $2", target_user_id, body.role)
                if not exists:
                    await conn.execute("INSERT INTO public.user_roles (user_id, role) VALUES ($1, $2)", target_user_id, body.role)
            elif body.action == "remove":
                # Don't let the last admin remove their own admin role
                if body.role == "admin" and target_user_id == user["id"]:
                    admin_count = await conn.fetchval("SELECT count(*) FROM public.user_roles WHERE role = 'admin'")
                    if admin_count <= 1:
                        raise HTTPException(status_code=400, detail="Cannot remove the last admin")
                await conn.execute("DELETE FROM public.user_roles WHERE user_id = $1 AND role = $2", target_user_id, body.role)
                
            # Fetch updated roles
            rows = await conn.fetch("SELECT role FROM public.user_roles WHERE user_id = $1", target_user_id)
            roles = [r["role"] for r in rows]
            
            return {"success": True, "data": {"user_id": target_user_id, "roles": roles}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Admin role management failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update user roles.")

@router.get("/users/{target_user_id}/detail")
@limiter.limit("30/minute")
async def get_user_detail(target_user_id: str, request: Request, user: Any = Depends(require_admin)):
    """Get full user details including recent activity, courses, etc."""
    try:
        from backend.core.database import db_pool, init_db_pool
        if not db_pool:
            await init_db_pool()
        async with db_pool.acquire() as conn:
            # Get profile
            p_row = await conn.fetchrow("""
                SELECT p.*,
                (SELECT json_agg(role) FROM public.user_roles ur WHERE ur.user_id = p.user_id) as roles
                FROM public.profiles p WHERE p.user_id = $1
            """, target_user_id)
            
            if not p_row:
                raise HTTPException(status_code=404, detail="User not found")
                
            profile = dict(p_row)
            if profile.get("created_at"): profile["created_at"] = profile["created_at"].isoformat()
            if profile.get("updated_at"): profile["updated_at"] = profile["updated_at"].isoformat()
            if profile.get("roles"): profile["roles"] = json.loads(profile["roles"])
            else: profile["roles"] = []
            
            # Get recent events
            e_rows = await conn.fetch("""
                SELECT id, event_type, created_at, event_data
                FROM public.learning_events
                WHERE user_id = $1
                ORDER BY created_at DESC LIMIT 10
            """, target_user_id)
            
            events = []
            for r in e_rows:
                events.append({
                    "id": str(r["id"]),
                    "event_type": r["event_type"],
                    "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                    "event_data": r["event_data"]
                })
                
            # Get LLM spend
            from backend.services.ai.cost import get_user_monthly_spend_from_db
            try:
                spend_usd = await get_user_monthly_spend_from_db(target_user_id)
            except:
                spend_usd = 0.0
                
            return {
                "success": True, 
                "data": {
                    "profile": profile,
                    "recent_events": events,
                    "monthly_spend_usd": round(spend_usd, 6)
                }
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Admin user detail failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve user detail.")


@router.get("/events")
@limiter.limit("60/minute")
async def list_events(
    request: Request,
    user: Any = Depends(require_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    event_type: str = Query(None),
    date_from: str = Query(None),
    date_to: str = Query(None),
    search: str = Query(None)
):
    """List paginated user interaction events with filters."""
    offset = (page - 1) * limit
    
    where_clauses = []
    params = []
    
    if event_type:
        params.append(event_type)
        where_clauses.append(f"e.event_type = ${len(params)}")
        
    if date_from:
        params.append(date_from)
        where_clauses.append(f"e.created_at >= ${len(params)}::timestamp")
        
    if date_to:
        params.append(date_to)
        where_clauses.append(f"e.created_at <= ${len(params)}::timestamp")
        
    if search:
        params.append(f"%{search}%")
        where_clauses.append(f"(p.email ILIKE ${len(params)} OR p.full_name ILIKE ${len(params)} OR p.display_name ILIKE ${len(params)})")
        
    where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""

    count_query = f"""
        SELECT count(*) 
        FROM public.learning_events e
        LEFT JOIN public.profiles p ON p.user_id = e.user_id
        {where_sql}
    """

    query = f"""
        SELECT 
            e.id, 
            e.user_id, 
            e.event_type, 
            e.event_data, 
            e.created_at,
            p.email as user_email,
            p.display_name as user_name
        FROM public.learning_events e
        LEFT JOIN public.profiles p ON p.user_id = e.user_id
        {where_sql}
        ORDER BY e.created_at DESC
        LIMIT ${len(params) + 1} OFFSET ${len(params) + 2};
    """
    try:
        from backend.core.database import db_pool, init_db_pool
        if not db_pool:
            await init_db_pool()
        async with db_pool.acquire() as conn:
            total_count = await conn.fetchval(count_query, *params)
            
            query_params = params + [limit, offset]
            rows = await conn.fetch(query, *query_params)
            
            events = []
            for r in rows:
                events.append({
                    "id": str(r["id"]),
                    "user_id": str(r["user_id"]),
                    "event_type": r["event_type"],
                    "event_data": r["event_data"],
                    "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                    "user_email": r["user_email"],
                    "user_name": r["user_name"]
                })
            return {
                "success": True, 
                "data": events,
                "meta": {
                    "total": total_count,
                    "page": page,
                    "limit": limit,
                    "total_pages": (total_count + limit - 1) // limit
                }
            }
    except Exception as e:
        logger.error("Admin list events failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load activity logs.")


# ── System Diagnostics & Sentry Error Fetching ──────────────────────────────

@router.get("/errors")
@limiter.limit("30/minute")
async def get_sentry_errors(request: Request, user: Any = Depends(require_admin)):
    """Fetch active issue reports directly from Sentry.

    If Sentry API credentials are not set in the environment, there is no live
    error data to show. Returns an empty issue list plus `configured: false`
    and `config_help` explaining what to set — never fabricated incidents, since
    an admin cannot visually distinguish a real outage from an invented one.
    """
    token = os.environ.get("SENTRY_AUTH_TOKEN")
    org = os.environ.get("SENTRY_ORG")
    project = os.environ.get("SENTRY_PROJECT")

    if not token or not org or not project:
        # Sentry API is not configured. No real error data exists to show, so
        # return an empty list rather than fabricated issues.
        return {
            "success": True,
            "configured": False,
            "config_help": {
                "message": "Sentry Web API integration is not configured. Set SENTRY_AUTH_TOKEN, SENTRY_ORG, and SENTRY_PROJECT to enable live error monitoring.",
                "org": org,
                "project": project,
                "has_token": bool(token)
            },
            "data": []
        }

    # If configured, make HTTP call to Sentry API
    try:
        url = f"https://sentry.io/api/0/projects/{org}/{project}/issues/"
        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers, timeout=10.0)
            if response.status_code == 200:
                sentry_data = response.json()
                errors_list = []
                for issue in sentry_data:
                    errors_list.append({
                        "id": issue.get("id"),
                        "title": issue.get("title"),
                        "culprit": issue.get("culprit"),
                        "count": int(issue.get("count", 0)),
                        "userCount": int(issue.get("userCount", 0)),
                        "lastSeen": issue.get("lastSeen"),
                        "status": issue.get("status"),
                        "permalink": issue.get("permalink", "https://sentry.io/"),
                        "level": issue.get("level"),
                        "project": project
                    })
                return {"success": True, "configured": True, "data": errors_list}
            else:
                logger.warning("Sentry API request failed with status %d: %s", response.status_code, response.text)
                return {
                    "success": False,
                    "configured": False,
                    "error": f"Sentry API returned status {response.status_code}"
                }
    except Exception as e:
        logger.error("Sentry fetch failed: %s", e, exc_info=True)
        return {
            "success": False,
            "configured": False,
            "error": str(e)
        }


# ── Account Deletion (guarded) ─────────────────────────────────────────────

class UserDeletionRequest(BaseModel):
    user_ids: list[str]


def _owned_content_counts(uid: str) -> dict[str, int]:
    """Courses and lectures this user owns, plus students who'd lose progress.

    Both courses.professor_id and lectures.professor_id are ON DELETE CASCADE
    against auth.users, so these numbers ARE the blast radius of deleting the
    account — not a related statistic. lectures.student_owner_id cascades the
    same way for private student uploads.
    """
    courses = (
        supabase_admin.table("courses").select("id").eq("professor_id", uid).execute().data or []
    )
    lectures_as_prof = (
        supabase_admin.table("lectures").select("id").eq("professor_id", uid).execute().data or []
    )
    lectures_as_student = (
        supabase_admin.table("lectures").select("id").eq("student_owner_id", uid).execute().data or []
    )

    course_ids = [c["id"] for c in courses]
    students: set[str] = set()
    if course_ids:
        enrollments = (
            supabase_admin.table("course_enrollments")
            .select("user_id")
            .in_("course_id", course_ids)
            .execute()
            .data
            or []
        )
        students = {e["user_id"] for e in enrollments if e.get("user_id") != uid}

    # A lecture can be counted once under each column only if both were set,
    # which the schema's XOR constraint forbids — so a plain sum is safe.
    return {
        "courses": len(courses),
        "lectures": len(lectures_as_prof) + len(lectures_as_student),
        "students_affected": len(students),
    }


def _admin_user_ids() -> set[str]:
    rows = (
        supabase_admin.table("user_roles").select("user_id").eq("role", "admin").execute().data or []
    )
    return {r["user_id"] for r in rows}


def _assess(uid: str, caller_id: str, surviving_admins: set[str]) -> dict[str, Any]:
    """Decide whether `uid` may be deleted, and why not if it may not.

    Order matters: self and last-admin are cheap identity checks, and both
    are about not locking the operator out. Ownership is the expensive one
    and the one that protects everyone else's data.
    """
    counts = _owned_content_counts(uid)
    verdict: dict[str, Any] = {"user_id": uid, **counts, "deletable": True, "reason": None}

    if uid == caller_id:
        verdict.update(deletable=False, reason="self")
    elif uid in surviving_admins and len(surviving_admins - {uid}) == 0:
        verdict.update(deletable=False, reason="last_admin")
    elif counts["courses"] or counts["lectures"]:
        verdict.update(deletable=False, reason="owns_content")

    return verdict


@router.post("/users/deletion-impact")
@limiter.limit("30/minute")
async def user_deletion_impact(
    body: UserDeletionRequest,
    request: Request,
    user: Any = Depends(require_admin),
):
    """What deleting these accounts would destroy. Changes nothing."""
    caller_id = _user_id(user)
    admins = await run_in_threadpool(_admin_user_ids)

    def _assess_all() -> list[dict[str, Any]]:
        return [_assess(uid, caller_id, admins) for uid in body.user_ids]

    try:
        return {"success": True, "data": await run_in_threadpool(_assess_all)}
    except Exception as e:
        logger.error("Deletion impact check failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to assess deletion impact.")


@router.post("/users/delete")
@limiter.limit("5/minute")
async def delete_users(
    body: UserDeletionRequest,
    request: Request,
    user: Any = Depends(require_admin),
):
    """Permanently delete accounts that own no content.

    Reuses the erasure path behind /auth/delete-account rather than a second
    implementation: storage cleanup MUST run before the auth.users row is
    removed (it reads lectures rows the cascade would otherwise delete first)
    and it is dedup-aware, so a PDF blob shared with another user is retained.

    Guardrails are re-evaluated HERE rather than trusted from the caller's
    earlier impact check — the preview is advisory, this is the gate.
    """
    caller_id = _user_id(user)
    admins = await run_in_threadpool(_admin_user_ids)
    surviving = set(admins)

    deleted: list[str] = []
    blocked: list[dict[str, Any]] = []

    for uid in body.user_ids:
        verdict = await run_in_threadpool(_assess, uid, caller_id, surviving)
        if not verdict["deletable"]:
            blocked.append(verdict)
            continue

        try:
            # Non-fatal, exactly as in /auth/delete-account: failing to clear
            # storage must not block removal of the DB-resident data.
            await erase_user_storage_and_derived_data(uid)
        except Exception as e:
            logger.error("Admin erasure storage cleanup failed for %s: %s", uid, e)

        try:
            await run_in_threadpool(supabase_admin.auth.admin.delete_user, uid)
        except Exception as e:
            logger.error("Admin account deletion failed for %s: %s", uid, e)
            blocked.append({**verdict, "deletable": False, "reason": "delete_failed"})
            continue

        deleted.append(uid)
        surviving.discard(uid)
        logger.info("Admin %s deleted account %s", caller_id, uid)

    return {"success": True, "data": {"deleted": deleted, "blocked": blocked}}


# ── Content Inventory (Attribution & Visibility Diagnostics) ───────────────

@router.get("/content")
@limiter.limit("30/minute")
async def list_content(
    request: Request,
    user: Any = Depends(require_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    search: str = Query(None),
    kind: str = Query(None, description="'course' or 'lecture'"),
    owner: str = Query(None, description="owner user_id"),
    archived: bool = Query(None),
):
    """Every course and lecture on the platform, with its owner resolved.

    Runs as the service role, so it deliberately bypasses RLS: the point is
    to show ground truth, not what the calling admin's own policies happen
    to permit. (The dashboard's previous client-side select ran under the
    caller's RLS and could silently omit content owned by others.)

    On visibility, this reports the *inputs* — enrolment count, is_archived,
    visibility, course_id, duplicate titles — and deliberately does NOT
    compute a "hidden because X" verdict. Doing so would mean reimplementing
    the RLS predicates here, where they would silently go stale the next
    time a policy migration lands. Facts don't drift; a duplicated rules
    engine does.
    """
    offset = (page - 1) * limit

    # Ownership is a two-column XOR: course content carries professor_id,
    # private student uploads carry student_owner_id (see migration
    # 20260710040000_student_uploads.sql). Collapse both into one owner_id
    # so a row is attributable no matter which upload path created it.
    cte = """
        WITH content_rows AS (
            SELECT
                c.id,
                'course'::text    AS kind,
                c.title,
                c.is_archived,
                NULL::uuid        AS course_id,
                NULL::text        AS visibility,
                c.professor_id    AS owner_id,
                'professor'::text AS owner_kind,
                c.created_at
            FROM public.courses c
            UNION ALL
            SELECT
                l.id,
                'lecture'::text,
                l.title,
                l.is_archived,
                l.course_id,
                l.visibility,
                COALESCE(l.professor_id, l.student_owner_id),
                CASE WHEN l.student_owner_id IS NOT NULL
                     THEN 'student'::text ELSE 'professor'::text END,
                l.created_at
            FROM public.lectures l
        )
    """
    base_from = """
        FROM content_rows r
        LEFT JOIN public.profiles p ON p.user_id = r.owner_id
        LEFT JOIN public.courses cc ON cc.id = r.course_id
    """

    where_clauses = []
    params: list[Any] = []

    if search:
        params.append(f"%{search}%")
        where_clauses.append(
            f"(r.title ILIKE ${len(params)} OR p.email ILIKE ${len(params)}"
            f" OR p.full_name ILIKE ${len(params)})"
        )
    if kind in ("course", "lecture"):
        params.append(kind)
        where_clauses.append(f"r.kind = ${len(params)}")
    if owner:
        params.append(owner)
        where_clauses.append(f"r.owner_id = ${len(params)}::uuid")
    if archived is not None:
        params.append(archived)
        where_clauses.append(f"r.is_archived = ${len(params)}")

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    count_query = f"{cte} SELECT count(*) {base_from} {where_sql}"
    query = f"""
        {cte}
        SELECT
            r.id,
            r.kind,
            r.title,
            r.is_archived,
            r.course_id,
            r.visibility,
            r.owner_id,
            r.owner_kind,
            r.created_at,
            p.email     AS owner_email,
            p.full_name AS owner_name,
            cc.title    AS course_title,
            (SELECT count(*) FROM public.lectures l2
              WHERE r.kind = 'course' AND l2.course_id = r.id) AS lecture_count,
            (SELECT count(*) FROM public.course_enrollments ce
              WHERE ce.course_id = CASE WHEN r.kind = 'course'
                                        THEN r.id ELSE r.course_id END) AS enrollment_count,
            -- Deliberately correlated against the UNFILTERED CTE: a title is
            -- still a duplicate even when the sibling row is excluded by the
            -- caller's current filter. Computing this over the filtered set
            -- would hide exactly the case worth surfacing.
            (SELECT count(*) > 1 FROM content_rows d
              WHERE d.kind = r.kind AND lower(d.title) = lower(r.title)) AS duplicate_title
        {base_from}
        {where_sql}
        ORDER BY r.created_at DESC NULLS LAST
        LIMIT ${len(params) + 1} OFFSET ${len(params) + 2};
    """

    try:
        from backend.core.database import db_pool, init_db_pool
        if not db_pool:
            await init_db_pool()
        async with db_pool.acquire() as conn:
            total_count = await conn.fetchval(count_query, *params) or 0
            rows = await conn.fetch(query, *(params + [limit, offset]))

            items = []
            for r in rows:
                items.append({
                    "id": str(r["id"]),
                    "kind": r["kind"],
                    "title": r["title"],
                    "is_archived": r["is_archived"],
                    "course_id": str(r["course_id"]) if r["course_id"] else None,
                    "course_title": r["course_title"],
                    "visibility": r["visibility"],
                    "owner_id": str(r["owner_id"]) if r["owner_id"] else None,
                    "owner_kind": r["owner_kind"],
                    "owner_email": r["owner_email"],
                    "owner_name": r["owner_name"],
                    "lecture_count": r["lecture_count"],
                    "enrollment_count": r["enrollment_count"],
                    "duplicate_title": r["duplicate_title"],
                    "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                })
            return {
                "success": True,
                "data": items,
                "meta": {
                    "total": total_count,
                    "page": page,
                    "limit": limit,
                    "total_pages": (total_count + limit - 1) // limit,
                },
            }
    except Exception as e:
        logger.error("Admin list content failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve content inventory.")


# ── Student Content Visibility (Data Control) ──────────────────────────────

@router.post("/courses/{course_id}/toggle-visibility")
@limiter.limit("30/minute")
async def toggle_course_visibility(course_id: str, request: Request, user: Any = Depends(require_admin)):
    """Toggle visibility (is_archived status) of a course for students."""
    try:
        res = supabase_admin.table("courses").select("is_archived").eq("id", course_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Course not found.")
        
        current_state = res.data[0]["is_archived"]
        new_state = not current_state
        
        supabase_admin.table("courses").update({"is_archived": new_state}).eq("id", course_id).execute()
        return {"success": True, "data": {"course_id": course_id, "is_archived": new_state}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Toggle course visibility failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to toggle course visibility.")


@router.post("/lectures/{lecture_id}/toggle-visibility")
@limiter.limit("30/minute")
async def toggle_lecture_visibility(lecture_id: str, request: Request, user: Any = Depends(require_admin)):
    """Toggle visibility (is_archived status) of a lecture for students."""
    try:
        res = supabase_admin.table("lectures").select("is_archived").eq("id", lecture_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Lecture not found.")
        
        current_state = res.data[0]["is_archived"]
        new_state = not current_state
        
        supabase_admin.table("lectures").update({"is_archived": new_state}).eq("id", lecture_id).execute()
        return {"success": True, "data": {"lecture_id": lecture_id, "is_archived": new_state}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Toggle lecture visibility failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to toggle lecture visibility.")


# ── Analytics Reset & Snapshots (Backup & Restore) ─────────────────────────

class ResetAnalyticsRequest(BaseModel):
    confirmation: str

@router.post("/reset-analytics")
@limiter.limit("5/minute")
async def reset_analytics(body: ResetAnalyticsRequest, request: Request, user: Any = Depends(require_admin)):
    """Trigger the public.reset_all_analytics stored procedure to clear data after backup."""
    if body.confirmation != "RESET_ALL_DATA":
        raise HTTPException(status_code=400, detail="Invalid confirmation string. Must be 'RESET_ALL_DATA'.")
    try:
        res = supabase_admin.rpc("reset_all_analytics").execute()
        backup_id = res.data
        return {"success": True, "message": "Analytics database successfully reset and snapshotted.", "backup_id": backup_id}
    except Exception as e:
        logger.error("Reset analytics RPC failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to execute analytics reset stored procedure.")


@router.get("/backups")
@limiter.limit("30/minute")
async def get_backups(request: Request, user: Any = Depends(require_admin)):
    """Get all saved database backups along with their sizes in bytes."""
    query = """
        SELECT 
            id, 
            created_at, 
            pg_column_size(backup_data) as size_bytes
        FROM public.analytics_backups
        ORDER BY created_at DESC;
    """
    try:
        from backend.core.database import db_pool, init_db_pool
        if not db_pool:
            await init_db_pool()
        async with db_pool.acquire() as conn:
            rows = await conn.fetch(query)
            backups = []
            for r in rows:
                backups.append({
                    "id": str(r["id"]),
                    "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                    "size_bytes": r["size_bytes"]
                })
            return {"success": True, "data": backups}
    except Exception as e:
        logger.error("Admin list backups failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve database backups.")


class RestoreBackupRequest(BaseModel):
    confirmation: str

@router.post("/backups/{backup_id}/restore")
@limiter.limit("5/minute")
async def restore_backup(backup_id: str, body: RestoreBackupRequest, request: Request, user: Any = Depends(require_admin)):
    """Call the restore_analytics RPC to restore all analytical data from a snapshot."""
    if body.confirmation != "RESTORE_DATA":
        raise HTTPException(status_code=400, detail="Invalid confirmation string. Must be 'RESTORE_DATA'.")
    try:
        # Before calling RPC, ensure backup exists to prevent 500
        from backend.core.database import db_pool, init_db_pool
        if not db_pool:
            await init_db_pool()
        async with db_pool.acquire() as conn:
            val = await conn.fetchval("SELECT 1 FROM analytics_backups WHERE id = $1", backup_id)
            if not val:
                raise HTTPException(status_code=404, detail="Backup not found.")
        
        res = supabase_admin.rpc("restore_analytics", {"p_backup_id": backup_id}).execute()
        return {"success": True, "message": f"Backup {backup_id} successfully restored."}
    except Exception as e:
        logger.error("Restore backup RPC failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to restore backup snapshot.")


@router.delete("/backups/{backup_id}")
@limiter.limit("10/minute")
async def delete_backup(backup_id: str, request: Request, user: Any = Depends(require_admin)):
    """Permanently delete an analytics backup."""
    try:
        supabase_admin.table("analytics_backups").delete().eq("id", backup_id).execute()
        return {"success": True, "message": f"Backup {backup_id} permanently deleted."}
    except Exception as e:
        logger.error("Delete backup failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to delete backup.")


# ── System Diagnostics & Deployment Telemetry ───────────────────────────────

def _get_app_version() -> str:
    """Read the real app version from the repo's package.json (the single
    source of truth other tooling already uses), instead of a hardcoded
    literal that silently drifts from reality."""
    try:
        repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
        with open(os.path.join(repo_root, "package.json"), "r") as f:
            return json.load(f).get("version", "unknown")
    except Exception as e:
        logger.warning("Could not read app version from package.json: %s", e)
        return "unknown"


@router.get("/deployment-info")
@limiter.limit("30/minute")
async def get_deployment_info(request: Request, user: Any = Depends(require_admin)):
    """Fetch health checks, server metrics, database connection stats, and Sentry state."""
    try:
        # 1. DB Ping
        db_ok = False
        # Report THIS app's own pool usage (checked-out vs. its real min/max),
        # not `pg_stat_activity`'s server-wide count — that includes every
        # other client connected to the same Postgres instance and has no
        # relationship to our pool's max_size, which made the previous
        # "N / 20 used" readout meaningless (and silently clamped to 100%).
        db_pool_active = 0
        db_pool_min = DB_POOL_MIN_SIZE
        db_pool_max = DB_POOL_MAX_SIZE
        try:
            from backend.core.database import db_pool, init_db_pool
            if not db_pool:
                await init_db_pool()
            async with db_pool.acquire() as conn:
                val = await conn.fetchval("SELECT 1")
                db_ok = (val == 1)

            if db_pool:
                db_pool_active = db_pool.get_size() - db_pool.get_idle_size()
                db_pool_min = db_pool.get_min_size()
                db_pool_max = db_pool.get_max_size()
        except Exception as dbe:
            logger.warning("DB ping failed: %s", dbe)
        
        # 2. AI Connection Check
        ai_ok = False
        try:
            gemini_key = os.environ.get("GEMINI_API_KEY")
            ai_ok = bool(gemini_key)
        except Exception as aie:
            logger.warning("AI status check failed: %s", aie)

        # 3. Sentry Status
        sentry_ok = bool(os.environ.get("SENTRY_DSN"))
        sentry_dsn_redacted = ""
        if sentry_ok:
            dsn = os.environ.get("SENTRY_DSN")
            sentry_dsn_redacted = dsn[:15] + "..." + dsn[-10:] if len(dsn) > 25 else dsn

        # 4. Migration Check
        migrations_applied = 0
        try:
            migrations_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "supabase", "migrations")
            if os.path.exists(migrations_dir):
                migrations_applied = len([f for f in os.listdir(migrations_dir) if f.endswith(".sql")])
        except Exception:
            pass

        # 5. Environment vars (redacted for security)
        env_vars = {
            "ENVIRONMENT": os.environ.get("ENVIRONMENT", "development"),
            "PORT": os.environ.get("PORT", "8000"),
            "DB_POOL_MIN": str(db_pool_min),
            "DB_POOL_MAX": str(db_pool_max),
            "SENTRY_DSN_CONFIGURED": sentry_ok,
            "GEMINI_KEY_CONFIGURED": ai_ok
        }

        return {
            "success": True,
            "data": {
                "health": {
                    "database": "healthy" if db_ok else "unhealthy",
                    "database_connections": db_pool_active,
                    "ai_services": "connected" if ai_ok else "not_configured",
                    "sentry": "active" if sentry_ok else "disabled",
                    "sentry_dsn": sentry_dsn_redacted,
                    # Real signal, not a fabricated uptime %: the platform API is
                    # only as healthy as the critical dependency checked above.
                    "api": "healthy" if db_ok else "degraded"
                },
                "system": {
                    "os": os.uname().sysname if hasattr(os, "uname") else "Unknown",
                    "release": os.uname().release if hasattr(os, "uname") else "Unknown",
                    "python_version": os.sys.version.split()[0]
                },
                "deployments": {
                    "migrations_count": migrations_applied,
                    "app_version": _get_app_version()
                },
                "environment": env_vars
            }
        }
    except Exception as e:
        logger.error("Failed to load deployment info: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve deployment telemetry.")


# ── LLM cost accounting (Roadmap Foundation 10x, Phase 1 P1-1) ─────────────

@router.get("/llm-spend/{user_id}")
@limiter.limit("30/minute")
async def get_user_llm_spend(user_id: str, request: Request, user: Any = Depends(require_admin)):
    """Authoritative (DB-backed) LLM spend for `user_id` for the current UTC
    calendar month — sums public.llm_calls.est_cost_usd. Only reflects calls
    made through a code path that passed `user_id` to generate_text/
    generate_text_bulk (not every orchestrator call site does this yet)."""
    from backend.services.ai.cost import get_user_monthly_spend_from_db
    try:
        spend_usd = await get_user_monthly_spend_from_db(user_id)
        return {"user_id": user_id, "monthly_spend_usd": round(spend_usd, 6)}
    except Exception as e:
        logger.error("Failed to load LLM spend for user %s: %s", user_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve LLM spend.")


@router.get("/platform-stats")
@limiter.limit("30/minute")
async def get_platform_stats(request: Request, user: Any = Depends(require_admin)):
    """Fetch high-level KPI aggregate statistics for the platform."""
    try:
        from backend.core.database import db_pool, init_db_pool
        if not db_pool:
            await init_db_pool()
            
        async with db_pool.acquire() as conn:
            # 1. Total users and role breakdown
            total_users = await conn.fetchval("SELECT count(*) FROM public.profiles")
            professors = await conn.fetchval("SELECT count(DISTINCT user_id) FROM public.user_roles WHERE role = 'professor'")
            admins = await conn.fetchval("SELECT count(DISTINCT user_id) FROM public.user_roles WHERE role = 'admin'")
            students = (total_users or 0) - (professors or 0) - (admins or 0)
            if students < 0:
                students = 0
            
            # 2. Active sessions (last 24h events)
            active_24h = await conn.fetchval("SELECT count(DISTINCT user_id) FROM public.learning_events WHERE created_at >= NOW() - INTERVAL '24 hours'")
            
            # 3. Content stats
            total_courses = await conn.fetchval("SELECT count(*) FROM public.courses")
            total_lectures = await conn.fetchval("SELECT count(*) FROM public.lectures")
            
            # 4. Total LLM Cost (approximated for all users this month)
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            
            start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            
            try:
                total_llm_cost = await conn.fetchval(
                    "SELECT SUM(est_cost_usd) FROM public.llm_calls WHERE created_at >= $1", 
                    start_of_month
                )
                total_llm_cost = round(total_llm_cost, 4) if total_llm_cost else 0.0
            except Exception as e:
                logger.warning(f"Failed to fetch LLM cost: {e}")
                total_llm_cost = 0.0

        return {
            "success": True,
            "data": {
                "users": {
                    "total": total_users,
                    "professors": professors,
                    "admins": admins,
                    "students": students,
                    "active_24h": active_24h
                },
                "content": {
                    "courses": total_courses,
                    "lectures": total_lectures
                },
                "financial": {
                    "month_llm_cost_usd": total_llm_cost
                }
            }
        }
    except Exception as e:
        logger.error("Failed to load platform stats: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve platform stats.")
