from typing import List, Dict, Any, Optional
import asyncio
import io
import base64
import time
import logging
import hashlib

logger = logging.getLogger(__name__)

# --- Optional vision dependencies ---
try:
    import fitz  # PyMuPDF
    _FITZ_AVAILABLE = True
except ImportError:
    _FITZ_AVAILABLE = False
    print("⚠️  PyMuPDF not installed — run: pip install PyMuPDF")

try:
    from pdf2image import convert_from_bytes
    from PIL import Image
    _PDF2IMAGE_AVAILABLE = True
except ImportError:
    _PDF2IMAGE_AVAILABLE = False

# pypdf kept as a lightweight fallback for page counts when fitz is absent
try:
    from pypdf import PdfReader as _PdfReader
    _PYPDF_AVAILABLE = True
except ImportError:
    _PYPDF_AVAILABLE = False

from backend.services.ai_service import (
    process_slide_batch,
    analyze_slide_vision,
    format_slide_content,
    safe_truncate_text,
    batch_analyze_text_slides,
    generate_deck_summary,
    generate_deck_quiz,
    _VISION_SLIDE_TYPES_METADATA,
)
from backend.services.content_filter import is_metadata_slide
from backend.services.slide_classifier import classify_slide_with_routing as classify_slide, SlideType, needs_vision, detect_garbage_text
from backend.services.slide_utils import extract_visual_title
from backend.services.cache import compute_pdf_hash, get_cached_blueprint, store_cached_blueprint
from backend.services.summarizer_service import generate_hierarchical_summary
from backend.services.planner_service import generate_blueprint, get_slide_context, BLUEPRINT_VERSION
from backend.services.ocr_fallback import OCRFallback
from backend.services.ai_service import analyze_diagram_slide


# ---------------------------------------------------------------------------
# PDF utility helpers
# ---------------------------------------------------------------------------

def _get_page_count(pdf_bytes: bytes) -> int:
    if _FITZ_AVAILABLE:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        n = len(doc)
        doc.close()
        return n
    if _PYPDF_AVAILABLE:
        return len(_PdfReader(io.BytesIO(pdf_bytes)).pages)
    return 0


def _extract_document_outline(pdf_bytes: bytes) -> List[Dict[str, Any]]:
    """Extract TOC from PDF. Returns a list of {'level': int, 'title': str, 'page': int}."""
    if not _FITZ_AVAILABLE:
        return []
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        toc = doc.get_toc() # [[level, title, page, ...], ...]
        outline = []
        for entry in toc:
            outline.append({
                "level": entry[0],
                "title": entry[1],
                "page": entry[2]
            })
        
        if not outline:
            # Fallback to heading detection heuristic
            outline = _detect_headings_fallback(doc)
            
        doc.close()
        return outline
    except Exception as e:
        logger.warning("Failed to extract document outline: %s", e)
        return []


