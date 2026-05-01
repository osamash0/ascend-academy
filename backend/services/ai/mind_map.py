import logging
from typing import Optional
from pydantic import BaseModel
from .orchestrator import _llm_generate_text, parse_json_response

logger = logging.getLogger(__name__)

class MindMapNode(BaseModel):
    id: str
    label: str
    type: str
    summary: Optional[str] = None
    children: list["MindMapNode"] = []

MindMapNode.model_rebuild()

class MindMapRoot(BaseModel):
    id: str
    label: str
    type: str
    children: list[MindMapNode]


def generate_mind_map(lecture_title: str, slides: list[dict], ai_model: str = "groq") -> dict:
    slides_text = "\n".join(
        f"- Slide {i+1}: \"{s.get('title', 'Untitled')}\" — {s.get('summary', 'No summary')}"
        for i, s in enumerate(slides)
    )

    prompt = f"""Group the following lecture slides into 2-4 thematic clusters and extract key concepts.
Return ONLY valid JSON matching the MindMapRoot schema.
Root: {lecture_title}
Slides: {slides_text}"""

    try:
        raw = _llm_generate_text(prompt, ai_model)
        return parse_json_response(raw)
    except Exception as e:
        logger.error("Mind map generation failed: %s", e)
        return {
            "id": "root", "label": lecture_title, "type": "root",
            "children": [{"id": f"s-{i}", "label": s.get("title", f"Slide {i+1}"), "type": "slide", "children": []} for i, s in enumerate(slides)]
        }
