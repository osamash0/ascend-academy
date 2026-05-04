"""Worksheets API.

A worksheet is a single supporting file (PDF/doc) attached to a lecture.
Files live in the private `worksheets` storage bucket; this API stores
metadata rows and exposes signed download URLs.

Endpoints:
    GET    /api/lectures/{lecture_id}/worksheets        — list
    POST   /api/lectures/{lecture_id}/worksheets        — multipart upload
    PATCH  /api/worksheets/{worksheet_id}               — rename
    DELETE /api/worksheets/{worksheet_id}               — remove (file + row)
    GET    /api/worksheets/{worksheet_id}/download_url  — signed URL for student/professor
"""
from __future__ import annotations

import logging
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
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
router = APIRouter(tags=["worksheets"])

# 25 MB upper bound per worksheet to mirror typical doc/PDF size and keep
# the request bounded. Adjust together with bucket-level limits if changed.
MAX_BYTES = 25 * 1024 * 1024
ALLOWED_MIME = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "text/csv",
    "image/png",
    "image/jpeg",
}


def _sanitize_filename(name: str) -> str:
    """Strip path separators and unsafe chars; collapse whitespace."""
    base = name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    base = re.sub(r"[^A-Za-z0-9._\-]+", "_", base).strip("._")
    return base or "worksheet"