def _detect_headings_fallback(doc: fitz.Document) -> List[Dict[str, Any]]:
    """Heuristic to detect multi-level headings based on font size and position."""
    outline = []
    # Sample first 50 pages or doc length
    max_pages = min(len(doc), 50)
    
    # Track font sizes to determine hierarchy
    font_sizes = []
    
    for i in range(max_pages):
        page = doc[i]
        blocks = page.get_text("dict")["blocks"]
        page_height = page.rect.height
        
        for b in blocks:
            if "lines" not in b: continue
            if b["bbox"][1] > page_height * 0.4: continue # Header region
            
            for l in b["lines"]:
                for s in l["spans"]:
                    text = s["text"].strip()
                    if 3 < len(text) < 100:
                        font_sizes.append(s["size"])
    
    if not font_sizes:
        return []
        
    # Determine thresholds for levels (simple percentile-based)
    font_sizes.sort(reverse=True)
    unique_sizes = sorted(list(set(font_sizes)), reverse=True)
    # Map size -> level (1 is largest)
    size_to_level = {}
    for idx, size in enumerate(unique_sizes[:3]): # Top 3 sizes as potential headers
        size_to_level[size] = idx + 1

    for i in range(max_pages):
        page = doc[i]
        blocks = page.get_text("dict")["blocks"]
        page_height = page.rect.height
        title_candidates = []
        
        for b in blocks:
            if "lines" not in b: continue
            if b["bbox"][1] > page_height * 0.4: continue
            
            for l in b["lines"]:
                for s in l["spans"]:
                    text = s["text"].strip()
                    if len(text) < 3 or len(text) > 120: continue
                    
                    is_bold = "bold" in s["font"].lower() or (s["flags"] & 16)
                    level = size_to_level.get(s["size"], 3) # Default to level 3 if not in top sizes
                    
                    # Score by size and Y-position
                    pos_score = 1.2 if s["origin"][1] < page_height * 0.15 else 1.0
                    score = s["size"] * pos_score * (1.3 if is_bold else 1.0)
                    
                    title_candidates.append({
                        "score": score,
                        "text": text,
                        "level": level,
                        "page": i + 1
                    })
        
        if title_candidates:
            best = max(title_candidates, key=lambda x: x["score"])
            if best["score"] > 14: # Lowered threshold for multi-level
                if not outline or outline[-1]["title"] != best["text"]:
                    outline.append({
                        "level": best["level"],
                        "title": best["text"],
                        "page": best["page"]
                    })
                    
    return outline


def _extract_text_page(pdf_bytes: bytes, page_index: int) -> str:
    """Extract selectable text from one page (0-indexed). Returns '' for image-only pages."""
    if _FITZ_AVAILABLE:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        text = doc[page_index].get_text().strip()
        doc.close()
        return text
    if _PYPDF_AVAILABLE:
        reader = _PdfReader(io.BytesIO(pdf_bytes))
        if page_index < len(reader.pages):
            return (reader.pages[page_index].extract_text() or "").strip()
    return ""


def render_page_to_jpeg(page: fitz.Page, width: int = 900) -> bytes:
    """Render a single PDF page to JPEG bytes at target width using PyMuPDF."""
    scale = width / page.rect.width
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    return pix.tobytes("jpeg", jpg_quality=85)


def _page_to_base64(pdf_bytes: bytes, page_num: int, dpi: int = 120) -> Optional[str]:
    """
    Compatibility shim for callers that still use the old pdf2image-based API.
    Accepts 1-indexed page_num, returns base64-encoded JPEG string.
    """
    if not _FITZ_AVAILABLE:
        return None
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page = doc[page_num - 1]  # convert to 0-indexed
        jpeg_bytes = render_page_to_jpeg(page, width=900)
        doc.close()
        return base64.b64encode(jpeg_bytes).decode("utf-8")
    except Exception as e:
        logger.error("_page_to_base64 failed for page %s: %s", page_num, e)
        return None


def _vision_available(ai_model: str) -> bool:
    return _FITZ_AVAILABLE and ai_model in ("groq", "gemini-1.5-flash", "gemini-1.5-flash")


def build_slide_meta(
    source_file: str,
    slide_number: int,
    slide_type: str,
    word_count: int,
    has_images: bool,
    vision_used: bool,
    tokens_input: int,
    processing_ms: int,
) -> dict:
    return {
        "source_file":   source_file,
        "slide_number":  slide_number,
        "slide_type":    slide_type,
        "word_count":    word_count,
        "has_images":    has_images,
        "vision_used":   vision_used,
        "tokens_input":  tokens_input,
        "processing_ms": processing_ms,
    }


