"""
Mind Map API — generates and caches per-lecture knowledge tree structures.
"""
import logging
from typing import Any
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from supabase import create_client, Client

from backend.core.auth_middleware import verify_token, require_professor
from backend.core.database import SUPABASE_URL, ANON_KEY, supabase_admin
from backend.core.rate_limit import limiter
from backend.services.ai_service import generate_mind_map

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/mind-map", tags=["mind-map"])
security = HTTPBearer()

# Bump this when the canonical tree shape changes; cached rows with a lower
# version are treated as missing so they get regenerated against the new
# normaliser/UI rather than crashing it.
CURRENT_SCHEMA_VERSION = 2

# Hard upper bound on slides considered for a single mind map. Previously
# this was 100 which silently dropped slides for long lectures; we raise it
# to a safer ceiling and pass them through the AI in chunks if needed.
MAX_SLIDES = 1000


def get_auth_client(token: str) -> Client:
    """Creates a Supabase client authenticated with the user's JWT."""
    if not ANON_KEY:
        raise RuntimeError("ANON_KEY not configured; cannot create RLS client.")
    client: Client = create_client(SUPABASE_URL, ANON_KEY)
    client.postgrest.auth(token)
    return client


class GenerateRequest(BaseModel):
    ai_model: str = "cerebras"


@router.get("/{lecture_id}")
async def get_mind_map(
    lecture_id: str,
    user: Any = Depends(verify_token),
    creds: HTTPAuthorizationCredentials = Depends(security)
):
    """Return cached mind map tree_data, or null if not yet generated.

    Rows whose `schema_version` is below CURRENT_SCHEMA_VERSION are treated as
    not-yet-generated so the client renders the empty state and the professor
    can regenerate against the current normaliser.
    """
    try:
        client = get_auth_client(creds.credentials)
        res = client.table("lecture_mind_maps") \
            .select("tree_data, generated_at, schema_version") \
            .eq("lecture_id", lecture_id) \
            .maybe_single() \
            .execute()

        if not res.data:
            return {"success": True, "data": None}

        version = res.data.get("schema_version") or 1
        if version < CURRENT_SCHEMA_VERSION:
            return {"success": True, "data": None, "stale": True}

        return {
            "success": True,
            "data": res.data["tree_data"],
            "generated_at": res.data["generated_at"],
            "schema_version": version,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Mind map GET error for lecture %s: %s", lecture_id, e, exc_info=True)
        raise HTTPException(status_code=503, detail="Mind map service is temporarily unavailable.")


def _ensure_all_slides_present(tree: dict, slides: list[dict], lecture_title: str) -> dict:
    """Walk the AI-produced tree and append any missing slide ids under an
    "Other slides" cluster so every slide is represented exactly once."""
    if not isinstance(tree, dict):
        # Hard fallback if the model returned something truly unusable.
        tree = {"id": "root", "label": lecture_title, "type": "root", "children": []}

    tree.setdefault("id", "root")
    tree.setdefault("label", lecture_title)
    tree.setdefault("type", "root")
    tree.setdefault("children", [])

    present: set[str] = set()

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        if node.get("type") == "slide":
            sid = node.get("id")
            if isinstance(sid, str):
                present.add(sid)
        for c in node.get("children") or []:
            walk(c)

    walk(tree)

    missing = [s for s in slides if s.get("id") not in present]
    if missing:
        tree["children"].append({
            "id": "cluster-other-slides",
            "label": "Other slides",
            "type": "cluster",
            "children": [
                {
                    "id": s["id"],
                    "label": s.get("title") or f"Slide {s.get('slide_number')}",
                    "type": "slide",
                    "summary": s.get("summary"),
                }
                for s in missing
            ],
        })

    return tree


@router.post("/{lecture_id}/generate")
@limiter.limit("10/minute")
async def generate_lecture_mind_map(
    request: Request,
    lecture_id: str,
    body: GenerateRequest,
    user: Any = Depends(require_professor),
    creds: HTTPAuthorizationCredentials = Depends(security)
):
    """AI-generate (or regenerate) the mind map for a lecture and cache it."""
    try:
        user_id = user.id if hasattr(user, "id") else user.get("id")

        # 1. Verify ownership before any expensive operation using the admin
        #    client to avoid RLS catalog-read bypasses for this authz check.
        ownership_res = supabase_admin.table("lectures") \
            .select("id, title, professor_id") \
            .eq("id", lecture_id) \
            .maybe_single() \
            .execute()

        if not ownership_res.data:
            raise HTTPException(status_code=404, detail="Lecture not found.")

        if ownership_res.data.get("professor_id") != user_id:
            raise HTTPException(status_code=403, detail="You do not own this lecture.")

        client = get_auth_client(creds.credentials)

        slides_res = client.table("slides") \
            .select("id, title, summary, slide_number") \
            .eq("lecture_id", lecture_id) \
            .order("slide_number", desc=False) \
            .limit(MAX_SLIDES) \
            .execute()

        slides = slides_res.data or []
        if not slides:
            raise HTTPException(
                status_code=400,
                detail="No slides found for this lecture; cannot build a mind map.",
            )
        lecture_title = ownership_res.data["title"]

        # 2. Run generation (now async)
        tree_data = await generate_mind_map(
            lecture_title,
            slides,
            body.ai_model
        )

        # 3. Post-validate: guarantee every slide is represented.
        tree_data = _ensure_all_slides_present(tree_data, slides, lecture_title)

        # 4. Upsert results with current schema version.
        client.table("lecture_mind_maps").upsert(
            {
                "lecture_id": lecture_id,
                "tree_data": tree_data,
                "generated_at": "now()",
                "schema_version": CURRENT_SCHEMA_VERSION,
            },
            on_conflict="lecture_id"
        ).execute()

        return {"success": True, "data": tree_data, "schema_version": CURRENT_SCHEMA_VERSION}

    except HTTPException:
        raise
    except TimeoutError as e:
        logger.warning("Mind map generation timed out for %s: %s", lecture_id, e)
        raise HTTPException(status_code=504, detail="Mind map generation timed out. Please retry.")
    except Exception as e:
        logger.error("Mind map generation failed for %s: %s", lecture_id, e, exc_info=True)
        raise HTTPException(
            status_code=502,
            detail="The AI service failed to generate the mind map. Please try a different model or retry shortly.",
        )
