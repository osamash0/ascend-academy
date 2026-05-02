import asyncio
import logging
import time
import hashlib
import gc
from typing import List, Dict, Any, Optional, Tuple, AsyncGenerator
from pathlib import Path
from enum import Enum

import fitz
from backend.services.slide_utils import extract_visual_title
from backend.services.content_filter import is_metadata_slide
from backend.services.ai_service import (
    batch_analyze_text_slides, analyze_slide_vision, generate_deck_summary, 
    generate_deck_quiz, safe_truncate_text
)
from backend.services.planner_service import generate_blueprint, BLUEPRINT_VERSION
from backend.services.summarizer_service import generate_hierarchical_summary
from backend.services.ocr_fallback import OCRFallback
from backend.services.cache import get_cached_blueprint, store_cached_blueprint

logger = logging.getLogger(__name__)

class SlideType(Enum):
    TITLE = "title_slide"
    CONTENT = "content_slide"
    DIAGRAM = "diagram_slide"
    TABLE = "table_slide"
    METADATA = "meta_slide"

# Constants for Large PDF handling
PROCESSING_BATCH_SIZE = 8  # Process 8 slides at a time to manage memory/rate-limits

def classify_slide(page: 'fitz.Page') -> SlideType:
    """Heuristic classification of slide type based on layout."""
    text = page.get_text("text").strip()
    images = page.get_images()
    if not text:
        return SlideType.DIAGRAM if images else SlideType.METADATA
    
    lines = text.split('\n')
    if len(lines) < 3: return SlideType.TITLE
    
    tables = page.find_tables()
    if tables.tables: return SlideType.TABLE
    
    # If text is sparse but images exist, prefer vision/OCR
    if len(text) < 150 and images:
        return SlideType.DIAGRAM
    
    return SlideType.CONTENT

def needs_vision(stype: SlideType) -> bool:
    return stype in (SlideType.DIAGRAM, SlideType.TABLE)

def _vision_available(ai_model: str) -> bool:
    return ai_model in ("groq", "gemini-2.0-flash")

def _render_page_to_jpeg(page: 'fitz.Page') -> bytes:
    """Synchronous rendering of page to high-res JPEG bytes."""
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
    return pix.tobytes("jpg")

