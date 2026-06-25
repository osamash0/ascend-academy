"""Platform Administration API.

Exposes tools for user auditing, activity logs monitoring, error tracking
(via Sentry Web API), course/lecture visibility management, database
backup/restore, and server/deployment diagnostics.
"""
import os
import logging
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.concurrency import run_in_threadpool
import httpx
from pydantic import BaseModel

from backend.core.auth_middleware import (
    _user_id,
    require_role,
    verify_token,
)
from backend.core.database import supabase_admin
from backend.core.rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])

# Secure all endpoints strictly to users with the 'admin' role
require_admin = require_role("admin")


# ── User Auditing & Activity Logs ───────────────────────────────────────────

@router.get("/users")
@limiter.limit("30/minute")
async def list_users(request: Request, user: Any = Depends(require_admin)):
    """List all user profiles along with their assigned roles and aggregate statistics."""
    query = """
        SELECT 
            p.user_id, 
            p.email, 
            p.full_name, 
            p.display_name, 
            p.avatar_url, 
            p.total_xp, 
            p.current_level, 
            p.created_at,
            COALESCE(
                (SELECT json_agg(role) FROM public.user_roles r WHERE r.user_id = p.user_id),
                '[]'::json
            ) as roles
        FROM public.profiles p
        ORDER BY p.created_at DESC;
    """
    try:
        from backend.core.database import db_pool, init_db_pool
        if not db_pool:
            await init_db_pool()
        async with db_pool.acquire() as conn:
            rows = await conn.fetch(query)
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
                    "roles": list(r["roles"]) if r["roles"] else []
                })
            return {"success": True, "data": users_list}
    except Exception as e:
        logger.error("Admin list users failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve users list.")


@router.get("/events")
@limiter.limit("60/minute")
async def list_events(
    request: Request,
    user: Any = Depends(require_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200)
):
    """List paginated user interaction events (logins, slide views, quiz attempts)."""
    offset = (page - 1) * limit
    query = """
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
        ORDER BY e.created_at DESC
        LIMIT $1 OFFSET $2;
    """
    try:
        from backend.core.database import db_pool, init_db_pool
        if not db_pool:
            await init_db_pool()
        async with db_pool.acquire() as conn:
            rows = await conn.fetch(query, limit, offset)
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
            return {"success": True, "data": events}
    except Exception as e:
        logger.error("Admin list events failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load activity logs.")


# ── System Diagnostics & Sentry Error Fetching ──────────────────────────────

