import logging
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from .orchestrator import generate_text, parse_json_response

logger = logging.getLogger(__name__)

class MindMapNode(BaseModel):
    id: str
    label: str
    type: str
    summary: Optional[str] = None
    children: List["MindMapNode"] = []

MindMapNode.model_rebuild()

class MindMapRoot(BaseModel):
    id: str
    label: str
    type: str
    children: List[MindMapNode]


async def generate_mind_map(lecture_title: str, slides: List[Dict[str, Any]], ai_model: str = "cerebras") -> Dict[str, Any]:
    """
    Generates a structured thematic mind map for a lecture based on slide summaries.
    """
    slides_text = "\n".join(
        f"- Slide {i+1}: \"{s.get('title', 'Untitled')}\" — {s.get('summary', 'No summary')}"
        for i, s in enumerate(slides)
    )

    prompt = f"""Group the following lecture slides into 2-4 thematic clusters and extract key concepts.
Return ONLY valid JSON matching the MindMapRoot schema.
Root: {lecture_title}
Slides: {slides_text}"""

    try:
        # Use the async generate_text wrapper
        raw = await generate_text(prompt, ai_model)
        return parse_json_response(raw)
    except Exception as e:
        logger.error("Mind map generation failed: %s", e)
        # Fallback to a simple list-based structure that uses the REAL slide
        # ids so click-to-jump in the UI keeps working even when the model
        # call fails.
        return {
            "id": "root",
            "label": lecture_title,
            "type": "root",
            "children": [
                {
                    "id": s["id"],
                    "label": s.get("title") or f"Slide {i + 1}",
                    "type": "slide",
                    "children": [],
                }
                for i, s in enumerate(slides)
                if isinstance(s.get("id"), str)
            ],
        }
