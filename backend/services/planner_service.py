import logging
import json
import re
from typing import List, Dict, Any, Optional, AsyncGenerator
from backend.services.llm_client import call_llm
from backend.services.ai.orchestrator import generate_text, parse_json_response

logger = logging.getLogger(__name__)

BLUEPRINT_VERSION = 1

PLANNER_PROMPT = """You are a Master Pedagogical Knowledge Architect. 
Your task is to analyze a lecture's structure and summary to create an "AI-Driven Narrative Blueprint".

INPUTS:
1. Outline: {outline}
2. Hierarchical Summary: {summary}
3. First 3 Slides Text: {first_slides}

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
    "A concept that requires understanding slide X and slide Y"
  ]
}}
"""

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
    logger.info("Planner Agent: Generating blueprint...")
    
    prompt = PLANNER_PROMPT.format(
        outline=json.dumps(outline, indent=2),
        summary=summary,
        first_slides=json.dumps(first_slides, indent=2)
    )

    try:
        from backend.services.ai_service import cerebras_client
        # Cerebras is prioritized for planning due to speed and high logic quality
        plan_model = "cerebras" if cerebras_client else ai_model
        
        raw_json = await generate_text(prompt, plan_model)
        blueprint = parse_json_response(raw_json)
        
        # Validation
        if blueprint and all(k in blueprint for k in ["lecture_title", "overall_summary", "slide_plans"]):
            blueprint["version"] = BLUEPRINT_VERSION
            logger.info("Planner Agent: Successfully generated blueprint (v%d)", BLUEPRINT_VERSION)
            yield {"type": "result", "data": blueprint}
        else:
            logger.warning("Planner JSON missing required fields")
            yield {"type": "result", "data": None}
            
    except Exception as e:
        logger.error("Planner Agent failed: %s", e)
        yield {"type": "result", "data": None}


def get_slide_context(blueprint: Optional[Dict[str, Any]], slide_index: int) -> str:
    """Helper to extract relevant pedagogical context for a specific slide."""
    if not blueprint or "slide_plans" not in blueprint:
        return ""
    
    plans = blueprint.get("slide_plans", [])
    if slide_index < 0 or slide_index >= len(plans):
        return ""
    
    plan = plans[slide_index]
    context_parts = [
        f"PEDAGOGICAL GOAL:",
        f"- Target Title: {plan.get('proposed_title')}",
        f"- Core Concepts: {', '.join(plan.get('concepts', []))}",
        f"- Connective Context: {plan.get('previous_context')}",
    ]
    
    # Section context
    for section in blueprint.get("narrative_arc", []):
        if slide_index in section.get("slide_indices", []):
            context_parts.insert(0, f"SECTION: {section.get('section_name')} ({', '.join(section.get('key_takeaways', []))})")
            break
            
    return "\n".join(context_parts)
