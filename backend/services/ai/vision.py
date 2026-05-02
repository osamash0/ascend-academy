import base64
import logging
import asyncio
import time
from typing import Dict, Any
from .orchestrator import (
    groq_client, gemini_client, GROQ_VISION_MODEL, GEMINI_MODEL,
    _rotator, parse_json_response
)

logger = logging.getLogger(__name__)

# Vision chain: Gemini Flash first (multimodal, 1500/day) → Groq vision (fallback)
VISION_CHAIN = ["gemini_vision", "groq_vision"]

# --- Prompts ---
SLIDE_VISION_PROMPT = """Analyze the lecture slide image and return ONLY a valid JSON object:
{
  "slide_type": "content_slide",
  "metadata": {"lecture_title": null, "lecturer_name": null, "course_code": null, "university_logo_present": false, "slide_number": null},
  "content_extraction": {"main_topic": null, "key_points": [], "summary": "", "example": null},
  "quiz": {"question": "...", "options": ["...", "...", "...", "..."], "correctAnswer": 0}
}
Pick one slide_type: title_slide, meta_slide, content_slide, example_slide, diagram_slide.
Rules: title/meta slides set quiz to null. content/example/diagram slides require a quiz."""

DIAGRAM_VISION_PROMPT = """This slide contains a diagram or mathematical visualization.
Describe in detail: axes, labels, trends, components, relationships. Convert equations to LaTeX.
Return ONLY valid JSON: {"title": "...", "content": "...", "summary": "...", "questions": [...], "slide_type": "diagram_slide", "is_metadata": false}"""

TABLE_VISION_PROMPT = """This slide contains a table. Extract ALL data in markdown format.
Return ONLY valid JSON: {"title": "...", "content": "markdown_table", "summary": "...", "questions": [...], "slide_type": "table_slide", "is_metadata": false}"""

_FALLBACK_RESULT: Dict[str, Any] = {
    "slide_type": "content_slide",
    "metadata": {},
    "content_extraction": {"main_topic": "Untitled", "key_points": [], "summary": ""},
    "quiz": None,
}


def _call_groq_vision(b64_image: str, raw_text: str, prompt: str) -> Dict[str, Any]:
    if groq_client is None:
        raise RuntimeError("Groq client not initialised")
    content = [{"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64_image}"}}]
    if raw_text:
        content.append({"type": "text", "text": f"Extracted text: {raw_text[:1000]}"})
    res = groq_client.chat.completions.create(
        model=GROQ_VISION_MODEL,
        messages=[{"role": "system", "content": prompt}, {"role": "user", "content": content}],
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    return parse_json_response(res.choices[0].message.content)


def _call_gemini_vision(b64_image: str, prompt: str) -> Dict[str, Any]:
    if gemini_client is None:
        raise RuntimeError("Gemini client not initialised")
    from google.genai import types
    res = gemini_client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[
            types.Part.from_bytes(data=base64.b64decode(b64_image), mime_type="image/jpeg"),
            prompt,
        ],
        config=types.GenerateContentConfig(response_mime_type="application/json"),
    )
    return parse_json_response(res.text)


def _sync_analyze_vision(
    b64_image: str,
    raw_text: str = "",
    ai_model: str = "groq",
    blueprint_context: str = "",
) -> Dict[str, Any]:
    prompt = SLIDE_VISION_PROMPT
    if blueprint_context:
        prompt += f"\n\nCONTEXT FROM MASTER PLAN:\n{blueprint_context}"

    # Build available vision providers in priority order
    providers = []
    if groq_client:
        providers.append("groq_vision")
    if gemini_client:
        providers.append("gemini_vision")

    # If caller explicitly requests Gemini, try it first
    if "gemini" in ai_model and gemini_client:
        providers = ["gemini_vision"] + [p for p in providers if p != "gemini_vision"]

    last_exc = None
    for provider in providers:
        try:
            if provider == "groq_vision":
                result = _call_groq_vision(b64_image, raw_text, prompt)
            else:
                result = _call_gemini_vision(b64_image, prompt)
            _rotator.record_success(provider)
            logger.debug("✅ Vision provider '%s' served request", provider)
            return result
        except Exception as exc:
            msg = str(exc).lower()
            is_rate_limit = any(k in msg for k in ("429", "rate limit", "quota", "too many requests"))
            if is_rate_limit:
                _rotator.record_rate_limit(provider)
                logger.warning("⚠️  Vision provider '%s' rate-limited, trying next", provider)
            else:
                logger.warning("Vision provider '%s' error: %s", provider, exc)
            last_exc = exc

    logger.error("All vision providers failed: %s", last_exc)
    return dict(_FALLBACK_RESULT)


async def analyze_slide_vision(
    b64_image: str,
    raw_text: str = "",
    ai_model: str = "groq",
    blueprint_context: str = "",
) -> Dict[str, Any]:
    return await asyncio.to_thread(_sync_analyze_vision, b64_image, raw_text, ai_model, blueprint_context)


async def analyze_diagram_slide(
    image_bytes: bytes,
    ocr_text: str = "",
    ai_model: str = "groq",
    is_table: bool = False,
    blueprint_context: str = "",
) -> Dict[str, Any]:
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    return await analyze_slide_vision(b64, ocr_text, ai_model, blueprint_context)


def format_slide_content(content_extraction: Dict[str, Any]) -> str:
    parts = []
    topic = content_extraction.get("main_topic")
    if topic:
        parts.append(f"## {topic}")

    key_points = content_extraction.get("key_points") or []
    if key_points:
        parts.append("\n".join(f"- {kp}" for kp in key_points))

    example = content_extraction.get("example")
    if example:
        parts.append(f"**Example:**\n\n{example}")

    return "\n\n".join(parts)