async def parse_pdf_stream(
    pdf_bytes: bytes, 
    filename: str = "upload.pdf", 
    ai_model: str = "groq", 
    use_blueprint: bool = True,
    odl_pages: Optional[Dict[int, Dict[str, Any]]] = None
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    High-concurrency streaming PDF parser.
    Optimized for large documents via windowed batching and resource cleanup.
    """
    t_start = time.monotonic()
    pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()
    odl_pages = odl_pages or {}
    
    doc = await asyncio.wait_for(
        asyncio.to_thread(fitz.open, stream=pdf_bytes, filetype="pdf"),
        timeout=30.0
    )
    total_pages = len(doc)
    
    try:
        yield {"type": "progress", "current": 0, "total": total_pages, "message": "Classifying slides..."}

        # Stage 1: Classification
        t_batch, v_queue, tbl_queue, classifications, all_text = await _stage_classification(doc, ai_model, odl_pages)

        parser_name = "opendataloader-pdf" if odl_pages else "pymupdf"
        yield {"type": "info", "parser": parser_name}

        # Stage 2: Planning (Master Plan)
        blueprint = None
        if use_blueprint:
            blueprint = await _stage_planning(pdf_bytes, pdf_hash, all_text, ai_model, total_pages)
            if blueprint:
                yield {"type": "progress", "current": 0, "total": total_pages, "message": "Master Plan ready. Starting analysis..."}

        # Stage 3: Windowed Batch Processing
        # We process in batches to manage memory and avoid overwhelming LLM rate limits
        for i in range(0, total_pages, PROCESSING_BATCH_SIZE):
            batch_end = min(i + PROCESSING_BATCH_SIZE, total_pages)
            batch_indices = list(range(i, batch_end))
            
            # Prepare queues for this specific batch
            curr_text_batch = [s for s in t_batch if s["index"] in batch_indices]
            curr_v_queue = [s for s in v_queue if s["index"] in batch_indices]
            curr_tbl_queue = [s for s in tbl_queue if s["index"] in batch_indices]

            # Detailed progress message for transparency
            engine_info = []
            if curr_text_batch: engine_info.append(f"{len(curr_text_batch)} Text")
            if curr_v_queue or curr_tbl_queue: engine_info.append(f"{len(curr_v_queue) + len(curr_tbl_queue)} Vision")
            msg = f"Analyzing slides {i+1}-{batch_end} ({', '.join(engine_info)})..."
            
            yield {"type": "progress", "current": i, "total": total_pages, "message": msg}
            
            # Process Batch
            text_res, vision_res = await _stage_processing(curr_text_batch, curr_v_queue, curr_tbl_queue, ai_model, blueprint)
            
            # Yield results for this batch immediately
            async for event in _stage_yield_batch(doc, i, batch_end, classifications, text_res, vision_res, filename, ai_model, pdf_hash, odl_pages):
                yield event
            
            # Explicit memory cleanup after each batch
            gc.collect()

    finally:
        await asyncio.to_thread(doc.close)
    
    # Final Stage: Deck Summary & Quiz
    async for event in _stage_finalize_deck(classifications, blueprint, ai_model):
        yield event


async def _stage_classification(doc: 'fitz.Document', ai_model: str, odl_pages: Dict[int, Dict[str, Any]]) -> Tuple[List, List, List, List, List]:
    """Initial pass to classify slides and route them to text/vision queues."""
    def _sync():
        t_batch, v_queue, tbl_queue = [], [], []
        cls, texts = [], []
        use_v = _vision_available(ai_model)
        
        for i, page in enumerate(doc):
            odl = odl_pages.get(i + 1, {})
            raw = odl.get("text") or page.get_text("text").strip()
            texts.append(raw)
            
            stype = classify_slide(page)
            txt, tokens = safe_truncate_text(raw)
            meta = is_metadata_slide(txt, i, len(doc), ai_model)
            if meta.get("is_metadata"):
                stype = SlideType.METADATA
                
            cls.append((stype, txt, tokens, []))
            
            # Dynamic Routing: Use Vision if classified so OR if text is unexpectedly empty
            use_vision_engine = use_v and (needs_vision(stype) or (not txt.strip() and stype != SlideType.METADATA))
            
            engine = "Text"
            if use_vision_engine:
                engine = "Vision"
                q = tbl_queue if stype == SlideType.TABLE else v_queue
                q.append({"index": i, "page_number": i + 1, "page": page, "text": txt, "slide_type": stype})
            elif stype != SlideType.METADATA:
                t_batch.append({"index": i, "page_number": i + 1, "text": txt})
            else:
                engine = "Skip (Metadata)"
            
            logger.info("Slide %d: Type=%s, Engine=%s", i + 1, stype.name, engine)
                
        return t_batch, v_queue, tbl_queue, cls, texts

    return await asyncio.to_thread(_sync)


async def _stage_planning(pdf_bytes: bytes, pdf_hash: str, all_text: List[str], ai_model: str, total_pages: int) -> Optional[Dict[str, Any]]:
    """Generates a narrative blueprint for the entire lecture."""
    blueprint = await get_cached_blueprint(pdf_hash, version=BLUEPRINT_VERSION)
    if blueprint: return blueprint
    
    from backend.services.ai_service import cerebras_client
    plan_model = "cerebras" if cerebras_client else "groq"
    
    try:
        outline = await _extract_document_outline(pdf_bytes)
        summary = ""
        async for event in generate_hierarchical_summary(all_text, outline, plan_model):
            if event["type"] == "result": summary = event["data"]
            
        first_3 = [t for t in all_text[:3] if t.strip()]
        async for event in generate_blueprint(outline, summary, first_3, plan_model):
            if event["type"] == "result": blueprint = event["data"]
            
        if blueprint: 
            await store_cached_blueprint(pdf_hash, blueprint, version=BLUEPRINT_VERSION)
        return blueprint
    except Exception as e:
        logger.error("Planning phase failed: %s", e)
        return None


async def _stage_processing(text_batch: List, vision_queue: List, table_queue: List, ai_model: str, blueprint: Optional[Dict]) -> Tuple[Dict, Dict]:
    """Parallel execution of text analysis and vision processing for a specific batch."""
    text_results, vision_results = {}, {}
    
    async def _process_text():
        if not text_batch: return
        results = await batch_analyze_text_slides(text_batch, ai_model=ai_model, blueprint=blueprint)
        for res in results:
            text_results[res["index"]] = res

    async def _process_vision():
        tasks = []
        for item in vision_queue + table_queue:
            tasks.append(_process_single_vision(item, ai_model, blueprint))
        v_results = await asyncio.gather(*tasks, return_exceptions=True)
        for res in v_results:
            if isinstance(res, dict) and "index" in res:
                vision_results[res["index"]] = res

    await asyncio.gather(_process_text(), _process_vision())
    return text_results, vision_results


async def _process_single_vision(item: Dict, ai_model: str, blueprint: Optional[Dict]) -> Dict:
    """Handles rendering and analysis for a single vision slide."""
    try:
        image_bytes = await asyncio.to_thread(_render_page_to_jpeg, item["page"])
        import base64
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        
        ctx = ""
        if blueprint:
            from backend.services.planner_service import get_slide_context
            ctx = get_slide_context(blueprint, item["index"])

        vision_res = await analyze_slide_vision(b64, item["text"], ai_model, ctx)
        vision_res["index"] = item["index"]
        
        if "content_extraction" in vision_res:
            from backend.services.ai.vision import format_slide_content
            ce = vision_res["content_extraction"]
            vision_res["content"] = format_slide_content(ce)
            vision_res["title"] = vision_res.get("metadata", {}).get("lecture_title") or ce.get("main_topic")
            vision_res["summary"] = ce.get("summary")
            vision_res["questions"] = [vision_res["quiz"]] if vision_res.get("quiz") else []
                
        return vision_res
    except Exception as e:
        logger.error("Vision processing failed for slide %d: %s", item["index"], e)
        return {"index": item["index"], "parse_error": str(e)}


async def _stage_yield_batch(doc: 'fitz.Document', start: int, end: int, cls: List, t_res: Dict, v_res: Dict, filename: str, ai_model: str, pdf_hash: str, odl_pages: Optional[Dict[int, Dict[str, Any]]] = None) -> AsyncGenerator[Dict, None]:
    """Yields results for a specific index range."""
    for i in range(start, end):
        stype, text, tokens, _ = cls[i]
        t_start = time.monotonic()

        res = t_res.get(i) or v_res.get(i)
        if not res:
            res = {"title": f"Slide {i+1}", "content": text, "slide_type": stype.value, "summary": "", "questions": []}
            if stype == SlideType.METADATA: res["is_metadata"] = True

        ai_title = res.get("title", "")
        if not ai_title or ai_title == f"Slide {i+1}":
            odl_title = odl_pages.get(i + 1, {}).get("title") if odl_pages else None
            res["title"] = odl_title or extract_visual_title(doc[i]) or f"Slide {i+1}"

        res["slide_index"] = i
        engine_used = "Vision" if i in v_res else ("Text" if i in t_res else "Heuristic")
        res["_meta"] = {
            "filename": filename, "page": i+1, "type": stype.value, "engine": engine_used,
            "tokens": tokens, "parse_time_ms": int((time.monotonic()-t_start)*1000)
        }
        
        # Async background storage (checkpointing)
        asyncio.create_task(_cache_slide_result(i, None, res, text, filename, ai_model, tokens, pdf_hash))
        yield {"type": "slide", "index": i, "slide": res}


async def _cache_slide_result(index: int, embedding: Optional[List[float]], result: Dict, text: str, filename: str, ai_model: str, tokens: int, pdf_hash: str):
    """Stores slide data in the database cache asynchronously."""
    try:
        from backend.services.cache import store_slide_embedding
        smeta = {
            "slide_type": result.get("slide_type"), 
            "vision_used": "vision" in result.get("slide_type", ""), 
            "parse_success": "parse_error" not in result, 
            "tokens": tokens, "model": ai_model, 
            "lecture_title": result.get("title", filename)
        }
        content_hash = hashlib.md5(text.encode()).hexdigest() if text else "empty"
        await store_slide_embedding(None, index, embedding, smeta, content_hash, pdf_hash=pdf_hash)
    except Exception as e:
        logger.warning("Failed to cache slide %d: %s", index, e)


async def _stage_finalize_deck(classifications: List, blueprint: Optional[Dict], ai_model: str):
    """Generates final lecture-wide summary and quiz."""
    try:
        from backend.services.ai_service import cerebras_client
        final_model = "cerebras" if cerebras_client else ai_model
        
        if blueprint and blueprint.get("overall_summary"):
            summary = blueprint["overall_summary"]
        else:
            all_text = "\n\n".join(f"[Slide {i+1}] {c[1]}" for i,c in enumerate(classifications) if c[0] not in (SlideType.TITLE, SlideType.METADATA))
            summary = await generate_deck_summary(all_text, final_model)
            
        quiz = await generate_deck_quiz(summary, final_model)
        yield {"type": "deck_complete", "deck_summary": summary, "deck_quiz": quiz}
        yield {"type": "complete", "total": len(classifications)}
    except Exception as e:
        logger.error("Finalization failed: %s", e)
        yield {"type": "error", "message": "Failed to generate deck summary."}


async def _extract_document_outline(pdf_bytes: bytes) -> List[Dict[str, Any]]:
    """Extracts the Table of Contents from the PDF metadata."""
    try:
        doc = await asyncio.to_thread(fitz.open, stream=pdf_bytes, filetype="pdf")
        toc = doc.get_toc()
        await asyncio.to_thread(doc.close)
        return [{"level": entry[0], "title": entry[1], "page": entry[2]} for entry in toc]
    except Exception:
        return []
