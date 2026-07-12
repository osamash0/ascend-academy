import logging
import asyncio
import urllib.request
import urllib.parse
from typing import Any, Dict, List, Optional

from backend.core.database import SUPABASE_URL, ANON_KEY, supabase_admin
from backend.services.ai_service import (
    generate_summary as _generate_summary,
    generate_quiz as _generate_quiz,
    generate_slide_title as _generate_slide_title,
    enhance_slide_content as _enhance_slide_content,
    generate_analytics_insights as _generate_analytics_insights,
    generate_metric_feedback as _generate_metric_feedback,
    generate_speech as _generate_speech,
    analyze_slide_vision,
)
from backend.services.content_filter import is_metadata_slide
from backend.services.ai.analytics import generate_slide_recommendation
from backend.services import analytics_service, analytics_cache
from backend.services.ai.orchestrator import generate_text
from backend.services.ai.prompts import LECTURE_DESCRIPTION_PROMPT, COURSE_DESCRIPTION_PROMPT, LECTURE_TAGLINE_PROMPT
from backend.services.ai.voice import with_voice

logger = logging.getLogger(__name__)

_PDF_MAX_BYTES = 50 * 1024 * 1024
_STORAGE_PATH_PREFIX = "/storage/v1/object/"

_TAGLINE_CACHE: Dict[str, str] = {}
_TAGLINE_CACHE_MAX_ENTRIES = 512
_TAGLINE_MAX_CHARS = 6000

def _validate_supabase_storage_url(url: str) -> None:
    if not url:
        raise ValueError("No PDF attached.")
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        raise ValueError("Invalid PDF URL.")
    if parsed.scheme != "https":
        raise ValueError("PDF URL must use HTTPS.")
    try:
        project_host = urllib.parse.urlparse(SUPABASE_URL).hostname or ""
    except Exception:
        project_host = ""
    allowed_host = project_host.lower()
    request_host = (parsed.hostname or "").lower()
    if not allowed_host or request_host != allowed_host:
        raise ValueError("PDF URL does not point to the project's Supabase Storage.")
    if not parsed.path.startswith(_STORAGE_PATH_PREFIX):
        raise ValueError("PDF URL must point to a Supabase Storage object.")

async def generate_summary(slide_text: str, ai_model: str) -> str:
    filter_result = await asyncio.to_thread(is_metadata_slide, slide_text, ai_model=ai_model)
    if filter_result.get("is_metadata"):
        return "This slide contains administrative information and is not suitable for summarization."
    return await _generate_summary(slide_text, ai_model=ai_model)

async def generate_quiz(slide_text: str, ai_model: str) -> Dict[str, Any]:
    filter_result = await asyncio.to_thread(is_metadata_slide, slide_text, ai_model=ai_model)
    if filter_result.get("is_metadata"):
        return {
            "question": "This slide contains administrative information.",
            "options": ["N/A", "N/A", "N/A", "N/A"],
            "correctAnswer": 0
        }
    quiz = await _generate_quiz(slide_text, ai_model=ai_model)
    if isinstance(quiz, list) and quiz:
        quiz = quiz[0]
    if not isinstance(quiz, dict):
        raise ValueError("Quiz generation returned unexpected format")
    if not quiz.get("question") or not isinstance(quiz.get("options"), list):
        raise ValueError("AI returned an empty or incomplete quiz response.")
    if "answer" in quiz and "correctAnswer" not in quiz:
        ans = quiz.get("answer", "")
        if isinstance(ans, str) and len(ans) == 1 and ans.upper().isalpha():
            quiz["correctAnswer"] = ord(ans.upper()) - ord("A")
    if quiz.get("cognitive_level") not in ("recall", "apply", "analyse", None):
        quiz["cognitive_level"] = "apply"
    return quiz

async def generate_slide_title(slide_text: str) -> str:
    return await _generate_slide_title(slide_text)

async def enhance_slide_content(slide_text: str, ai_model: str) -> str:
    enhanced = await _enhance_slide_content(slide_text, ai_model=ai_model)
    return enhanced.get("content", slide_text)

