from typing import List, Dict, Any
import io
from pypdf import PdfReader


def parse_pdf(file_content: bytes) -> List[Dict[str, Any]]:
    """
    Parses a PDF and extracts text content per page.
    Returns one slide dict per page.
    """
    slides = []

    pdf_file = io.BytesIO(file_content)
    reader = PdfReader(pdf_file)

    for i, page in enumerate(reader.pages):
        text = page.extract_text()

        if not text or not text.strip():
            text = "[No extractable text on this page. It may be image-based.]"

        slides.append({
            "title": f"Slide {i + 1}",
            "content": text.strip(),
            "summary": "",
            "questions": [
                {
                    "question": "",
                    "options": ["", "", "", ""],
                    "correctAnswer": 0,
                }
            ],
        })

    return slides
