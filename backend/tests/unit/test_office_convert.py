"""Tests for office_convert (PPTX→PDF) and the .pptx upload-validation path."""
import io

import pytest
from pptx import Presentation
from pptx.util import Inches

from backend.services import office_convert, upload_service


def _build_pptx(n_slides: int = 2) -> bytes:
    prs = Presentation()
    for i in range(n_slides):
        s = prs.slides.add_slide(prs.slide_layouts[1])
        s.shapes.title.text = f"Slide {i + 1}"
        s.placeholders[1].text_frame.text = f"Body text {i + 1}"
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


# ── office_convert ────────────────────────────────────────────────────────────

@pytest.mark.skipif(not office_convert.is_available(), reason="LibreOffice not installed")
async def test_to_pdf_produces_valid_pdf_with_matching_pages():
    pdf = await office_convert.to_pdf(_build_pptx(3), "deck.pptx")
    assert pdf[:4] == b"%PDF"
    import fitz
    with fitz.open(stream=pdf, filetype="pdf") as doc:
        assert len(doc) == 3  # slide N ↔ PDF page N


def test_find_soffice_honors_env_override(monkeypatch, tmp_path):
    fake = tmp_path / "soffice"
    fake.write_text("#!/bin/sh\n")
    monkeypatch.setenv("SOFFICE_BINARY", str(fake))
    assert office_convert._find_soffice() == str(fake)


async def test_to_pdf_raises_without_soffice(monkeypatch):
    monkeypatch.setattr(office_convert, "_find_soffice", lambda: None)
    with pytest.raises(RuntimeError, match="LibreOffice"):
        await office_convert.to_pdf(b"x", "deck.pptx")


# ── validate_upload (.pptx branch) ────────────────────────────────────────────

async def test_validate_upload_counts_slides():
    assert await upload_service.validate_upload("lecture.pptx", _build_pptx(4)) == 4


async def test_validate_upload_rejects_bad_pptx():
    with pytest.raises(ValueError):
        await upload_service.validate_upload("lecture.pptx", b"not a real pptx")


async def test_validate_upload_rejects_unsupported_extension():
    with pytest.raises(ValueError, match="PDF and PowerPoint"):
        await upload_service.validate_upload("notes.txt", b"hello world")