def _fetch_lecture(lecture_id: str) -> Optional[dict]:
    res = (
        supabase_admin.table("lectures")
        .select("id, professor_id")
        .eq("id", lecture_id)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _fetch_worksheet(worksheet_id: str) -> Optional[dict]:
    res = (
        supabase_admin.table("worksheets")
        .select("id, lecture_id, title, file_url, file_type, size_bytes, uploaded_by, created_at, updated_at")
        .eq("id", worksheet_id)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _user_can_read_lecture(user_id: str, lecture: dict) -> bool:
    """Owner OR enrolled-via-assignment student."""
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


# ── Models ──────────────────────────────────────────────────────────────────

class WorksheetUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/api/lectures/{lecture_id}/worksheets")
@limiter.limit("120/minute")
async def list_worksheets(
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
        rows = (
            supabase_admin.table("worksheets")
            .select("id, lecture_id, title, file_url, file_type, size_bytes, uploaded_by, created_at, updated_at")
            .eq("lecture_id", lecture_id)
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        )
        return rows

    try:
        data = await run_in_threadpool(_load)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Worksheets list failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load worksheets.")


@router.post("/api/lectures/{lecture_id}/worksheets", status_code=201)
@limiter.limit("20/minute")
async def upload_worksheet(
    request: Request,
    lecture_id: str,
    file: UploadFile = File(...),
    title: Optional[str] = Form(default=None),
    user: Any = Depends(require_professor),
):
    uid = _user_id(user)
    if file.content_type and file.content_type not in ALLOWED_MIME:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file.content_type}",
        )

    # Cheap pre-check via Content-Length when the client sends one — lets
    # us reject obvious oversize uploads without buffering anything.
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > MAX_BYTES + 4096:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds {MAX_BYTES // (1024 * 1024)} MB limit.",
        )

    # Bounded streaming read: stop as soon as we cross the limit, so a
    # malicious client cannot force us to buffer arbitrary bytes in memory.
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File exceeds {MAX_BYTES // (1024 * 1024)} MB limit.",
            )
        chunks.append(chunk)
    raw = b"".join(chunks)
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file.")

    safe_name = _sanitize_filename(file.filename or "worksheet")
    final_title = (title or safe_name).strip() or safe_name

    def _create():
        lec = _fetch_lecture(lecture_id)
        if not lec:
            raise HTTPException(status_code=404, detail="Lecture not found.")
        if lec["professor_id"] != uid:
            raise HTTPException(status_code=403, detail="You do not own this lecture.")

        # Insert metadata first to obtain a stable id, then upload to a
        # path keyed off the worksheet id. This keeps storage and DB rows
        # in lockstep and matches the RLS path convention
        # `worksheets/{lectureId}/...`.
        ins = (
            supabase_admin.table("worksheets")
            .insert(
                {
                    "lecture_id": lecture_id,
                    "title": final_title,
                    "file_url": "",  # placeholder, filled after upload
                    "file_type": file.content_type or "application/octet-stream",
                    "size_bytes": len(raw),
                    "uploaded_by": uid,
                }
            )
            .execute()
        )
        if not ins.data:
            raise HTTPException(status_code=500, detail="Failed to create worksheet row.")
        ws = ins.data[0]
        path = f"worksheets/{lecture_id}/{ws['id']}_{safe_name}"
        content_type = file.content_type or "application/octet-stream"
        try:
            try:
                supabase_admin.storage.from_("worksheets").upload(
                    path,
                    raw,
                    {"content-type": content_type},
                )
            except TypeError:
                # Older supabase-py releases accept only (path, file).
                supabase_admin.storage.from_("worksheets").upload(path, raw)
        except Exception as e:
            # Roll back the metadata row so we don't leave orphans.
            supabase_admin.table("worksheets").delete().eq("id", ws["id"]).execute()
            logger.error("Worksheet upload to storage failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail="Failed to upload file.")
        supabase_admin.table("worksheets").update({"file_url": path}).eq(
            "id", ws["id"]
        ).execute()
        ws["file_url"] = path
        return ws

    try:
        data = await run_in_threadpool(_create)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Worksheet upload failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to upload worksheet.")


@router.patch("/api/worksheets/{worksheet_id}")
@limiter.limit("60/minute")
async def update_worksheet(
    request: Request,
    worksheet_id: str,
    body: WorksheetUpdate,
    user: Any = Depends(require_professor),
):
    uid = _user_id(user)

    def _update():
        ws = _fetch_worksheet(worksheet_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Worksheet not found.")
        lec = _fetch_lecture(ws["lecture_id"])
        if not lec or lec["professor_id"] != uid:
            raise HTTPException(status_code=403, detail="You do not own this worksheet.")
        patch: dict = {}
        if body.title is not None:
            patch["title"] = body.title.strip()
        if patch:
            supabase_admin.table("worksheets").update(patch).eq(
                "id", worksheet_id
            ).execute()
        return _fetch_worksheet(worksheet_id)

    try:
        data = await run_in_threadpool(_update)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Worksheet update failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update worksheet.")


@router.delete("/api/worksheets/{worksheet_id}", status_code=204)
@limiter.limit("60/minute")
async def delete_worksheet(
    request: Request,
    worksheet_id: str,
    user: Any = Depends(require_professor),
):
    uid = _user_id(user)

    def _delete():
        ws = _fetch_worksheet(worksheet_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Worksheet not found.")
        lec = _fetch_lecture(ws["lecture_id"])
        if not lec or lec["professor_id"] != uid:
            raise HTTPException(status_code=403, detail="You do not own this worksheet.")
        path = ws.get("file_url") or ""
        if path:
            try:
                supabase_admin.storage.from_("worksheets").remove([path])
            except Exception as e:
                # Continue with the row delete — orphaned objects are
                # cleaner to rebuild later than a stuck DB row.
                logger.warning("Worksheet storage remove failed for %s: %s", path, e)
        supabase_admin.table("worksheets").delete().eq("id", worksheet_id).execute()

    try:
        await run_in_threadpool(_delete)
        return None
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Worksheet delete failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to delete worksheet.")


@router.get("/api/worksheets/{worksheet_id}/download_url")
@limiter.limit("120/minute")
async def get_worksheet_download_url(
    request: Request,
    worksheet_id: str,
    user: Any = Depends(verify_token),
):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _load():
        ws = _fetch_worksheet(worksheet_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Worksheet not found.")
        lec = _fetch_lecture(ws["lecture_id"])
        if not lec or not _user_can_read_lecture(uid, lec):
            raise HTTPException(status_code=404, detail="Worksheet not found.")
        path = ws.get("file_url") or ""
        if not path:
            raise HTTPException(status_code=404, detail="Worksheet has no file.")
        bucket = supabase_admin.storage.from_("worksheets")
        # Prefer signed URL; fall back to public URL if signing isn't
        # available in the test fake.
        url: Optional[str] = None
        if hasattr(bucket, "create_signed_url"):
            try:
                signed = bucket.create_signed_url(path, 3600)  # 1 hour
                if isinstance(signed, dict):
                    url = signed.get("signedURL") or signed.get("signed_url") or signed.get("signedUrl")
                else:
                    url = signed
            except Exception as e:
                logger.warning("Worksheet signed URL failed: %s", e)
        if not url and hasattr(bucket, "get_public_url"):
            url = bucket.get_public_url(path)
        if not url:
            raise HTTPException(status_code=500, detail="Failed to build download URL.")
        return {"url": url, "title": ws["title"], "file_type": ws.get("file_type")}

    try:
        data = await run_in_threadpool(_load)
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Worksheet download URL failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to get download URL.")
