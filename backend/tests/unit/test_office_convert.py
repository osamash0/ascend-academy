"""Tests for office_convert (PPTX→PDF) and the .pptx upload-validation path."""
import io

import pytest
from pptx import Presentation

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


def test_soffice_command_uses_launchservices_for_macos_app(monkeypatch):
    monkeypatch.setattr(office_convert.sys, "platform", "darwin")

    command = office_convert._soffice_command(
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        profile_dir="/tmp/profile", output_dir="/tmp/output", input_path="/tmp/deck.pptx",
    )

    assert command[:5] == ["open", "-W", "-a", "/Applications/LibreOffice.app", "--args"]
    assert "--headless" in command
    assert "/tmp/deck.pptx" in command


def test_soffice_command_stays_direct_off_macos(monkeypatch):
    monkeypatch.setattr(office_convert.sys, "platform", "linux")

    command = office_convert._soffice_command(
        "/usr/bin/soffice",
        profile_dir="/tmp/profile", output_dir="/tmp/output", input_path="/tmp/deck.pptx",
    )

    assert command[0] == "/usr/bin/soffice"
    assert command[1] == "--headless"


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
