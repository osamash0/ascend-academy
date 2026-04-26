"""
Mind Map API — generates and caches per-lecture knowledge tree structures.
"""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from backend.core.auth_middleware import verify_token
from backend.core.database import supabase, url, key
from backend.services.ai_service import generate_mind_map
from supabase import create_client
import os

router = APIRouter(prefix="/api/mind-map", tags=["mind-map"])
security = HTTPBearer()


def get_auth_client(token: str):
    client = create_client(url, key)
    client.postgrest.auth(token)
    return client


class GenerateRequest(BaseModel):
    ai_model: str = "groq"


@router.get("/{lecture_id}")
async def get_mind_map(
    lecture_id: str,
    user=Depends(verify_token),
    creds: HTTPAuthorizationCredentials = Depends(security)
):
    """Return cached mind map tree_data, or null if not yet generated."""
    try:
        client = get_auth_client(creds.credentials)
        res = client.table("lecture_mind_maps") \
            .select("tree_data, generated_at") \
            .eq("lecture_id", lecture_id) \
            .maybe_single() \
            .execute()

        if res.data:
            return {"success": True, "data": res.data["tree_data"], "generated_at": res.data["generated_at"]}
        return {"success": True, "data": None}
    except Exception as e:
        print(f"DEBUG mind map GET error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch mind map.")


@router.post("/{lecture_id}/generate")
async def generate_lecture_mind_map(
    lecture_id: str,
    body: GenerateRequest,
    user=Depends(verify_token),
    creds: HTTPAuthorizationCredentials = Depends(security)
):
    """AI-generate (or regenerate) the mind map for a lecture and cache it."""
    try:
        client = get_auth_client(creds.credentials)

        # Fetch lecture + slides
        lecture_res = client.table("lectures") \
            .select("id, title") \
            .eq("id", lecture_id) \
            .maybe_single() \
            .execute()

        if not lecture_res.data:
            raise HTTPException(status_code=404, detail="Lecture not found.")

        slides_res = client.table("slides") \
            .select("id, title, summary, slide_number") \
            .eq("lecture_id", lecture_id) \
            .order("slide_number", desc=False) \
            .limit(100) \
            .execute()

        slides = slides_res.data or []
        lecture_title = lecture_res.data["title"]

        # Run generation in thread pool (CPU-bound AI call)
        tree_data = await run_in_threadpool(
            generate_mind_map,
            lecture_title,
            slides,
            body.ai_model
        )

        # Upsert into lecture_mind_maps
        client.table("lecture_mind_maps").upsert(
            {
                "lecture_id": lecture_id,
                "tree_data": tree_data,
                "generated_at": "now()"
            },
            on_conflict="lecture_id"
        ).execute()

        return {"success": True, "data": tree_data}

    except HTTPException:
        raise
    except Exception as e:
        print(f"DEBUG mind map generate error: {e}")
        raise HTTPException(status_code=500, detail="Mind map generation failed.")