async def generate_analytics_insights(stats: dict, ai_model: str) -> Dict[str, Any]:
    return await _generate_analytics_insights(stats, ai_model=ai_model)

async def generate_metric_feedback(metric_name: str, metric_value: Any, context_stats: Dict[str, Any], ai_model: str) -> str:
    return await _generate_metric_feedback(metric_name, metric_value, context_stats, ai_model)

async def generate_speech(text: str, voice: Optional[str]) -> bytes:
    return await _generate_speech(text, voice=voice)

async def get_slide_recommendation(
    slide_id: str,
    user_id: str,
    ai_model: str,
    creds_token: str
) -> Dict[str, Any]:
    res = supabase_admin.table("slides").select("id, lecture_id, title, content_text, summary, lectures(professor_id)").eq("id", slide_id).limit(1).execute()
    rows = res.data or []
    if not rows:
        raise FileNotFoundError("Slide not found.")
    slide = rows[0]
    lecture_id = slide.get("lecture_id")
    lecture_info = slide.get("lectures") or {}
    if lecture_info.get("professor_id") != user_id:
        raise PermissionError("Not your lecture.")

    try:
        slide_rows = await asyncio.to_thread(analytics_service.get_slide_analytics, lecture_id, creds_token)
    except Exception as e:
        logger.error("Slide analytics lookup failed: %s", e)
        raise ValueError("Could not load slide metrics.")

    metrics = next((s for s in slide_rows if s.get("slide_id") == slide_id), None)
    if metrics is None:
        raise FileNotFoundError("Slide metrics unavailable.")

    label = metrics.get("recommendation_label")
    if label == "insufficient_data" or label is None:
        return {
            "suggestion": "Not enough student activity yet to give a tailored tip. Encourage a few students to complete the slide first.",
            "label": label or "insufficient_data",
            "reasons": metrics.get("recommendation_reasons", []),
            "cached": False,
        }
    if label != "needs_review":
        return {
            "suggestion": "This slide is performing well — no AI suggestion needed.",
            "label": label,
            "reasons": metrics.get("recommendation_reasons", []),
            "cached": False,
        }

    snapshot = {
        "drop_off_rate": metrics.get("drop_off_rate"),
        "confusion_rate": metrics.get("confusion_rate"),
        "quiz_success_rate": metrics.get("quiz_success_rate"),
        "view_count": metrics.get("view_count"),
        "quiz_attempts": metrics.get("quiz_attempts"),
        "label": label,
        "reasons": sorted(metrics.get("recommendation_reasons", []) or []),
    }
    cache_params = {"slide_id": slide_id, "model": ai_model, "snapshot": snapshot}
    cache_hit = {"hit": True}

    async def _compute():
        cache_hit["hit"] = False
        text = await generate_slide_recommendation(
            slide_title=slide.get("title") or f"Slide {slide_id[:6]}",
            slide_text=slide.get("content_text") or slide.get("summary") or "",
            drop_off_rate=float(metrics.get("drop_off_rate") or 0.0),
            confusion_rate=float(metrics.get("confusion_rate") or 0.0),
            quiz_success_rate=metrics.get("quiz_success_rate"),
            view_count=int(metrics.get("view_count") or 0),
            reasons=metrics.get("recommendation_reasons", []) or [],
            ai_model=ai_model,
        )
        return {"suggestion": text}

    payload = await analytics_cache.get_or_compute_async(
        lecture_id, "ai_slide_recommendation", _compute, params=cache_params, ttl_seconds=60 * 60 * 24
    )
    return {
        "suggestion": payload.get("suggestion", ""),
        "label": label,
        "reasons": metrics.get("recommendation_reasons", []),
        "cached": cache_hit["hit"],
    }

