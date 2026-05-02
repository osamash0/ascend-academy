import asyncio
import logging
from typing import List, Dict, Any, AsyncGenerator, Optional
from backend.services.llm_client import call_llm
from backend.services.ai_service import safe_truncate_text
from backend.services.ai.orchestrator import generate_text

logger = logging.getLogger(__name__)

# Batched Map step to reduce API calls (O(N/batch) instead of O(N))
BATCH_SIZE = 8

async def generate_hierarchical_summary(
    slides_text: List[str], 
    outline: Optional[List[Dict[str, Any]]] = None, 
    ai_model: str = "gemini-2.0-flash"
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Two-stage MapReduce summarization:
    1. Map: Summarize sections (defined by outline or fixed batches).
    2. Reduce: Synthesize section summaries into a coherent narrative.
    """
    if not slides_text:
        yield {"type": "result", "data": ""}
        return

    logger.info("Starting hierarchical summarization for %d slides", len(slides_text))

    # 1. Map Phase: Group slides into sections
    sections = []
    if outline:
        # Group slides by outline entries
        sorted_outline = sorted(outline, key=lambda x: x["page"])
        for i in range(len(sorted_outline)):
            start_page = sorted_outline[i]["page"]
            next_page = sorted_outline[i+1]["page"] if i+1 < len(sorted_outline) else len(slides_text) + 1
            
            start_idx = max(0, start_page - 1)
            end_idx = min(len(slides_text), next_page - 1)
            
            if start_idx < end_idx:
                sections.append({
                    "title": sorted_outline[i]["title"],
                    "slides": slides_text[start_idx:end_idx],
                    "start_page": start_page
                })
    
    # Fallback to fixed batches if no sections found
    if not sections:
        for i in range(0, len(slides_text), BATCH_SIZE):
            sections.append({
                "title": f"Section {i // BATCH_SIZE + 1}",
                "slides": slides_text[i:i + BATCH_SIZE],
                "start_page": i + 1
            })

    # Honor caller's selected provider; orchestrator failover handles
    # provider rotation transparently.
    map_model = ai_model

    tasks = []
    for idx, section in enumerate(sections):
        tasks.append(_summarize_section(section, map_model))
    
    batch_summaries_dict = {}
    completed = 0
    total = len(tasks)
    
    # Run Map Phase in parallel
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    for idx, summary in enumerate(results):
        if isinstance(summary, Exception):
            logger.error("Section %d failed: %s", idx, summary)
            continue
        if summary:
            batch_summaries_dict[idx] = summary
        completed += 1
        yield {"type": "progress", "message": f"Analyzing section {completed}/{total}: {sections[idx]['title']}"}

    # Sort to preserve document order
    batch_summaries = [batch_summaries_dict[i] for i in sorted(batch_summaries_dict.keys())]

    if not batch_summaries:
        yield {"type": "result", "data": "Could not generate lecture summary."}
        return

    # 2. Reduce Phase: Synthesize
    logger.info("Reducing %d section summaries", len(batch_summaries))
    yield {"type": "progress", "message": "Synthesizing lecture narrative..."}
    final_summary = await _reduce_summaries(batch_summaries, ai_model)
    
    yield {"type": "result", "data": final_summary}


async def _summarize_section(section: Dict[str, Any], ai_model: str) -> str:
    """Summarize a group of slides into a single coherent abstract."""
    slides = section["slides"]
    start_page = section["start_page"]
    title = section["title"]
    
    combined_text = "\n\n".join([f"[Slide {start_page + i}] {text}" for i, text in enumerate(slides)])
    truncated_text, _ = safe_truncate_text(combined_text)
    
    prompt = f"""Summarize the following lecture section titled "{title}" into a single, technical paragraph. 
Ignore administrative slides.

Slides:
{truncated_text}

Cohesive Summary:"""

    try:
        summary = await generate_text(prompt, ai_model)
        return f"### {title}\n{summary}" if summary else ""
    except Exception as e:
        logger.error("Section summarization failed: %s", e)
        return ""


async def _reduce_summaries(summaries: List[str], ai_model: str) -> str:
    """Synthesize multiple section summaries into a flowing narrative summary."""
    combined_summaries = "\n\n".join(summaries)
    
    prompt = f"""Synthesize these section summaries into a single, flowing narrative summary for the entire lecture. 
Highlight the logical progression of concepts.

Sections:
{combined_summaries}

Final Narrative Summary:"""

    try:
        # Honor caller's selected provider; orchestrator failover handles
        # provider rotation transparently.
        return await generate_text(prompt, ai_model)
    except Exception as e:
        logger.error("Final reduction failed: %s", e)
        return "\n\n".join(summaries)
