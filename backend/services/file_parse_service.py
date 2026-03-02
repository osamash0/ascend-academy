from typing import List, Dict, Any
import io
import asyncio
from pypdf import PdfReader
from backend.services.ai_service import enhance_slide_content, generate_summary, generate_quiz, generate_slide_title


def parse_pdf(file_content: bytes) -> List[Dict[str, Any]]:
    """
    Parses a PDF and extracts text content per page.
    Enhances content with AI for better student experience.
    """
    slides = []

    pdf_file = io.BytesIO(file_content)
    reader = PdfReader(pdf_file)

    for i, page in enumerate(reader.pages):
        raw_text = page.extract_text()

        if not raw_text or not raw_text.strip():
            raw_text = "[No extractable text on this page. It may be image-based.]"

        # AI Enhancement
        # Note: In a production environment, we might want to do this in parallel
        # but for simplicity and reliability here, we'll do it sequentially.
        try:
            enhanced_content = enhance_slide_content(raw_text)
            summary = generate_summary(enhanced_content)
            quiz_data = generate_quiz(enhanced_content)

            # Generate a meaningful AI title for the slide
            ai_title = generate_slide_title(enhanced_content)
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
