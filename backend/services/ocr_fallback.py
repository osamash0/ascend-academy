"""
OCR fallback — last-resort text extraction for scanned slides.

Only triggered when:
  a) No vision API is available (Ollama-only mode, ai_model not in {"groq", "gemini-2.0-flash"})
  b) The slide appears scanned/garbage (layout.alpha_ratio < 0.25)

When Groq or Gemini vision is available, scanned slides are routed to the
VLM instead — vision models handle STEM symbols, equations, and arbitrary
fonts far better than Tesseract.

PaddleOCR removed: multi-GB dependency superseded by VLM vision for tables.
Tesseract charset whitelist removed: it was stripping Greek letters, math
operators (∑∫∏), and other STEM symbols essential for lecture content.
"""
import asyncio
import io
import logging

from PIL import Image

logger = logging.getLogger(__name__)

_VISION_MODELS = frozenset({"groq", "gemini-2.0-flash"})


class OCRFallback:
    """Lightweight Tesseract-based text recovery for Ollama-only deployments."""

    @staticmethod
    def is_needed(ai_model: str, alpha_ratio: float) -> bool:
        """
        Returns True only when:
          - No vision API is available (ai_model not a VLM provider), AND
          - The slide's alpha_ratio indicates scanned/garbage text (< 0.25)
        """
        return ai_model not in _VISION_MODELS and alpha_ratio < 0.25

    @staticmethod
    async def extract_text(image_bytes: bytes) -> str:
        """Async wrapper — dispatches Tesseract to thread pool."""
        return await asyncio.to_thread(OCRFallback._sync_extract, image_bytes)

    @staticmethod
    def _sync_extract(image_bytes: bytes) -> str:
        try:
            import pytesseract
            image = Image.open(io.BytesIO(image_bytes))
            # --oem 3: LSTM engine; --psm 6: uniform block of text
            # No charset whitelist — preserves Greek, math operators, STEM symbols
            return pytesseract.image_to_string(image, config="--oem 3 --psm 6").strip()
        except Exception as e:
            logger.warning("OCR extraction failed: %s", e)
            return ""
