import logging
import json
import re
from typing import List, Dict, Any, Optional
from backend.services.llm_client import call_llm

logger = logging.getLogger(__name__)

BLUEPRINT_VERSION = 1

PLANNER_PROMPT = """You are a Master Pedagogical Knowledge Architect. 
Your task is to analyze a lecture's structure and summary to create an "AI-Driven Narrative Blueprint" — a hierarchical knowledge structure that understands how concepts flow and build upon one another.

INPUTS:
1. Outline: {outline}
2. Hierarchical Summary: {summary}
3. First 3 Slides Text: {first_slides}

CORE STRATEGY:
- Move beyond processing each slide in isolation.
- Build a "Knowledge Tree" where the root is the course, branches are modules, and sub-branches are topics.
- Identify "Knowledge Graph" relationships (e.g., Slide 5's "Gradient Descent" is related to Slide 2's "Loss Function").

OUTPUT:
Return ONLY a valid JSON object with this exact structure:
{{
  "lecture_title": "Descriptive title for the whole lecture",
  "overall_summary": "High-level summary of the thesis and core takeaways",
  "knowledge_graph": [
     {{ "source": "Concept A", "target": "Concept B", "relationship": "builds_on" }}
  ],
  "narrative_arc": [
    {{
      "section_name": "Section Name",
      "key_takeaways": ["Point A", "Point B"],
      "slide_indices": [0, 1, 2]
    }}
  ],
  "slide_plans": [
    {{
      "index": 0,
      "proposed_title": "Clear Title",
      "concepts": ["Concept 1", "Concept 2"],
      "previous_context": "What context from previous slides is needed here? (null for slide 0)",
      "next_setup": "What concept does this slide introduce that slide N+1 will build upon?",
      "related_previous_slides": [index1, index2]
    }}
  ],
  "cross_slide_quiz_concepts": [
    "A concept that requires understanding slide X and slide Y (e.g. 'Compare A from section 1 with B from section 3')"
  ]
}}

RULES:
1. Ensure slide titles are descriptive, pedagogical, and unique.
2. The `next_setup` and `previous_context` must create a clear "pedagogical contract" between slides.
3. The `knowledge_graph` should map explicit relationships between entities.
4. Return ONLY the JSON object. No preamble, no fences.
"""

from typing import List, Dict, Any, Optional, AsyncGenerator

async def generate_blueprint(
    outline: List[Dict[str, Any]], 
    summary: str, 
    first_slides: List[str], 
    ai_model: str = "groq"
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Planner Agent: Generates a master narrative blueprint for the lecture.
    """
    yield {"type": "progress", "message": "Creating master pedagogical plan..."}
    logger.info("Planner Agent: Generating blueprint for lecture...")
    
    prompt = PLANNER_PROMPT.format(
        outline=json.dumps(outline, indent=2),
        summary=summary,
        first_slides=json.dumps(first_slides, indent=2)
    )

    try:
        from backend.services.ai_service import gemini_client, groq_client, GEMINI_MODEL, GROQ_MODEL
        
        def _make_call():
            from backend.services.ai_service import cerebras_client, CEREBRAS_MODEL
            if "cerebras" in ai_model and cerebras_client:
                res = cerebras_client.chat.completions.create(
                    model=CEREBRAS_MODEL,
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"}
                )
                return res.choices[0].message.content.strip()
            elif "gemini" in ai_model:
                # Use a strong model for planning
                res = gemini_client.models.generate_content(
                    model="gemini-1.5-flash", 
                    contents=prompt,
                    config={"response_mime_type": "application/json"}
                )
                return res.text.strip()
            elif "groq" in ai_model:
                res = groq_client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"}
                )
                return res.choices[0].message.content.strip()
            return ""

        raw_json = await call_llm(_make_call, timeout_seconds=45.0)
        
        # Parse and validate
        blueprint = _parse_planner_json(raw_json)
        if blueprint:
            blueprint["version"] = BLUEPRINT_VERSION
            logger.info("Planner Agent: Successfully generated blueprint (version %d)", BLUEPRINT_VERSION)
            yield {"type": "result", "data": blueprint}
        else:
            yield {"type": "result", "data": None}
    except Exception as e:
        logger.error("Planner Agent failed: %s", e)
        yield {"type": "result", "data": None}


def _parse_planner_json(raw: str) -> Optional[Dict[str, Any]]:
    """Extract and validate JSON from planner response."""
    try:
        raw = raw.strip()
        # Strip markdown fences if present
        match = re.search(r"```(?:json)?\s*([\s\S]+?)```", raw)
        if match:
            raw = match.group(1).strip()
        
        data = json.loads(raw)
        
        # Basic validation of required fields
        required = ["lecture_title", "overall_summary", "slide_plans"]
        if all(k in data for k in required):
            return data
        
        logger.warning("Planner JSON missing required fields")
        return None
    except Exception as e:
        logger.warning("Failed to parse Planner JSON: %s", e)
        return None


def get_slide_context(blueprint: Optional[Dict[str, Any]], slide_index: int) -> str:
    """Helper to extract relevant context for a specific slide from the blueprint."""
    if not blueprint or "slide_plans" not in blueprint:
        return ""
    
    plans = blueprint["slide_plans"]
    if slide_index < 0 or slide_index >= len(plans):
        return ""
    
    plan = plans[slide_index]
    context_parts = [
        f"MASTER PLAN FOR THIS SLIDE:",
        f"- Proposed Title: {plan.get('proposed_title')}",
        f"- Concepts to cover: {', '.join(plan.get('concepts', []))}",
        f"- Context from previous slides: {plan.get('previous_context')}",
        f"- Target setup for next slides: {plan.get('next_setup')}",
    ]
    
    # Find which section this slide belongs to
    for section in blueprint.get("narrative_arc", []):
        if slide_index in section.get("slide_indices", []):
            context_parts.insert(0, f"CURRENT SECTION: {section.get('section_name')}")
            context_parts.insert(1, f"SECTION TAKEAWAYS: {', '.join(section.get('key_takeaways', []))}")
            break
            
    return "\n".join(context_parts)
