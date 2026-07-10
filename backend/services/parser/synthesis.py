"""Per-slide + lecture-level LLM synthesis helpers for the unified pipeline.

These are the content-generation primitives the live unified orchestrator
(`unified_orchestrator.py`, PARSER_VERSION=5) calls: one focused LLM call per
slide (`analyze_slide`), a lecture-level title/summary pass
(`analyze_lecture_meta`), and a deck-level quiz (`generate_quiz_questions` +
`_map_deck_quiz`, whose answer index is validated so a wrong key is never
shipped).

Standalone by design: this module imports only the AI orchestrator and the
shared quiz validator, never any legacy parser orchestrator (v3/v4). PDF bytes,
when needed, are fetched via `parser.storage._fetch_pdf_bytes`.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

from backend.services.ai.orchestrator import (
    generate_text_bulk,
    generate_text,
    parse_json_response,
)
from backend.services.ai.quiz_validator import _normalize_answer_index

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# LLM helpers
# ---------------------------------------------------------------------------

async def analyze_lecture_meta(slides: List[str], ai_model: str) -> Dict[str, Any]:
    """One LLM call on the first 15 slides to extract lecture-level metadata."""
    combined_text = "\n\n".join(
        f"[Slide {i + 1}]: {text[:400]}" for i, text in enumerate(slides[:15])
    )
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
    raw = await generate_text(prompt, ai_model=ai_model)
    return parse_json_response(raw)


async def analyze_slide(
    slide_number: int,
    text: str,
    lecture_context: str,
    ai_model: str,
) -> Dict[str, Any]:
    """Analyze a single slide; returns the LLM result dict."""
    prompt = f"""You are an expert at analyzing university lecture slides. Given raw text extracted from a PDF slide, analyze it and return a JSON object.

Return ONLY valid JSON, no markdown, no code blocks. Keys:
- title: string (short descriptive title for this slide, max 60 chars)
- slideType: one of "text", "image-only", "math-diagram", "graph", "mixed", "title-slide", "table-of-contents"
- aiInsight: string (A concise narrative explanation (1-3 sentences) of this slide as if you are a professor teaching a class. If this slide covers the same topic as the previous slide, DO NOT repeat the explanation; focus ONLY on what is new or briefly summarize the continuation. Maintain a logical flow and avoid giving the impression that each slide is being explained in isolation. Do NOT use phrases like "This slide", "In this slide", or "This image". Connect it to the previous slide if mentioned in the context.)
- contextNote: string (1 sentence about where this slide fits in the lecture narrative)

Lecture context: {lecture_context[:1000]}

Slide {slide_number} raw text:
{text[:1500]}

If the text is nearly empty or only has symbols/numbers, classify as "image-only" or "math-diagram"."""
    raw = await generate_text_bulk(prompt, ai_model=ai_model)
    res = parse_json_response(raw)
    if not isinstance(res, dict):
        res = {}
    res["slide_index"] = slide_number - 1
    res["content"] = text if text.strip() else res.get("aiInsight") or res.get("title") or "No extractable text."
    return res


async def generate_quiz_questions(
    slides: List[str],
    lecture_title: str,
    ai_model: str,
) -> List[Dict[str, Any]]:
    """Generate 5–8 deck-level MCQs from content-rich slides."""
    content_slides = [s for s in slides if len(s) > 50][:10]
    if not content_slides:
        return []

    slide_summary = "\n\n".join(
        f"[Slide {i + 1}]: {text[:500]}" for i, text in enumerate(content_slides)
    )
    prompt = f"""Generate quiz questions for a university lecture. Return ONLY a valid JSON array of question objects, no markdown.

Each object has:
- question: string
- options: array of 4 strings (A, B, C, D options — do NOT include "A)", "B)" prefixes, just the text)
- correctAnswer: string (must match one of the options exactly)
- explanation: string (brief explanation of why the answer is correct)
- difficulty: "easy" | "medium" | "hard"
- slideId: number (1-based slide number the question is drawn from)

Lecture: "{lecture_title}"

Slides:
{slide_summary}

Generate 5-8 diverse, well-formed multiple choice questions covering key concepts. Mix difficulties."""
    raw = await generate_text_bulk(prompt, ai_model=ai_model)
    res = parse_json_response(raw)
    return res if isinstance(res, list) else []


def _map_deck_quiz(quiz_questions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Map raw LLM quiz dicts to the stored/SSE deck-quiz shape.

    The correct-answer index is resolved with the shared quiz validator
    (handles answer given as option text, letter, or index). A question whose
    answer can't be matched to an option is DROPPED (and logged) rather than
    silently defaulted to option A — shipping a wrong answer key to students
    is worse than shipping fewer questions.
    """
    mapped: List[Dict[str, Any]] = []
    dropped = 0
    for q in quiz_questions:
        options = q.get("options", ["", "", "", ""])
        ans_idx = _normalize_answer_index(q)
        if ans_idx is None:
            dropped += 1
            logger.warning(
                "V4 quiz: dropping question with unresolvable correctAnswer=%r (options=%r)",
                q.get("correctAnswer"), options,
            )
            continue
        # slideId is 1-based from LLM; frontend/embeddings use 0-based index
        try:
            slide_id_0 = max(0, int(q.get("slideId", 1)) - 1)
        except (TypeError, ValueError):
            slide_id_0 = 0
        mapped.append({
            "question": q.get("question", ""),
            "options": options,
            "correctAnswer": ans_idx,
            "explanation": q.get("explanation", ""),
            "concept": q.get("difficulty", ""),
            "linked_slides": [slide_id_0],
        })
    if dropped:
        logger.warning(
            "V4 quiz: dropped %d of %d questions with unresolvable answers",
            dropped, len(quiz_questions),
        )
    return mapped
