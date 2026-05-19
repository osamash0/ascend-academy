"""Parser v4 orchestrator — Ported from Replit Node.js implementation.

This worker runs the fast extract -> meta -> analyze -> quiz pipeline using the Replit prompts,
and emits SSE events so the UI works exactly as it did in v3.
"""
from __future__ import annotations

import json
import logging
import asyncio
from typing import Optional, List, Dict, Any
from uuid import UUID

import redis.asyncio as aioredis

from backend.core.config import settings
from backend.services.parser import repos
from backend.domain.parse_models import RunStatus
from backend.services.pdf_reader import PDFReader
from backend.services.ai.orchestrator import generate_text_bulk, parse_json_response

logger = logging.getLogger(__name__)

REDIS_CHANNEL_PREFIX = "parse:"

# --- Replit Prompts ---

async def analyze_lecture_meta(slides: List[str], ai_model: str) -> Dict[str, Any]:
    combined_text = "\n\n".join(f"[Slide {i+1}]: {text[:400]}" for i, text in enumerate(slides[:15]))
    prompt = f"""You are an expert at understanding university lecture slides. Analyze the provided slide texts and return a JSON object.

Return ONLY valid JSON, no markdown. Keys:
- title: string (the lecture title)
- lectureType: one of "introduction", "exam-prep", "theory", "lab", "review", "case-study", "overview", "workshop"
- subject: string (academic subject, e.g. "Computer Science", "Mathematics", "Biology")
- courseCode: string (course code if visible, else "")
- summary: string (3-4 sentence summary of what this entire lecture covers)
- keyTopics: array of strings (5-8 key topics/concepts covered)

Analyze these lecture slides:

{combined_text}"""
    raw = await generate_text_bulk(prompt, ai_model=ai_model)
    return parse_json_response(raw)

async def analyze_slide(slide_number: int, text: str, lecture_context: str, ai_model: str) -> Dict[str, Any]:
    prompt = f"""You are an expert at analyzing university lecture slides. Given raw text extracted from a PDF slide, analyze it and return a JSON object.
        
Return ONLY valid JSON, no markdown, no code blocks. Keys:
- title: string (short descriptive title for this slide, max 60 chars)
- slideType: one of "text", "image-only", "math-diagram", "graph", "mixed", "title-slide", "table-of-contents"  
- aiInsight: string (A narrative explanation of this slide as if you are a professor teaching a class. Deliver the material with the expertise of a professor, yet with a clarity accessible to a student. Maintain a logical flow and avoid giving the impression that each slide is being explained in isolation. Do NOT use phrases like "This slide", "In this slide", or "This image". Speak directly about the concepts as a teacher would in a continuous live lecture. Connect it to the previous slide if mentioned in the context.)
- contextNote: string (1 sentence about where this slide fits in the lecture narrative)

Lecture context: {lecture_context[:1000]}

Slide {slide_number} raw text:
{text[:1500]}

If the text is nearly empty or only has symbols/numbers, classify as "image-only" or "math-diagram"."""
    raw = await generate_text_bulk(prompt, ai_model=ai_model)
    res = parse_json_response(raw)
    res["slide_index"] = slide_number - 1
    res["content"] = text
    return res

async def generate_quiz_questions(slides: List[str], lecture_title: str, ai_model: str) -> List[Dict[str, Any]]:
    content_slides = [s for s in slides if len(s) > 50][:10]
    if not content_slides:
        return []
        
    slide_summary = "\n\n".join(f"[Slide {i+1}]: {text[:500]}" for i, text in enumerate(content_slides))
    prompt = f"""Generate quiz questions for a university lecture. Return ONLY a valid JSON array of question objects, no markdown.

Each object has:
- question: string
- options: array of 4 strings (A, B, C, D options — do NOT include "A)", "B)" prefixes, just the text)
- correctAnswer: string (must match one of the options exactly)
- explanation: string (brief explanation of why the answer is correct)
- difficulty: "easy" | "medium" | "hard"
- slideId: number (the slide id from the context)

Lecture: "{lecture_title}"

Slides:
{slide_summary}

Generate 5-8 diverse, well-formed multiple choice questions covering key concepts. Mix difficulties."""
    raw = await generate_text_bulk(prompt, ai_model=ai_model)
    res = parse_json_response(raw)
    if isinstance(res, list):
        return res
    return []

# --- Orchestrator ---

