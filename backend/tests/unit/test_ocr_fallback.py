"""Unit tests for backend.services.ocr_fallback.

Covers:
  * `OCRFallback.is_needed` decision matrix across vision-capable models and
    alpha-ratio thresholds.
  * `OCRFallback.extract_text` async path with `pytesseract` mocked so no
    Tesseract binary or PaddleOCR install is required.
  * `_sync_extract` swallowing of import / runtime errors so the pipeline
    never crashes when OCR is unavailable.
"""
from __future__ import annotations

import io
import sys
import types

import pytest
from PIL import Image

from backend.services import ocr_fallback
from backend.services.ocr_fallback import OCRFallback


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _png_bytes(width: int = 4, height: int = 4, color: str = "white") -> bytes:
    """Return PNG bytes for a tiny solid-colour image (no Tesseract involved)."""
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color=color).save(buf, format="PNG")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# is_needed
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("model", ["groq", "gemini-2.0-flash"])
def test_is_needed_false_for_vision_capable_model_low_alpha(model):
    """Vision-capable models always handle scanned slides themselves."""
    assert OCRFallback.is_needed(model, alpha_ratio=0.1) is False


@pytest.mark.parametrize("model", ["groq", "gemini-2.0-flash"])
def test_is_needed_false_for_vision_capable_model_high_alpha(model):
    assert OCRFallback.is_needed(model, alpha_ratio=0.9) is False


@pytest.mark.parametrize("model", ["ollama", "cerebras", "", "unknown"])
def test_is_needed_true_when_no_vision_and_low_alpha(model):
    """Non-VLM provider + scanned-looking text (< 0.25) must trigger OCR."""
    assert OCRFallback.is_needed(model, alpha_ratio=0.1) is True


@pytest.mark.parametrize("model", ["ollama", "cerebras", "unknown"])
def test_is_needed_false_when_no_vision_but_alpha_above_threshold(model):
    """Even without VLM, well-extracted text shouldn't be re-OCR'd."""
    assert OCRFallback.is_needed(model, alpha_ratio=0.5) is False


def test_is_needed_boundary_alpha_exactly_threshold():
    """The threshold is strict-less-than: 0.25 itself does NOT need OCR."""
    assert OCRFallback.is_needed("ollama", alpha_ratio=0.25) is False
    assert OCRFallback.is_needed("ollama", alpha_ratio=0.2499) is True


# ---------------------------------------------------------------------------
# extract_text — async wrapper around _sync_extract
# ---------------------------------------------------------------------------

async def test_extract_text_returns_pytesseract_output(monkeypatch):
    """Happy path: pytesseract is mocked to return a known string."""
    seen: dict = {}

    fake_pytesseract = types.SimpleNamespace(
        image_to_string=lambda image, config=None: (
            seen.setdefault("image_size", image.size),
            seen.setdefault("config", config),
            "  Hello OCR World  ",
        )[-1]
    )
    monkeypatch.setitem(sys.modules, "pytesseract", fake_pytesseract)

    out = await OCRFallback.extract_text(_png_bytes(8, 6))
    # Stripped whitespace from pytesseract result
    assert out == "Hello OCR World"
    # Verify the image was decoded with the expected dimensions and the
    # documented Tesseract configuration was forwarded unchanged.
    assert seen["image_size"] == (8, 6)
    assert seen["config"] == "--oem 3 --psm 6"


async def test_extract_text_returns_empty_string_when_pytesseract_missing(monkeypatch):
    """If pytesseract import fails inside _sync_extract, we get '' (no raise)."""
    # Ensure any cached module is gone so the import inside _sync_extract fails.
    monkeypatch.delitem(sys.modules, "pytesseract", raising=False)

    # Block re-import by injecting a finder that raises ImportError for it.
    class _BlockPytesseract:
        def find_module(self, name, path=None):
            if name == "pytesseract":
                return self
            return None

        def find_spec(self, name, path=None, target=None):
            if name == "pytesseract":
                raise ImportError("blocked for test")
            return None

        def load_module(self, name):
            raise ImportError("blocked for test")

    blocker = _BlockPytesseract()
    sys.meta_path.insert(0, blocker)
    try:
        out = await OCRFallback.extract_text(_png_bytes())
    finally:
        sys.meta_path.remove(blocker)

    assert out == ""


async def test_extract_text_swallows_pytesseract_runtime_error(monkeypatch):
    """A Tesseract binary failure must degrade gracefully to an empty string."""
    def boom(image, config=None):
        raise RuntimeError("tesseract not installed in PATH")

    fake_pytesseract = types.SimpleNamespace(image_to_string=boom)
    monkeypatch.setitem(sys.modules, "pytesseract", fake_pytesseract)

    out = await OCRFallback.extract_text(_png_bytes())
    assert out == ""


async def test_extract_text_swallows_invalid_image_bytes(monkeypatch):
    """Garbage bytes must not raise; the call returns an empty string."""
    # PIL.Image.open will raise UnidentifiedImageError for these bytes,
    # which the broad except in _sync_extract should catch.
    fake_pytesseract = types.SimpleNamespace(
        image_to_string=lambda *a, **kw: "should not be reached"
    )
    monkeypatch.setitem(sys.modules, "pytesseract", fake_pytesseract)

    out = await OCRFallback.extract_text(b"not an image")
    assert out == ""


def test_sync_extract_strips_whitespace(monkeypatch):
    """`_sync_extract` is the workhorse — verify the strip() contract directly."""
    fake_pytesseract = types.SimpleNamespace(
        image_to_string=lambda image, config=None: "\n\n  multi-line   \n"
    )
    monkeypatch.setitem(sys.modules, "pytesseract", fake_pytesseract)

    out = OCRFallback._sync_extract(_png_bytes())
    assert out == "multi-line"


def test_module_constant_lists_known_vision_models():
    """Regression guard: the gate uses a fixed allow-list of VLM providers."""
    assert "groq" in ocr_fallback._VISION_MODELS
    assert "gemini-2.0-flash" in ocr_fallback._VISION_MODELS
    # Non-vision providers must not be in the set.
    assert "ollama" not in ocr_fallback._VISION_MODELS
    assert "cerebras" not in ocr_fallback._VISION_MODELS