def _build_slide_from_vision(analysis: dict, current_page: int, raw_text: str) -> dict:
    """Map analyze_slide_vision() output → the slide dict the API returns."""
    slide_type = analysis.get("slide_type", "content_slide")
    is_meta = slide_type in _VISION_SLIDE_TYPES_METADATA

    if is_meta:
        meta = analysis.get("metadata", {})
        title = meta.get("lecture_title") or f"Slide {current_page}"
        return {
            "title": title,
            "content": raw_text or "",
            "summary": "",
            "questions": [],
            "is_metadata": True,
            "slide_type": slide_type,
        }

    content_ext = analysis.get("content_extraction", {})
    quiz_data = analysis.get("quiz") or {}

    content_md = format_slide_content(content_ext)
    if not content_md.strip():
        content_md = raw_text

    questions = []
    if quiz_data.get("question"):
        questions = [{
            "question": quiz_data.get("question", ""),
            "options": quiz_data.get("options", ["", "", "", ""]),
            "correctAnswer": quiz_data.get("correctAnswer", 0),
        }]

    return {
        "title": content_ext.get("main_topic") or f"Slide {current_page}",
        "content": content_md,
        "summary": content_ext.get("summary", ""),
        "questions": questions,
        "is_metadata": False,
        "slide_type": slide_type,
    }


def _build_slide_from_text(batch_res: dict, current_page: int) -> dict:
    """Map process_slide_batch() / batch_analyze_text_slides() output → slide dict."""
    # Support both old schema (enhanced_content/quiz.correctAnswer) and new batch schema (content/questions)
    if "enhanced_content" in batch_res:
        raw = batch_res.get("enhanced_content", "")
        quiz_data = batch_res.get("quiz", {})
        questions = [{
            "question": quiz_data.get("question", ""),
            "options": quiz_data.get("options", ["", "", "", ""]),
            "correctAnswer": quiz_data.get("correctAnswer", 0),
        }]
        return {
            "title": batch_res.get("title") or f"Slide {current_page}",
            "content": raw,
            "summary": batch_res.get("summary", ""),
            "questions": questions,
            "is_metadata": False,
            "slide_type": "content_slide",
        }
    else:
        # New batch schema from batch_analyze_text_slides()
        raw_questions = batch_res.get("questions", [])
        questions = []
        for q in raw_questions:
            if not isinstance(q, dict):
                continue
            options = q.get("options", ["", "", "", ""])
            answer_letter = q.get("answer", "A")
            answer_map = {"A": 0, "B": 1, "C": 2, "D": 3}
            correct_idx = answer_map.get(answer_letter, 0)
            questions.append({
                "question": q.get("question", ""),
                "options": options,
                "correctAnswer": correct_idx,
            })
        return {
            "title": batch_res.get("title") or f"Slide {current_page}",
            "content": batch_res.get("content", ""),
            "summary": batch_res.get("summary", ""),
            "questions": questions,
            "is_metadata": batch_res.get("is_metadata", False),
            "slide_type": batch_res.get("slide_type", "content_slide"),
        }


# ---------------------------------------------------------------------------
# Blocking (non-streaming) parser — used by /parse-pdf endpoint
# LEFT UNCHANGED as rollback path.
# ---------------------------------------------------------------------------

def parse_pdf(file_content: bytes, ai_model: str = "groq") -> List[Dict[str, Any]]:
    slides = []
    total_pages = _get_page_count(file_content)
    use_vision = _vision_available(ai_model)

    for i in range(total_pages):
        current_page = i + 1
        raw_text = _extract_text_page(file_content, i)

        if use_vision:
            # Legacy base64 path for blocking endpoint
            if _PDF2IMAGE_AVAILABLE:
                images = convert_from_bytes(file_content, dpi=120, first_page=current_page, last_page=current_page)
                if images:
                    try:
                        img = images[0].convert("RGB")
                        if img.width > 1280:
                            ratio = 1280 / img.width
                            img = img.resize((1280, int(img.height * ratio)), Image.LANCZOS)
                        buf = io.BytesIO()
                        img.save(buf, format="JPEG", quality=85)
                        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
                        analysis = analyze_slide_vision(b64, raw_text, ai_model)
                        time.sleep(1.5)
                        slides.append(_build_slide_from_vision(analysis, current_page, raw_text))
                        continue
                    except Exception as e:
                        logger.warning("Vision failed for slide %s, falling back to text: %s", current_page, e)

        if not raw_text:
            raw_text = "[No extractable text on this page. It may be image-based.]"

        filter_result = is_metadata_slide(raw_text, slide_index=i, total_slides=total_pages, ai_model=ai_model)
        if filter_result["is_metadata"]:
            slides.append({
                "title": f"Slide {current_page}", "content": raw_text,
                "summary": "", "questions": [], "is_metadata": True, "slide_type": "meta_slide",
            })
            continue

        try:
            batch_res = process_slide_batch(raw_text, ai_model=ai_model)
            time.sleep(2)
            slides.append(_build_slide_from_text(batch_res, current_page))
        except Exception as e:
            logger.error("Text processing failed for slide %s: %s", current_page, e)
            slides.append({
                "title": f"Slide {current_page}", "content": raw_text,
                "summary": "", "questions": [], "is_metadata": False, "slide_type": "content_slide",
            })

    return slides


