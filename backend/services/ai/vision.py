import base64
import logging
from typing import Optional
from .orchestrator import (
    groq_client, gemini_client, GROQ_VISION_MODEL, GEMINI_MODEL,
    _llm_generate_text, parse_json_response
)

logger = logging.getLogger(__name__)

# Prompts
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


def analyze_slide_vision(b64_image: str, raw_text: str = "", ai_model: str = "groq", blueprint_context: str = "") -> dict:
    prompt = SLIDE_VISION_PROMPT
    if blueprint_context:
        prompt += f"\n\nCONTEXT FROM MASTER PLAN:\n{blueprint_context}"

    try:
        if ai_model == "groq" and groq_client:
            content = [{"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64_image}"}}]
            if raw_text: content.append({"type": "text", "text": f"Extracted text: {raw_text[:1000]}"})
            res = groq_client.chat.completions.create(
                model=GROQ_VISION_MODEL,
                messages=[{"role": "system", "content": prompt}, {"role": "user", "content": content}],
                temperature=0.2, response_format={"type": "json_object"}
            )
            return parse_json_response(res.choices[0].message.content)
        
        elif ai_model in ("gemini-1.5-flash", "gemini-1.5-flash") and gemini_client:
            from google.genai import types
            res = gemini_client.models.generate_content(
                model=GEMINI_MODEL,
                contents=[types.Part.from_bytes(data=base64.b64decode(b64_image), mime_type="image/jpeg"), prompt],
                config=types.GenerateContentConfig(response_mime_type="application/json")
            )
            return parse_json_response(res.text)
    except Exception as e:
        logger.error("Vision analysis failed: %s", e)
    
    return {"slide_type": "content_slide", "metadata": {}, "content_extraction": {"main_topic": "Untitled", "key_points": [], "summary": ""}, "quiz": None}


async def analyze_diagram_slide(image_bytes: bytes, ocr_text: str = "", ai_model: str = "groq", is_table: bool = False, blueprint_context: str = "") -> dict:
    prompt = TABLE_VISION_PROMPT if is_table else DIAGRAM_VISION_PROMPT
    if blueprint_context: prompt = f"CONTEXT:\n{blueprint_context}\n\n" + prompt
    
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    return analyze_slide_vision(b64, ocr_text, ai_model, blueprint_context)


def format_slide_content(content_extraction: dict) -> str:
    """Convert vision content_extraction dict into readable Markdown."""
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