@router.get("/errors")
@limiter.limit("30/minute")
async def get_sentry_errors(request: Request, user: Any = Depends(require_admin)):
    """Fetch active issue reports directly from Sentry.
    
    If Sentry API credentials are not set in the environment, returns a mock list
    for local preview along with instructions on how to activate live Sentry integration.
    """
    token = os.environ.get("SENTRY_AUTH_TOKEN")
    org = os.environ.get("SENTRY_ORG")
    project = os.environ.get("SENTRY_PROJECT")
    
    if not token or not org or not project:
        # Sentry API is not configured. Return mock data + configuration details.
        mock_errors = [
            {
                "id": "1",
                "title": "TypeError: Cannot read properties of undefined (reading 'ok')",
                "culprit": "src/pages/LectureUpload.tsx in getCourseOverview",
                "count": 14,
                "userCount": 4,
                "lastSeen": "2026-06-09T14:45:00Z",
                "status": "unresolved",
                "permalink": "https://sentry.io/",
                "level": "error",
                "project": "learnstation-frontend"
            },
            {
                "id": "2",
                "title": "PostgresError: column p.display_name does not exist",
                "culprit": "supabase/migrations/20260503000004_fix_profile_rls_and_leaderboard.sql in public_leaderboard",
                "count": 8,
                "userCount": 8,
                "lastSeen": "2026-06-09T13:20:00Z",
                "status": "unresolved",
                "permalink": "https://sentry.io/",
                "level": "fatal",
                "project": "learnstation-database"
            },
            {
                "id": "3",
                "title": "HTTPException: 403 Insufficient permissions for this action",
                "culprit": "backend/core/auth_middleware.py in require_role",
                "count": 25,
                "userCount": 6,
                "lastSeen": "2026-06-09T14:50:00Z",
                "status": "resolved",
                "permalink": "https://sentry.io/",
                "level": "warning",
                "project": "learnstation-backend"
            }
        ]
        return {
            "success": True,
            "configured": False,
            "config_help": {
                "message": "Sentry Web API integration is pending configuration.",
                "has_token": bool(token)
            },
            "data": mock_errors
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


from sqlmodel.ext.asyncio.session import AsyncSession
from backend.core.database import get_session
from backend.services import course_service
from backend.services import lecture_service

# ── Student Content Visibility (Data Control) ──────────────────────────────

@router.post("/courses/{course_id}/toggle-visibility")
@limiter.limit("30/minute")
async def toggle_course_visibility(
    course_id: str, 
    request: Request, 
    user: Any = Depends(require_admin),
    session: AsyncSession = Depends(get_session)
):
    """Toggle visibility (is_archived status) of a course for students."""
    try:
        success, new_state = await course_service.toggle_course_visibility(session, course_id)
        if not success:
            raise HTTPException(status_code=404, detail="Course not found.")
            
        return {"success": True, "data": {"course_id": course_id, "is_archived": new_state}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Toggle course visibility failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to toggle course visibility.")


@router.post("/lectures/{lecture_id}/toggle-visibility")
@limiter.limit("30/minute")
async def toggle_lecture_visibility(
    lecture_id: str, 
    request: Request, 
    user: Any = Depends(require_admin),
    session: AsyncSession = Depends(get_session)
):
    """Toggle visibility (is_archived status) of a lecture for students."""
    try:
        success, new_state = await lecture_service.toggle_lecture_visibility(session, lecture_id)
        if not success:
            raise HTTPException(status_code=404, detail="Lecture not found.")
            
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

@router.get("/deployment-info")
@limiter.limit("30/minute")
async def get_deployment_info(request: Request, user: Any = Depends(require_admin)):
    """Fetch health checks, server metrics, database connection stats, and Sentry state."""
    try:
        # 1. DB Ping
        db_ok = False
        db_conn_count = 0
        try:
            from backend.core.database import db_pool, init_db_pool
            if not db_pool:
                await init_db_pool()
            async with db_pool.acquire() as conn:
                val = await conn.fetchval("SELECT 1")
                db_ok = (val == 1)
            
            # Fetch database connection count
            async with db_pool.acquire() as conn:
                db_conn_count = await conn.fetchval("SELECT count(*) FROM pg_stat_activity")
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
            "DB_POOL_MIN": "5",
            "DB_POOL_MAX": "20",
            "SENTRY_DSN_CONFIGURED": sentry_ok,
            "GEMINI_KEY_CONFIGURED": ai_ok
        }

        return {
            "success": True,
            "data": {
                "health": {
                    "database": "healthy" if db_ok else "unhealthy",
                    "database_connections": db_conn_count,
                    "ai_services": "connected" if ai_ok else "not_configured",
                    "sentry": "active" if sentry_ok else "disabled",
                    "sentry_dsn": sentry_dsn_redacted
                },
                "system": {
                    "os": os.uname().sysname if hasattr(os, "uname") else "Unknown",
                    "release": os.uname().release if hasattr(os, "uname") else "Unknown",
                    "python_version": os.sys.version.split()[0]
                },
                "deployments": {
                    "migrations_count": migrations_applied,
                    "app_version": "0.1.0-alpha"
                },
                "environment": env_vars
            }
        }
    except Exception as e:
        logger.error("Failed to load deployment info: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve deployment telemetry.")
