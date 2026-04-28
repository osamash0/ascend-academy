from typing import List, Dict, Any
import io
import asyncio
import time
from pypdf import PdfReader
from backend.services.ai_service import enhance_slide_content, generate_summary, generate_quiz, generate_slide_title, process_slide_batch
from backend.services.content_filter import is_metadata_slide


def parse_pdf(file_content: bytes, ai_model: str = "llama3") -> List[Dict[str, Any]]:
    """
    Parses a PDF and extracts text content per page.
    Uses a 3-layer content filter to skip metadata slides, then
    enhances educational content with AI for better student experience.
    """
    slides = []

    pdf_file = io.BytesIO(file_content)
    reader = PdfReader(pdf_file)
    total_pages = len(reader.pages)

    for i, page in enumerate(reader.pages):
        raw_text = page.extract_text()

        if not raw_text or not raw_text.strip():
            raw_text = "[No extractable text on this page. It may be image-based.]"

        # --- Content Filter: Skip metadata slides ---
        filter_result = is_metadata_slide(
            raw_text, slide_index=i, total_slides=total_pages, ai_model=ai_model
        )

        if filter_result["is_metadata"]:
            print(
                f"DEBUG: Slide {i+1} filtered as METADATA "
                f"(layer={filter_result['layer']}, "
                f"confidence={filter_result['confidence']:.2f}): "
                f"{filter_result['reason']}"
            )
            slides.append({
                "title": f"Slide {i + 1}",
                "content": raw_text,
                "summary": "",
                "questions": [],
                "is_metadata": True,
            })
            continue

        # --- AI Enhancement for educational slides ---
        try:
            batch_res = process_slide_batch(raw_text, ai_model=ai_model)
            
            # Pace requests strictly to avoid hitting Groq/Gemini free-tier RPM and TPM limits
            import time
            time.sleep(2)
            enhanced_content = batch_res.get("enhanced_content", raw_text)
            summary = batch_res.get("summary", "")
            quiz_data = batch_res.get("quiz", {})
            ai_title = batch_res.get("title", "")
            title = ai_title if ai_title else f"Slide {i + 1}"
        except Exception as e:
            print(f"DEBUG: AI Processing failed for slide {i+1}: {e}")
            enhanced_content = raw_text
            summary = ""
            quiz_data = {
                "question": "",
                "options": ["", "", "", ""],
                "correctAnswer": 0,
            }
            title = f"Slide {i + 1}"

        slides.append({
            "title": title,
            "content": enhanced_content,
            "summary": summary,
            "questions": [
                {
                    "question": quiz_data.get("question", ""),
                    "options": quiz_data.get("options", ["", "", "", ""]),
                    "correctAnswer": quiz_data.get("correctAnswer", 0),
                }
            ],
        })

    return slides


def parse_pdf_stream(file_content: bytes, ai_model: str = "llama3"):
    """
    Generator version of parse_pdf that yields progress updates.
    Yields: {"type": "progress", "current": int, "total": int, "message": str}
    Final Yield: {"type": "complete", "slides": list}
    """
    slides = []
    pdf_file = io.BytesIO(file_content)
    reader = PdfReader(pdf_file)
    total_pages = len(reader.pages)

    yield {"type": "progress", "current": 0, "total": total_pages, "message": "Starting PDF parsing..."}

    for i, page in enumerate(reader.pages):
        current_page = i + 1
        yield {"type": "progress", "current": current_page, "total": total_pages, "message": f"Processing slide {current_page} of {total_pages}..."}
        
        raw_text = page.extract_text()
        if not raw_text or not raw_text.strip():
            raw_text = "[No extractable text on this page. It may be image-based.]"

        filter_result = is_metadata_slide(raw_text, slide_index=i, total_slides=total_pages, ai_model=ai_model)

        if filter_result["is_metadata"]:
            slides.append({
                "title": f"Slide {current_page}",
                "content": raw_text,
                "summary": "",
                "questions": [],
                "is_metadata": True,
            })
            continue

        try:
            batch_res = process_slide_batch(raw_text, ai_model=ai_model)
            time.sleep(1.5) # Slightly faster sleep
            enhanced_content = batch_res.get("enhanced_content", raw_text)
            summary = batch_res.get("summary", "")
            quiz_data = batch_res.get("quiz", {})
            ai_title = batch_res.get("title", "")
            title = ai_title if ai_title else f"Slide {current_page}"
        except Exception as e:
            enhanced_content = raw_text
            summary = ""
            quiz_data = {"question": "", "options": ["", "", "", ""], "correctAnswer": 0}
            title = f"Slide {current_page}"

        slides.append({
            "title": title,
            "content": enhanced_content,
            "summary": summary,
            "questions": [{
                "question": quiz_data.get("question", ""),
                "options": quiz_data.get("options", ["", "", "", ""]),
                "correctAnswer": quiz_data.get("correctAnswer", 0),
            }],
        })

    yield {"type": "complete", "slides": slides, "total": len(slides)}