async def regenerate_slide(
    slide_id: str, user_id: str, ai_model: str, creds_token: str, instruction: Optional[str] = None
) -> Dict[str, Any]:
    # Route through the HTTP/2-disabled wrapper to avoid ConnectionTerminated errors.
    from backend.core.database import create_client
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.postgrest.auth(creds_token)

    res = client.table("slides").select(
        "slide_number, lecture_id, title, content_text, summary, regen_instruction, "
        "needs_review, review_reason, lectures(pdf_url, professor_id)"
    ).eq("id", slide_id).maybe_single().execute()
    if not res or not res.data:
        raise FileNotFoundError("Slide not found.")

    lecture_info = res.data.get("lectures", {}) or {}
    if lecture_info.get("professor_id") != user_id:
        raise PermissionError("Unauthorized.")

    pdf_url = lecture_info.get("pdf_url")
    _validate_supabase_storage_url(pdf_url)

    slide_num: int = res.data["slide_number"]
    # Roadmap Phase 5.2 ("regenerate with feedback"): omitting `instruction`
    # (None) reuses whatever the professor set on a previous regenerate, so it
    # doesn't need retyping every time. Passing "" explicitly clears it — the
    # two must stay distinguishable, so this can't collapse to a single
    # `or` chain (both are falsy).
    if instruction is None:
        effective_instruction = (res.data.get("regen_instruction") or "").strip()
    else:
        effective_instruction = instruction.strip()
    blueprint_context = (
        f"The professor gave this instruction for regenerating this slide — honor it: {effective_instruction}"
        if effective_instruction else ""
    )

    def _download():
        class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                raise ValueError(f"Redirect not allowed (HTTP {code} → {newurl})")

        opener = urllib.request.build_opener(_NoRedirectHandler)
        req = urllib.request.Request(pdf_url, headers={"User-Agent": "LectureApp/1.0"})
        with opener.open(req, timeout=30) as resp:
            chunks = []
            total = 0
            while True:
                chunk = resp.read(65536)
                if not chunk: break
                total += len(chunk)
                if total > _PDF_MAX_BYTES:
                    raise ValueError(f"PDF response exceeds {_PDF_MAX_BYTES // (1024*1024)} MB limit.")
                chunks.append(chunk)
            return b"".join(chunks)

    pdf_bytes = await asyncio.to_thread(_download)

    import fitz
    def _extract():
        # `_render_page_to_jpeg` (backend.services.file_parse_service) was
        # removed during the v3/v4 retirement (Roadmap Phase 0) — this was
        # its only remaining caller, silently broken (every regenerate
        # request 502'd) since this code path had zero test coverage.
        # Inlined to match unified_orchestrator._render_page_jpeg's approach.
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            page = doc[slide_num - 1]
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
            img = pix.tobytes("jpeg")
            text = page.get_text("text")
            return img, text

    img_bytes, raw_text = await asyncio.to_thread(_extract)
    import base64
    b64 = base64.b64encode(img_bytes).decode("utf-8")
    analysis = await analyze_slide_vision(b64, raw_text, ai_model=ai_model, blueprint_context=blueprint_context)

    from backend.services.ai.vision import format_slide_content
    content = format_slide_content(analysis.get("content_extraction", {}))

    # Single-level undo (Roadmap Phase 5.2): snapshot what's about to be
    # overwritten — including the current instruction and quiz — so the
    # professor can revert one regenerate back to exactly where they started.
    # Deliberately not a full history — see the roadmap doc's 5.3 deferral
    # for why real multi-version history is a separate, larger effort.
    existing_quiz_res = client.table("quiz_questions").select(
        "question_text, options, correct_answer, metadata"
    ).eq("slide_id", slide_id).execute()
    existing_quiz_rows = (existing_quiz_res.data if existing_quiz_res and existing_quiz_res.data else [])

    previous_version = {
        "title": res.data.get("title"),
        "content_text": res.data.get("content_text"),
        "summary": res.data.get("summary"),
        "regen_instruction": res.data.get("regen_instruction"),
        "needs_review": res.data.get("needs_review"),
        "review_reason": res.data.get("review_reason"),
        "quiz": existing_quiz_rows,
    }

    new_title = analysis.get("metadata", {}).get("lecture_title") or f"Slide {slide_num}"
    new_summary = analysis.get("content_extraction", {}).get("summary", "")

    # Phase 5.1's needs_review/review_reason were only ever written at parse
    # time — a professor fixing a flagged slide here had no way to clear it.
    # Recompute with the same heuristic against the fresh content so a
    # successful regenerate can actually resolve the flag.
    from backend.services.parser.unified_orchestrator import _review_flag_for
    needs_review, review_reason = _review_flag_for(
        synthesis_failed=False, vision_routed=False, raw_title=new_title, raw_summary=new_summary
    )

    client.table("slides").update({
        "title": new_title,
        "content_text": content,
        "summary": new_summary,
        "regen_instruction": effective_instruction or None,
        "previous_version": previous_version,
        "needs_review": needs_review,
        "review_reason": review_reason,
    }).eq("id", slide_id).execute()

    quiz = analysis.get("quiz")
    if quiz:
        metadata = {k: v for k, v in {"explanation": quiz.get("explanation"), "concept": quiz.get("concept"), "cognitive_level": quiz.get("cognitive_level")}.items() if v}
        client.table("quiz_questions").delete().eq("slide_id", slide_id).execute()
        client.table("quiz_questions").insert({
            "slide_id": slide_id,
            "question_text": quiz["question"],
            "options": quiz["options"],
            "correct_answer": quiz["correctAnswer"],
            "metadata": metadata,
        }).execute()

    analytics_cache.invalidate_course_overview_for_lecture(res.data.get("lecture_id"))
    analysis["regen_instruction"] = effective_instruction or None
    # The frontend patches its local slide state from this shape directly
    # (title/content_text/summary) rather than re-parsing the raw vision
    # `analysis` payload, which nests these under different keys.
    analysis["slide"] = {
        "id": slide_id,
        "title": new_title,
        "content_text": content,
        "summary": new_summary,
        "regen_instruction": effective_instruction or None,
        "needs_review": needs_review,
        "review_reason": review_reason,
    }
    return analysis


