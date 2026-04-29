from typing import List, Dict, Any, Optional
import asyncio
import io
import base64
import time
import logging

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
    print("⚠️  pdf2image / Pillow not installed — run: pip install pdf2image pillow")
    print("    Also requires poppler: brew install poppler  (macOS) | apt install poppler-utils (Linux)")

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
    _VISION_SLIDE_TYPES_METADATA,
)
from backend.services.content_filter import is_metadata_slide


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


def _page_to_base64(pdf_bytes: bytes, page_num: int, dpi: int = 120) -> Optional[str]:
    """
    Convert a single PDF page (1-indexed) to a base64 JPEG string.
    Returns None when pdf2image / poppler is unavailable or conversion fails.
    """
    if not _PDF2IMAGE_AVAILABLE:
        return None
    try:
        images = convert_from_bytes(pdf_bytes, dpi=dpi, first_page=page_num, last_page=page_num)
        if not images:
            return None
        img = images[0].convert("RGB")
        # Cap width at 1280 px — enough detail for the vision model, keeps payload small
        if img.width > 1280:
            ratio = 1280 / img.width
            img = img.resize((1280, int(img.height * ratio)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return base64.b64encode(buf.getvalue()).decode("utf-8")
    except Exception as e:
        logger.error("Image conversion failed for page %s: %s", page_num, e)
        return None


def _vision_available(ai_model: str) -> bool:
    return _PDF2IMAGE_AVAILABLE and ai_model in ("groq", "gemini-2.5-flash", "gemini-1.5-flash")


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
        content_md = raw_text  # last resort: raw extracted text

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
    """Map process_slide_batch() output → slide dict (text-only fallback)."""
    raw = batch_res.get("enhanced_content", "")
    quiz_data = batch_res.get("quiz", {})
    return {
        "title": batch_res.get("title") or f"Slide {current_page}",
        "content": raw,
        "summary": batch_res.get("summary", ""),
        "questions": [{
            "question": quiz_data.get("question", ""),
            "options": quiz_data.get("options", ["", "", "", ""]),
            "correctAnswer": quiz_data.get("correctAnswer", 0),
        }],
        "is_metadata": False,
        "slide_type": "content_slide",
    }


# ---------------------------------------------------------------------------
# Blocking (non-streaming) parser — used by /parse-pdf endpoint
# ---------------------------------------------------------------------------

def parse_pdf(file_content: bytes, ai_model: str = "groq") -> List[Dict[str, Any]]:
    slides = []
    total_pages = _get_page_count(file_content)
    use_vision = _vision_available(ai_model)

    for i in range(total_pages):
        current_page = i + 1
        raw_text = _extract_text_page(file_content, i)

        if use_vision:
            b64 = _page_to_base64(file_content, current_page)
            if b64:
                try:
                    analysis = analyze_slide_vision(b64, raw_text, ai_model)
                    time.sleep(1.5)
                    slides.append(_build_slide_from_vision(analysis, current_page, raw_text))
                    continue
                except Exception as e:
                    logger.warning("Vision failed for slide %s, falling back to text: %s", current_page, e)

        # Text-only path (Ollama, or vision unavailable/failed)
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
# Async streaming generator — used by /parse-pdf-stream endpoint
# ---------------------------------------------------------------------------

async def parse_pdf_stream(file_content: bytes, ai_model: str = "groq"):
    """
    Async generator that yields:
        {"type": "progress", "current": int, "total": int, "message": str}
        {"type": "slide",    "index": int,   "slide": dict}
        {"type": "complete", "total": int}
    """
    loop = asyncio.get_event_loop()
    total_pages = await loop.run_in_executor(None, _get_page_count, file_content)
    use_vision = _vision_available(ai_model)
    slides_processed = 0

    yield {"type": "progress", "current": 0, "total": total_pages, "message": "Starting PDF analysis..."}

    for i in range(total_pages):
        current_page = i + 1
        yield {
            "type": "progress",
            "current": current_page,
            "total": total_pages,
            "message": f"Analyzing slide {current_page} of {total_pages}...",
        }

        # Text extraction (fast, fitz or pypdf)
        raw_text = await loop.run_in_executor(None, _extract_text_page, file_content, i)

        if use_vision:
            # Convert page to image in thread
            b64 = await loop.run_in_executor(None, _page_to_base64, file_content, current_page)

            if b64:
                try:
                    analysis = await loop.run_in_executor(
                        None, analyze_slide_vision, b64, raw_text, ai_model
                    )
                    await asyncio.sleep(1.5)  # non-blocking rate-limit pacing
                    yield {
                        "type": "slide",
                        "index": i,
                        "slide": _build_slide_from_vision(analysis, current_page, raw_text),
                    }
                    slides_processed += 1
                    continue
                except Exception as e:
                    logger.warning("Vision failed for slide %s, falling back to text: %s", current_page, e)

        # --- Text-only fallback ---
        if not raw_text:
            raw_text = "[No extractable text on this page. It may be image-based.]"

        filter_result = await loop.run_in_executor(
            None, is_metadata_slide, raw_text, i, total_pages, ai_model
        )

        if filter_result["is_metadata"]:
            yield {
                "type": "slide",
                "index": i,
                "slide": {
                    "title": f"Slide {current_page}", "content": raw_text,
                    "summary": "", "questions": [], "is_metadata": True, "slide_type": "meta_slide",
                },
            }
            slides_processed += 1
            continue

        try:
            batch_res = await loop.run_in_executor(None, process_slide_batch, raw_text, ai_model)
            await asyncio.sleep(1.0)
            yield {
                "type": "slide",
                "index": i,
                "slide": _build_slide_from_text(batch_res, current_page),
            }
        except Exception as e:
            logger.error("Text processing failed for slide %s: %s", current_page, e)
            yield {
                "type": "slide",
                "index": i,
                "slide": {
                    "title": f"Slide {current_page}", "content": raw_text,
                    "summary": "", "questions": [], "is_metadata": False, "slide_type": "content_slide",
                },
            }
        slides_processed += 1

    yield {"type": "complete", "total": slides_processed}