# ---------------------------------------------------------------------------
# Async streaming generator — two-pass pipeline
# ---------------------------------------------------------------------------

async def parse_pdf_stream(pdf_bytes: bytes, filename: str = "upload.pdf", ai_model: str = "groq", use_blueprint: bool = True):
    """
    Three-pass async generator refactored into distinct stages.
    """
    if not _FITZ_AVAILABLE:
        yield {"type": "error", "message": "PyMuPDF is not installed on this server."}
        return

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    total_pages = len(doc)
    pdf_hash = compute_pdf_hash(pdf_bytes)

    try:
        # Stage 1: Classification & Extraction
        yield {"type": "progress", "current": 0, "total": total_pages, "message": "Classifying slides..."}
        text_batch, vision_queue, table_queue, classifications, all_extracted_text = await _stage_classification(doc, ai_model)

        # Stage 2: Planning Phase
        blueprint = None
        if use_blueprint:
            yield {"type": "progress", "current": 0, "total": total_pages, "message": "Planning lecture structure..."}
            blueprint = await _stage_planning(pdf_bytes, pdf_hash, all_extracted_text, ai_model, total_pages)

        # Stage 3: Concurrent Processing
        yield {"type": "progress", "current": 0, "total": total_pages, "message": "Analyzing slide content..."}
        text_results, vision_results = await _stage_processing(text_batch, vision_queue, table_queue, ai_model, blueprint)

        # Stage 4: Result Assembly
        async for event in _stage_yield_results(doc, classifications, text_results, vision_results, blueprint, filename, ai_model, pdf_hash):
            yield event
    finally:
        doc.close()
    
    # Final Stage: Deck Summary & Quiz
    async for event in _stage_finalize_deck(classifications, blueprint, ai_model):
        yield event


async def _stage_classification(doc, ai_model: str):
    text_batch, vision_queue, table_queue = [], [], []
    classifications, all_extracted_text = [], []
    use_vision = _vision_available(ai_model)

    # 1.1 Parallel Embedding Generation
    from backend.services.ai_service import generate_embeddings
    
    embedding_tasks = [generate_embeddings(page.get_text("text").strip()) for page in doc]
    all_embeddings = await asyncio.gather(*embedding_tasks)

    for i, page in enumerate(doc):
        raw_text = page.get_text("text").strip()
        all_extracted_text.append(raw_text)
        
        # Learning Router
        from backend.services.cache import get_similar_slides
        
        slide_embedding = all_embeddings[i]
        similar_slides = await get_similar_slides(slide_embedding, limit=3, threshold=0.85)
        
        routing_hint = None
        slide_type = classify_slide(page)
        
        if similar_slides:
            smeta = similar_slides[0].get("metadata", {})
            if smeta.get("parse_success"):
                routing_hint = "vision" if smeta.get("vision_used") else "text"
                if smeta.get("slide_type") in ["table_slide", "diagram_slide"]:
                    slide_type = SlideType.TABLE if smeta.get("slide_type") == "table_slide" else SlideType.DIAGRAM

        text, token_count = safe_truncate_text(raw_text)
        meta_result = is_metadata_slide(text, i, len(doc), ai_model)
        if meta_result.get("is_metadata"): slide_type = SlideType.METADATA
        
        classifications.append((slide_type, text, token_count, slide_embedding))

        if use_vision and (needs_vision(slide_type) or routing_hint == "vision"):
            queue = table_queue if slide_type == SlideType.TABLE else vision_queue
            queue.append({"index": i, "page_number": i + 1, "page": page, "text": text, "slide_type": slide_type})
        elif slide_type != SlideType.METADATA:
            text_batch.append({"index": i, "page_number": i + 1, "text": text})

    return text_batch, vision_queue, table_queue, classifications, all_extracted_text


