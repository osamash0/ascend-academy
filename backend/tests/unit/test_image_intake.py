from __future__ import annotations

import io
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import fitz
import pytest
from PIL import Image

from backend.core.config import Settings, settings
from backend.services import materials_service
from backend.services.image_intake import image_to_pdf, is_image


def _png(w=1200, h=900) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (240, 240, 240)).save(buf, format="PNG")
    return buf.getvalue()


def test_is_image():
    assert is_image("Notes.JPG") and is_image("a.heic") and is_image("x.png")
    assert not is_image("deck.pdf") and not is_image("deck.pptx")


def test_a_photo_becomes_a_one_page_pdf_with_its_aspect():
    pdf, name = image_to_pdf(_png(1200, 900), "board photo.png")
    assert name == "board photo.pdf"
    with fitz.open(stream=pdf, filetype="pdf") as d:
        assert d.page_count == 1
        r = d[0].rect
        assert abs(r.width / r.height - 1200 / 900) < 0.01


def test_huge_photos_are_scaled_down():
    pdf, _ = image_to_pdf(_png(8000, 6000), "big.png")
    with fitz.open(stream=pdf, filetype="pdf") as d:
        img = d[0].get_images()[0]
        w, h = d.extract_image(img[0])["width"], d.extract_image(img[0])["height"]
    assert max(w, h) <= 4096


def test_rotation_from_exif_is_applied():
    buf = io.BytesIO()
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90° clockwise on display
    Image.new("RGB", (400, 200)).save(buf, format="JPEG", exif=exif)
    pdf, _ = image_to_pdf(buf.getvalue(), "p.jpg")
    with fitz.open(stream=pdf, filetype="pdf") as d:
        assert d[0].rect.height > d[0].rect.width


def test_garbage_is_a_value_error():
    with pytest.raises(ValueError):
        image_to_pdf(b"not an image", "x.png")


def test_studio_pages_flag_defaults_off():
    assert Settings.model_fields["feature_studio_pages"].default is False


@pytest.mark.asyncio
async def test_flag_off_leaves_images_alone_and_validation_rejects_them(monkeypatch):
    monkeypatch.setattr(settings, "feature_studio_pages", False)
    seen = {}

    async def fake_validate(name, content):
        seen["name"] = name
        raise ValueError("Only PDF, PowerPoint (.pptx) and photo (JPG, PNG, HEIC) files are supported.")

    png = _png()
    with patch.object(materials_service.upload_service, "read_upload_capped", new=AsyncMock(return_value=png)), \
         patch.object(materials_service.upload_service, "validate_upload", new=fake_validate):
        with pytest.raises(ValueError, match="Only PDF, PowerPoint"):
            await materials_service.create_upload("user-1", SimpleNamespace(filename="notes.png"))
    assert seen["name"] == "notes.png"


@pytest.mark.asyncio
async def test_flag_on_hands_validation_a_pdf(monkeypatch):
    monkeypatch.setattr(settings, "feature_studio_pages", True)
    seen = {}

    async def fake_validate(name, content):
        seen["name"], seen["content"] = name, content
        raise ValueError("stop before the database")

    with patch.object(materials_service.upload_service, "read_upload_capped", new=AsyncMock(return_value=_png())), \
         patch.object(materials_service.upload_service, "validate_upload", new=fake_validate):
        with pytest.raises(ValueError, match="stop before"):
            await materials_service.create_upload("user-1", SimpleNamespace(filename="notes.png"))
    assert seen["name"].endswith(".pdf")
    assert seen["content"].startswith(b"%PDF")