async def undo_regenerate_slide(slide_id: str, user_id: str, creds_token: str) -> Dict[str, Any]:
    """Restore the single previous-version snapshot a regenerate took right
    before overwriting title/content_text/summary (Roadmap Phase 5.2).
    Clears the snapshot after restoring — this is a one-level undo, not a
    history stack."""
    from backend.core.database import create_client
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.postgrest.auth(creds_token)

    res = client.table("slides").select(
        "previous_version, lectures(professor_id)"
    ).eq("id", slide_id).maybe_single().execute()
    if not res or not res.data:
        raise FileNotFoundError("Slide not found.")

    lecture_info = res.data.get("lectures", {}) or {}
    if lecture_info.get("professor_id") != user_id:
        raise PermissionError("Unauthorized.")

    prev = res.data.get("previous_version")
    if not prev:
        raise ValueError("No previous version to restore.")

    update = {
        "title": prev.get("title"),
        "content_text": prev.get("content_text"),
        "summary": prev.get("summary"),
        "regen_instruction": prev.get("regen_instruction"),
        "needs_review": prev.get("needs_review", False),
        "review_reason": prev.get("review_reason"),
        "previous_version": None,
    }
    client.table("slides").update(update).eq("id", slide_id).execute()

    # Restore whatever quiz existed before the regenerate this undoes —
    # including "no quiz at all" if that was the pre-regenerate state.
    client.table("quiz_questions").delete().eq("slide_id", slide_id).execute()
    for q in prev.get("quiz") or []:
        client.table("quiz_questions").insert({
            "slide_id": slide_id,
            "question_text": q.get("question_text", ""),
            "options": q.get("options", []),
            "correct_answer": q.get("correct_answer"),
            "metadata": q.get("metadata") or {},
        }).execute()

    return {"id": slide_id, **update}

