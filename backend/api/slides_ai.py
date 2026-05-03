"""
On-demand AI actions for slides created via the deterministic
(non-AI) PDF parsing path.

Lets professors trigger LLM enhancement *after* import:
  POST /api/ai/slides/{slide_id}/regenerate-title
  POST /api/ai/slides/{slide_id}/rewrite-content
  POST /api/ai/slides/{slide_id}/generate-quiz
  POST /api/ai/decks/{lecture_id}/generate-quiz

Each per-slide endpoint flips ``slides.ai_enhanced`` to ``true`` after
the upgrade succeeds so the editor UI stops surfacing the "AI not yet
run" affordance for that row. The deck endpoint returns the generated
quiz to the client without persisting it (the editor decides whether
to attach it and saves with the rest of the deck).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from backend.core.auth_middleware import require_professor
from backend.core.database import supabase_admin
from backend.core.rate_limit import limiter
from backend.services.ai_service import (
    enhance_slide_content,
    generate_deck_quiz,
    generate_deck_summary,
    generate_quiz,
    generate_slide_title,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai", tags=["slides-ai"])

_AiModel = Literal[
    "cerebras", "openrouter", "cloudflare", "groq", "openai", "deepseek"
]


class _SlideAIRequest(BaseModel):
    ai_model: _AiModel = "cerebras"


class _DeckQuizRequest(BaseModel):
    ai_model: _AiModel = "cerebras"
    question_count: int = 5


def _user_id(user: Any) -> Optional[str]:
    if hasattr(user, "id"):
        return user.id
    if isinstance(user, dict):
        return user.get("id")
    return None


def _load_slide_or_403(slide_id: str, user: Any) -> dict:
    """Look up a slide row + verify the caller owns the parent lecture."""
    if not slide_id:
        raise HTTPException(status_code=400, detail="slide_id is required.")
    try:
        res = (
            supabase_admin.table("slides")
            .select(
                "id, lecture_id, slide_number, title, content_text, summary, "
                "ai_enhanced, parser_engine, lectures(professor_id)"
            )
            .eq("id", slide_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error("slide load failed: %s", e)
        raise HTTPException(status_code=500, detail="Could not load slide.")

    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Slide not found.")
    slide = rows[0]
    lecture_info = slide.get("lectures") or {}
    if lecture_info.get("professor_id") != _user_id(user):
        raise HTTPException(status_code=403, detail="Not your lecture.")
    return slide


def _load_deck_or_403(lecture_id: str, user: Any) -> List[dict]:
    """Verify lecture ownership and return its slides ordered by slide_number."""
    if not lecture_id:
        raise HTTPException(status_code=400, detail="lecture_id is required.")
    try:
        owner_res = (
            supabase_admin.table("lectures")
            .select("id, professor_id")
            .eq("id", lecture_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error("lecture load failed: %s", e)
        raise HTTPException(status_code=500, detail="Could not load lecture.")
    rows = owner_res.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Lecture not found.")
    if rows[0].get("professor_id") != _user_id(user):
        raise HTTPException(status_code=403, detail="Not your lecture.")

    try:
        slides_res = (
            supabase_admin.table("slides")
            .select("id, slide_number, title, content_text, summary")
            .eq("lecture_id", lecture_id)
            .order("slide_number")
            .execute()
        )
    except Exception as e:
        logger.error("deck slide load failed: %s", e)
        raise HTTPException(status_code=500, detail="Could not load slides.")
    return slides_res.data or []


def _mark_ai_enhanced(slide_id: str) -> None:
    """Best-effort flip of ``slides.ai_enhanced`` to true.

    Failures here are non-fatal — the AI output has already been
    delivered to the client, and the worst-case is the editor still
    showing the "AI not yet run" affordance until the next save.
    """
    try:
        supabase_admin.table("slides").update({"ai_enhanced": True}).eq("id", slide_id).execute()
    except Exception as e:
        logger.warning("Failed to flip ai_enhanced for slide %s: %s", slide_id, e)


def _slide_text_for_ai(slide: dict) -> str:
    text = (slide.get("content_text") or "").strip()
    if text:
        return text
    return (slide.get("summary") or slide.get("title") or "").strip()


# ---------------------------------------------------------------------------
# Per-slide endpoints
# ---------------------------------------------------------------------------


@router.post("/slides/{slide_id}/regenerate-title")
@limiter.limit("30/minute")
async def regenerate_title_endpoint(
    request: Request,
    slide_id: str,
    body: _SlideAIRequest,
    user: Any = Depends(require_professor),
):
    slide = _load_slide_or_403(slide_id, user)
    text = _slide_text_for_ai(slide)
    if not text:
        raise HTTPException(status_code=400, detail="Slide has no text to summarize.")
    try:
        title = await generate_slide_title(text)
    except Exception as e:
        logger.error("regenerate-title failed for slide %s: %s", slide_id, e)
        raise HTTPException(status_code=502, detail="AI title generation failed.")
    title = (title or "").strip() or slide.get("title") or "Untitled slide"
    try:
        supabase_admin.table("slides").update({
            "title": title, "ai_enhanced": True
        }).eq("id", slide_id).execute()
    except Exception as e:
        logger.error("Persist regenerated title failed: %s", e)
        raise HTTPException(status_code=500, detail="Saved title to nowhere.")
    return {"title": title}


@router.post("/slides/{slide_id}/rewrite-content")
@limiter.limit("20/minute")
async def rewrite_content_endpoint(
    request: Request,
    slide_id: str,
    body: _SlideAIRequest,
    user: Any = Depends(require_professor),
):
    slide = _load_slide_or_403(slide_id, user)
    text = _slide_text_for_ai(slide)
    if not text:
        raise HTTPException(status_code=400, detail="Slide has no text to rewrite.")
    try:
        enhanced = await enhance_slide_content(text, ai_model=body.ai_model)
    except Exception as e:
        logger.error("rewrite-content failed for slide %s: %s", slide_id, e)
        raise HTTPException(status_code=502, detail="AI rewrite failed.")
    new_content = (enhanced.get("content") if isinstance(enhanced, dict) else None) or text
    new_summary = enhanced.get("summary") if isinstance(enhanced, dict) else None
    update: dict = {"content_text": new_content, "ai_enhanced": True}
    if new_summary:
        update["summary"] = new_summary
    try:
        supabase_admin.table("slides").update(update).eq("id", slide_id).execute()
    except Exception as e:
        logger.error("Persist rewritten content failed: %s", e)
        raise HTTPException(status_code=500, detail="Could not save rewrite.")
    return {"content": new_content, "summary": new_summary or ""}


@router.post("/slides/{slide_id}/generate-quiz")
@limiter.limit("20/minute")
async def generate_slide_quiz_endpoint(
    request: Request,
    slide_id: str,
    body: _SlideAIRequest,
    user: Any = Depends(require_professor),
):
    slide = _load_slide_or_403(slide_id, user)
    text = _slide_text_for_ai(slide)
    if not text:
        raise HTTPException(status_code=400, detail="Slide has no text to quiz over.")
    try:
        quiz = await generate_quiz(text, ai_model=body.ai_model)
    except Exception as e:
        logger.error("generate-quiz failed for slide %s: %s", slide_id, e)
        raise HTTPException(status_code=502, detail="AI quiz generation failed.")
    if isinstance(quiz, list) and quiz:
        quiz = quiz[0]
    if not isinstance(quiz, dict) or not quiz.get("question"):
        raise HTTPException(status_code=502, detail="AI returned an empty quiz.")

    # Persist the generated question so the editor reflects it on next
    # fetch and so analytics / student playback see it immediately.
    options = quiz.get("options") or []
    if isinstance(options, list):
        options = [str(o) for o in options if str(o).strip()]
    correct = quiz.get("correctAnswer", quiz.get("correct_answer", 0))
    try:
        correct = int(correct)
    except (TypeError, ValueError):
        correct = 0
    metadata: Dict[str, Any] = {}
    for k in ("explanation", "concept", "cognitive_level"):
        if quiz.get(k) is not None:
            metadata[k] = quiz[k]
    try:
        supabase_admin.table("quiz_questions").insert({
            "slide_id": slide_id,
            "question_text": str(quiz.get("question") or "").strip(),
            "options": options,
            "correct_answer": correct,
            "metadata": metadata,
        }).execute()
    except Exception as e:
        logger.error("Persist generated slide quiz failed: %s", e)
        raise HTTPException(status_code=500, detail="Could not save quiz.")
    _mark_ai_enhanced(slide_id)
    return {"quiz": quiz}


# ---------------------------------------------------------------------------
# Deck-level endpoint
# ---------------------------------------------------------------------------


@router.post("/decks/{lecture_id}/generate-quiz")
@limiter.limit("10/minute")
async def generate_deck_quiz_endpoint(
    request: Request,
    lecture_id: str,
    body: _DeckQuizRequest,
    user: Any = Depends(require_professor),
):
    """Generate and persist a cross-slide quiz for a deck.

    Each generated item is anchored to its first ``linked_slides`` index
    (matching the upload pipeline's persistence shape) and the full
    ``linked_slides`` list lives in ``quiz_questions.metadata`` so the
    student player can render slide-jump chips for every linked slide.
    """
    slides = _load_deck_or_403(lecture_id, user)
    if not slides:
        raise HTTPException(status_code=400, detail="Deck has no slides.")

    parts = []
    for s in slides:
        title = (s.get("title") or "").strip()
        body_text = (s.get("content_text") or s.get("summary") or "").strip()
        if not body_text and not title:
            continue
        parts.append(f"[Slide {s.get('slide_number')}] {title}\n{body_text}")
    deck_text = "\n\n".join(parts).strip()
    if not deck_text:
        raise HTTPException(status_code=400, detail="Deck has no usable text.")

    try:
        # Prefer a real deck summary so the cross-slide prompt has a
        # high-signal handle on the deck rather than dumping every
        # slide's body into a single prompt.
        summary = await generate_deck_summary(deck_text[:12000], ai_model=body.ai_model)
    except Exception as e:
        logger.warning("Deck summary failed (using truncated raw text): %s", e)
        summary = deck_text[:4000]

    try:
        quiz = await generate_deck_quiz(summary, ai_model=body.ai_model)
    except Exception as e:
        logger.error("generate_deck_quiz failed for lecture %s: %s", lecture_id, e)
        raise HTTPException(status_code=502, detail="AI deck quiz generation failed.")
    if not isinstance(quiz, list):
        raise HTTPException(status_code=502, detail="AI returned an empty deck quiz.")

    # Persist the deck items. Anchor each to its first valid linked
    # slide; the player reads metadata.linked_slides for chips.
    slide_ids = [s["id"] for s in slides]
    persisted = 0
    for item in quiz:
        if not isinstance(item, dict):
            continue
        question_text = str(item.get("question") or "").strip()
        if not question_text:
            continue
        links_raw = item.get("linked_slides") or []
        if not isinstance(links_raw, list):
            continue
        links: List[int] = []
        for v in links_raw:
            try:
                idx = int(v)
            except (TypeError, ValueError):
                continue
            if 0 <= idx < len(slide_ids):
                links.append(idx)
        if len(links) < 2:
            continue
        anchor = slide_ids[links[0]]
        options = item.get("options") or []
        if isinstance(options, list):
            options = [str(o) for o in options if str(o).strip()]
        correct = item.get("correctAnswer", item.get("correct_answer", 0))
        try:
            correct = int(correct)
        except (TypeError, ValueError):
            correct = 0
        meta: Dict[str, Any] = {"linked_slides": links}
        for k in ("explanation", "concept"):
            if item.get(k) is not None:
                meta[k] = item[k]
        try:
            supabase_admin.table("quiz_questions").insert({
                "slide_id": anchor,
                "question_text": question_text,
                "options": options,
                "correct_answer": correct,
                "metadata": meta,
            }).execute()
            persisted += 1
        except Exception as e:
            logger.warning("Persist deck quiz item failed: %s", e)
    return {"quiz": quiz, "summary": summary, "persisted": persisted}