async def _stage_planning(pdf_bytes: bytes, pdf_hash: str, all_text: list, ai_model: str, total_pages: int):
    blueprint = await get_cached_blueprint(pdf_hash, version=BLUEPRINT_VERSION)
    if blueprint: return blueprint
    
    # Optimization: Use Cerebras (ultra-fast) or Groq-70b for planning
    from backend.services.ai_service import cerebras_client
    plan_model = "cerebras" if cerebras_client else "groq"
    
    try:
        outline = _extract_document_outline(pdf_bytes)
        summary = ""
        async for event in generate_hierarchical_summary(all_text, outline, plan_model):
            if event["type"] == "result": summary = event["data"]
            
        first_3 = [t for t in all_text[:3] if t.strip()]
        async for event in generate_blueprint(outline, summary, first_3, plan_model):
            if event["type"] == "result": blueprint = event["data"]
            
        if blueprint: await store_cached_blueprint(pdf_hash, blueprint, version=BLUEPRINT_VERSION)
        return blueprint
    except Exception as e:
        logger.warning("Planning Phase failed: %s", e)
        return None


async def _stage_processing(text_batch, vision_queue, table_queue, ai_model, blueprint):
    vision_results = {}
    semaphore = asyncio.Semaphore(3)
    loop = asyncio.get_event_loop()

    async def _proc_v(vs):
        async with semaphore:
            try:
                img = render_page_to_jpeg(vs["page"])
                is_garbage, _ = detect_garbage_text(vs["text"])
                stype = vs.get("slide_type")
                bp_ctx = get_slide_context(blueprint, vs["index"])
                
                if is_garbage or stype == SlideType.DIAGRAM:
                    res = await analyze_diagram_slide(img, vs["text"], ai_model, False, bp_ctx)
                elif stype == SlideType.TABLE:
                    res = await analyze_diagram_slide(img, vs["text"], ai_model, True, bp_ctx)
                else:
                    res = await loop.run_in_executor(None, analyze_slide_vision, base64.b64encode(img).decode(), vs["text"], ai_model, bp_ctx)
                vision_results[vs["index"]] = res
            except Exception: vision_results[vs["index"]] = None

    async def _proc_t(ts):
        async with semaphore:
            try:
                img = render_page_to_jpeg(ts["page"])
                ocr_text = await OCRFallback.extract_tables_from_image(img)
                is_garbage, _ = detect_garbage_text(ocr_text)
                bp_ctx = get_slide_context(blueprint, ts["index"])
                
                if len(ocr_text) > 150 and not is_garbage:
                    vision_results[ts["index"]] = {"title": f"Table {ts['page_number']}", "content": ocr_text, "summary": "OCR Data", "questions": [], "slide_type": "table_slide", "is_metadata": False}
                else:
                    vision_results[ts["index"]] = await analyze_diagram_slide(img, ocr_text, ai_model, not is_garbage, bp_ctx)
            except Exception: vision_results[ts["index"]] = None

    tasks = []
    if text_batch:
        bp_ctx = blueprint.get("overall_summary", "") if blueprint else ""
        tasks.append(asyncio.create_task(batch_analyze_text_slides(text_batch, ai_model, blueprint_context=bp_ctx)))
    
    tasks.extend([_proc_v(vs) for vs in vision_queue])
    tasks.extend([_proc_t(ts) for ts in table_queue])
    
    results = await asyncio.gather(*tasks)
    text_results = results[0] if text_batch else {}
    return text_results, vision_results


