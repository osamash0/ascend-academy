import asyncio
import logging
import json
from typing import List, Dict, Any, AsyncGenerator
from backend.services.llm_client import call_llm
from backend.services.ai_service import safe_truncate_text

logger = logging.getLogger(__name__)

# Batched Map step to reduce API calls (O(N/batch) instead of O(N))
BATCH_SIZE = 8

async def generate_hierarchical_summary(
    slides_text: List[str], 
    outline: List[Dict[str, Any]] = None, 
    ai_model: str = "gemini-1.5-flash"
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

    # 1. Map Phase: Group slides into sections based on outline
    sections = []
    if outline:
        # Group slides by outline entries
        sorted_outline = sorted(outline, key=lambda x: x["page"])
        for i in range(len(sorted_outline)):
            start_page = sorted_outline[i]["page"]
            end_page = sorted_outline[i+1]["page"] if i+1 < len(sorted_outline) else len(slides_text) + 1
            
            # Clamp pages
            start_idx = max(0, start_page - 1)
            end_idx = min(len(slides_text), end_page - 1)
            
            if start_idx < end_idx:
                sections.append({
                    "title": sorted_outline[i]["title"],
                    "slides": slides_text[start_idx:end_idx],
                    "start_page": start_page
                })
    
    # Fallback to fixed batches if no outline or no sections found
    if not sections:
        for i in range(0, len(slides_text), BATCH_SIZE):
            sections.append({
                "title": f"Section {i // BATCH_SIZE + 1}",
                "slides": slides_text[i:i + BATCH_SIZE],
                "start_page": i + 1
            })

    # Optimization: Use Cerebras (ultra-fast) or Gemini for the Map Phase
    from backend.services.ai_service import cerebras_client, gemini_client
    map_model = "cerebras" if cerebras_client else "gemini-1.5-flash"

    tasks = []
    for idx, section in enumerate(sections):
        tasks.append((idx, _summarize_section(section, map_model)))
    
    batch_summaries_dict = {}
    completed = 0
    total = len(tasks)
    
    # Run Map Phase in parallel
    results = await asyncio.gather(*[t[1] for t in tasks], return_exceptions=True)
    
    for idx, summary in enumerate(results):
        if isinstance(summary, Exception):
            logger.error("Section %d failed: %s", idx, summary)
            continue
        batch_summaries_dict[idx] = summary
        completed += 1
        yield {"type": "progress", "message": f"Analyzing section {completed}/{total}: {sections[idx]['title']}"}

    # Sort to preserve document order
    batch_summaries = [batch_summaries_dict[i] for i in sorted(batch_summaries_dict.keys()) if i in batch_summaries_dict and batch_summaries_dict[i]]

    if not batch_summaries:
        yield {"type": "result", "data": "Could not generate lecture summary."}
        return

    # 2. Reduce Phase: Synthesize
    logger.info("Reducing %d section summaries into final narrative", len(batch_summaries))
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
    
    prompt = f"""You are an expert academic summarizer. 
Summarize the following section of lecture slides titled "{title}" into a single, cohesive paragraph. 
Focus on the technical concepts and how they build on each other. 
Ignore administrative info.

Slides:
{truncated_text}

Cohesive Summary:"""

    try:
        from backend.services.ai_service import gemini_client, groq_client
        
        # Determine which client to use
        # Force gemini if requested or as a fallback for high-TPM map phase
        use_gemini = "gemini" in ai_model and gemini_client is not None
        # Fallback to groq if gemini isn't available
        if not use_gemini and groq_client is None:
            use_gemini = gemini_client is not None

        def _make_call():
            from backend.services.ai_service import cerebras_client, CEREBRAS_MODEL
            if "cerebras" in ai_model and cerebras_client:
                res = cerebras_client.chat.completions.create(
                    model=CEREBRAS_MODEL,
                    messages=[{"role": "user", "content": prompt}]
                )
                return res.choices[0].message.content.strip()
            elif use_gemini:
                res = gemini_client.models.generate_content(model="gemini-1.5-flash", contents=prompt)
                return res.text.strip()
            elif groq_client:
                res = groq_client.chat.completions.create(
                    model="llama-3.1-8b-instant", 
                    messages=[{"role": "user", "content": prompt}]
                )
                return res.choices[0].message.content.strip()
            return ""

        summary = await call_llm(_make_call, timeout_seconds=45.0)
        return f"Section: {title}\n{summary}"
    except Exception as e:
        logger.error("Section summarization failed: %s", e)
        return ""


async def _reduce_summaries(summaries: List[str], ai_model: str) -> str:
    """Synthesize multiple section summaries into a flowing narrative summary for the entire lecture."""
    combined_summaries = "\n\n".join(summaries)
    
    prompt = f"""You are an educational designer. 
Below are several summaries of different sections of a lecture. 
Synthesize them into a single, flowing narrative summary for the ENTIRE lecture. 
Highlight the logical progression of topics and the primary thesis of the lecture.

Sections:
{combined_summaries}

Final Narrative Summary:"""

    try:
        from backend.services.ai_service import gemini_client, groq_client
        
        def _make_call():
            from backend.services.ai_service import cerebras_client, CEREBRAS_MODEL
            if "cerebras" in ai_model and cerebras_client:
                res = cerebras_client.chat.completions.create(
                    model=CEREBRAS_MODEL,
                    messages=[{"role": "user", "content": prompt}]
                )
                return res.choices[0].message.content.strip()
            elif "gemini" in ai_model and gemini_client:
                res = gemini_client.models.generate_content(model="gemini-1.5-flash", contents=prompt)
                return res.text.strip()
            elif groq_client:
                res = groq_client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[{"role": "user", "content": prompt}]
                )
                return res.choices[0].message.content.strip()
            return ""

        final = await call_llm(_make_call, timeout_seconds=60.0)
        return final
    except Exception as e:
        logger.error("Final reduction failed: %s", e)
        return "\n\n".join(summaries)