async def parse_pdf_v4(
    ctx: dict,
    *,
    pdf_hash: str,
    lecture_id: str,
    run_id: Optional[str] = None,
    ai_model: str = "openai",
) -> str:
    ai_model = "openai"  # Force OpenAI for testing as requested by user
    lecture_uuid = UUID(lecture_id) if lecture_id else None

    redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    channel = f"{REDIS_CHANNEL_PREFIX}{pdf_hash}"

    async def emit(event_type: str, data: dict) -> None:
        try:
            await redis_client.publish(channel, json.dumps({"type": event_type, **data}))
        except Exception as e:
            logger.debug("SSE emit failed: %s", e)

    try:
        current_run_id = run_id

        await emit("run_started", {"run_id": str(current_run_id), "pipeline_version": "v4"})
        await emit("phase", {"phase": "extract"})

        # Fetch PDF
        from backend.services.parser.orchestrator import _fetch_pdf_bytes
        pdf_bytes = await _fetch_pdf_bytes(pdf_hash)
        if not pdf_bytes:
            raise ValueError("PDF not found in storage")

        # Extract text using pymupdf
        import fitz
        raw_slides = []
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            for i, page in enumerate(doc):
                text = page.get_text("text") or ""
                raw_slides.append(text)
        
        import os
        slide_limit = os.getenv("TEST_SLIDE_LIMIT")
        if slide_limit:
            slide_limit = int(slide_limit)
            if slide_limit < len(raw_slides):
                logger.info("TEST_SLIDE_LIMIT active: processing only %d slides", slide_limit)
                raw_slides = raw_slides[:slide_limit]
        
        total = len(raw_slides)
        await emit("progress", {"current": total, "total": total, "message": f"Extracted {total} slides"})

        # Analyze Meta
        await emit("phase", {"phase": "enhance"})
        await emit("progress", {"current": 0, "total": total, "message": "Analyzing lecture metadata..."})
        
        meta = await analyze_lecture_meta(raw_slides, ai_model)
        lecture_title = meta.get("title", "Untitled Lecture")
        lecture_summary = meta.get("summary", "")
        lecture_context = f"{lecture_title}: {lecture_summary}"

        # Analyze Slides sequentially to maintain narrative flow
        final_slides = []
        previous_narrative = ""
        
        for i, text in enumerate(raw_slides):
            slide_num = i + 1
            # Pass previous narrative as context if available
            context_with_prev = lecture_context
            if previous_narrative:
                context_with_prev += f"\n\nIn the previous slide, you explained: {previous_narrative}"
                
            await emit("progress", {"current": i, "total": total, "message": f"Analyzing slide {slide_num}/{total}..."})
            
            try:
                result = await analyze_slide(slide_num, text, context_with_prev, ai_model)
                previous_narrative = result.get("aiInsight", "")
                slide_data = result
            except Exception as e:
                logger.error(f"Failed to analyze slide {slide_num}: {e}")
                slide_data = {"title": f"Slide {slide_num}", "slideType": "text", "aiInsight": "", "contextNote": "", "content": text}
                previous_narrative = "" # Reset on failure
            
            final_slides.append(slide_data)
            
            # Map back to v3 format for frontend compatibility
            ui_slide = {
                "title": slide_data.get("title", f"Slide {slide_num}"),
                "content": slide_data.get("content", ""),
                "summary": slide_data.get("aiInsight", ""),
                "slide_type": slide_data.get("slideType", "text"),
                "questions": [], # Will fill from quiz generation if any
            }
            await emit("slide", {"index": i, "slide": ui_slide})
            await emit("progress", {"current": i+1, "total": total, "message": f"Analyzed {i+1}/{total} slides"})

        # Generate Quiz Questions
        await emit("progress", {"current": total, "total": total, "message": "Generating quiz questions..."})
        quiz_questions = await generate_quiz_questions(raw_slides, lecture_title, ai_model)
        
        # Attach questions to slides
        for q in quiz_questions:
            slide_id = q.get("slideId")
            if isinstance(slide_id, int) and 1 <= slide_id <= total:
                # Map to standard format
                # correctAnswer is string (exact match of option) in Replit, UI expects index or letter
                options = q.get("options", ["", "", "", ""])
                ans_str = q.get("correctAnswer", "")
                ans_idx = 0
                if ans_str in options:
                    ans_idx = options.index(ans_str)
                
                q_mapped = {
                    "question": q.get("question", ""),
                    "options": options,
                    "correctAnswer": ans_idx,
                    "explanation": q.get("explanation", ""),
                    "difficulty": q.get("difficulty", "medium")
                }
                # Broadcast an update or just save to DB? The UI expects questions in the slide object.
                # In v3, questions were sent with the slide event. Since we generated them after,
                # we can send a deck_complete with the quiz, or just let them be loaded later.
                # Replit generated them separately.
        
        await emit("phase", {"phase": "finalize"})
        
        deck_quiz_mapped = []
        for q in quiz_questions:
             options = q.get("options", ["", "", "", ""])
             ans_str = q.get("correctAnswer", "")
             ans_idx = 0
             if ans_str in options:
                 ans_idx = options.index(ans_str)
             deck_quiz_mapped.append({
                 "question": q.get("question", ""),
                 "options": options,
                 "correctAnswer": ans_idx,
                 "explanation": q.get("explanation", ""),
                 "concept": q.get("difficulty", ""),
                 "linked_slides": [q.get("slideId", 1)]
             })

        await emit("deck_complete", {"deck_summary": lecture_summary, "deck_quiz": deck_quiz_mapped, "total_slides": total})
        
        await emit("complete", {"total": total})

        return str(current_run_id)

    except Exception as e:
        logger.exception("Pipeline failed for pdf_hash=%s: %s", pdf_hash, e)
        await emit("error", {"message": str(e)})
        raise
    finally:
        await redis_client.aclose()