async def _stage_yield_results(doc, classifications, text_results, vision_results, blueprint, filename, ai_model, pdf_hash):
    for i, _ in enumerate(doc):
        stype, text, tokens, embedding = classifications[i]
        t_start = time.monotonic()
        
        if stype == SlideType.METADATA:
            v_title = extract_visual_title(doc[i])
            bp_title = blueprint["slide_plans"][i].get("proposed_title") if (blueprint and i < len(blueprint.get("slide_plans", []))) else None
            res = {"title": v_title or bp_title or (text[:80] if text else f"Slide {i+1}"), "content": text, "summary": "", "questions": [], "slide_type": "title_slide", "is_metadata": True}
        elif needs_vision(stype):
            raw = vision_results.get(i)
            if raw is None:
                yield {"type": "slide_error", "index": i, "message": "Vision failed", "slide": {"title": f"Slide {i+1}", "content": text, "summary": "", "questions": [], "slide_type": "diagram_slide", "is_metadata": True}}
                continue
            res = raw if ("content" in raw and "questions" in raw) else _build_slide_from_vision(raw, i+1, text)
            # Normalize answer formats
            for q in res.get("questions", []):
                if isinstance(q.get("answer"), str): q["correctAnswer"] = {"A":0,"B":1,"C":2,"D":3}.get(q["answer"], 0)
        else:
            batch = text_results.get(i)
            if batch: res = _build_slide_from_text(batch, i+1)
            else:
                v_title = extract_visual_title(doc[i])
                bp_title = blueprint["slide_plans"][i].get("proposed_title") if (blueprint and i < len(blueprint.get("slide_plans", []))) else None
                res = {"title": v_title or bp_title or f"Slide {i+1}", "content": text, "summary": "", "questions": [], "slide_type": "content_slide", "is_metadata": False, "parse_error": "skipped"}

        res["_meta"] = build_slide_meta(filename, i+1, stype.value, len(text.split()), needs_vision(stype), needs_vision(stype), tokens, int((time.monotonic()-t_start)*1000))
        
        # Async cache storage
        asyncio.create_task(_cache_slide_result(i, embedding, res, text, filename, ai_model, tokens, pdf_hash))
        yield {"type": "slide", "index": i, "slide": res}


async def _cache_slide_result(index, embedding, result, text, filename, ai_model, tokens, pdf_hash):
    try:
        from backend.services.cache import store_slide_embedding
        smeta = {"slide_type": result.get("slide_type"), "vision_used": "vision" in result.get("slide_type", ""), "parse_success": "parse_error" not in result, "tokens": tokens, "model": ai_model, "lecture_title": result.get("title", filename)}
        await store_slide_embedding(None, index, embedding, smeta, hashlib.md5(text.encode()).hexdigest() if text else "empty", pdf_hash=pdf_hash)
    except Exception: pass


async def _stage_finalize_deck(classifications, blueprint, ai_model):
    # Optimization: Use Cerebras (ultra-fast) for final deck summary/quiz
    from backend.services.ai_service import cerebras_client
    final_model = "cerebras" if cerebras_client else ai_model
    
    try:
        if blueprint and blueprint.get("overall_summary"):
            summary, quiz = blueprint["overall_summary"], await generate_deck_quiz(blueprint["overall_summary"], final_model)
        else:
            all_text = "\n\n".join(f"[Slide {i+1}] {c[1]}" for i,c in enumerate(classifications) if c[0] not in (SlideType.TITLE, SlideType.METADATA))
            summary = await generate_deck_summary(all_text, final_model)
            quiz = await generate_deck_quiz(summary, final_model)
        yield {"type": "deck_complete", "deck_summary": summary, "deck_quiz": quiz, "total_slides": len(classifications)}
    except Exception as e:
        yield {"type": "deck_error", "data": {"error": str(e)}}
    yield {"type": "complete", "total": len(classifications)}