async def generate_lecture_description(title: str, course_name: Optional[str], summaries: List[str], ai_model: str) -> str:
    course_line = f"\n[COURSE]\n{course_name}" if course_name else ""
    summaries_text = "\n".join(summaries)[:4000]
    prompt = with_voice(LECTURE_DESCRIPTION_PROMPT.format(title=title, course_line=course_line, summaries=summaries_text))
    raw = await generate_text(prompt, ai_model=ai_model)
    description = (raw or "").strip().strip('"') if raw else ""
    return description

async def generate_course_description(course_id: str, creds_token: str, ai_model: str) -> str:
    from backend.core.database import create_client
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.postgrest.auth(creds_token)

    course_res = client.table("courses").select("title").eq("id", course_id).limit(1).execute()
    if not course_res.data: raise FileNotFoundError("Course not found.")
    course_title = course_res.data[0].get("title") or "Course"

    lec_res = client.table("lectures").select("id, title, created_at").eq("course_id", course_id).eq("is_archived", False).order("created_at", desc=False).execute()
    lectures = lec_res.data or []
    if not lectures: raise ValueError("Course has no lectures yet.")

    lecture_ids = [l["id"] for l in lectures]
    slides_res = client.table("slides").select("lecture_id, summary, content_text, title, slide_number").in_("lecture_id", lecture_ids).order("slide_number", desc=False).execute()
    slides = slides_res.data or []

    summaries_by_lecture = {}
    for s in slides:
        lid = s.get("lecture_id")
        if not lid: continue
        bucket = summaries_by_lecture.setdefault(lid, [])
        if len(bucket) >= 4: continue
        chunk = (s.get("summary") or s.get("content_text") or s.get("title") or "").strip()
        if chunk: bucket.append(chunk)

    outline_lines = []
    for l in lectures:
        outline_lines.append(f"- {l.get('title') or 'Untitled lecture'}")
        for chunk in summaries_by_lecture.get(l["id"], []):
            outline_lines.append(f"    • {chunk}")
    outline = "\n".join(outline_lines)[:4000]
    if not outline.strip(): raise ValueError("Course content is empty.")

    prompt = with_voice(COURSE_DESCRIPTION_PROMPT.format(title=course_title, outline=outline))
    raw = await generate_text(prompt, ai_model=ai_model)
    description = (raw or "").strip().strip('"') if raw else ""
    return description

async def generate_lecture_tagline(lecture_id: str, creds_token: str, ai_model: str) -> Dict[str, Any]:
    from backend.core.database import create_client
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.postgrest.auth(creds_token)

    lec_res = client.table("lectures").select("title").eq("id", lecture_id).limit(1).execute()
    if not lec_res.data: raise FileNotFoundError("Lecture not found.")
    title = lec_res.data[0].get("title") or "Lecture"

    slides_res = client.table("slides").select("title, summary, content_text, slide_number").eq("lecture_id", lecture_id).order("slide_number", desc=False).execute()
    slides = slides_res.data or []
    if not slides: raise ValueError("Lecture has no slides yet.")

    cache_key = f"{lecture_id}:{len(slides)}"
    cached = _TAGLINE_CACHE.get(cache_key)
    if cached: return {"tagline": cached, "cached": True}

    parts = []
    for s in slides:
        chunk = (s.get("summary") or s.get("content_text") or s.get("title") or "").strip()
        if chunk: parts.append(chunk)
    content = "\n".join(parts)[:_TAGLINE_MAX_CHARS]
    if not content.strip(): raise ValueError("Lecture content is empty.")

    prompt = with_voice(LECTURE_TAGLINE_PROMPT.format(title=title, content=content))
    raw = await generate_text(prompt, ai_model=ai_model)
    tagline = (raw or "").strip().strip('"').splitlines()[0].strip() if raw else ""
    if not tagline: raise ValueError("Empty tagline returned.")

    if len(_TAGLINE_CACHE) >= _TAGLINE_CACHE_MAX_ENTRIES:
        _TAGLINE_CACHE.pop(next(iter(_TAGLINE_CACHE)), None)
    _TAGLINE_CACHE[cache_key] = tagline
    return {"tagline": tagline, "cached": False}
