"""Photos of notes become one-page PDFs, so they take the same path as every
other file (real-pages spec §3). The conversion happens before hashing, so a
re-uploaded photo dedupes like a re-uploaded PDF.
"""
from __future__ import annotations

import io
import os
from typing import Tuple

IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".heic")
MAX_IMAGE_SIDE = 4096
# 48-50 MP is a normal phone photo today (8000x6000 and up); 100 MP admits them
# while staying under Pillow's own decompression-bomb error (~179 MP).
MAX_IMAGE_PIXELS = 100_000_000


def is_image(filename: str) -> bool:
    return (filename or "").lower().endswith(IMAGE_EXTENSIONS)


def image_to_pdf(content: bytes, filename: str) -> Tuple[bytes, str]:
    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        from pillow_heif import register_heif_opener

        register_heif_opener()
    except ImportError:  # pragma: no cover - pinned in requirements
        pass
    try:
        img = Image.open(io.BytesIO(content))
        if img.width * img.height > MAX_IMAGE_PIXELS:
            raise ValueError("This image is too large.")
        img.draft("RGB", (MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))  # JPEG decodes smaller; no-op otherwise
        img = ImageOps.exif_transpose(img).convert("RGB")
    except Image.DecompressionBombError as exc:
        raise ValueError("This image is too large.") from exc
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("This image could not be read.") from exc
    img.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))

    try:
        import fitz

        jpeg = io.BytesIO()
        img.save(jpeg, format="JPEG", quality=88)
        doc = fitz.open()
        try:
            page = doc.new_page(width=img.width * 0.75, height=img.height * 0.75)  # 96 dpi → points
            page.insert_image(page.rect, stream=jpeg.getvalue())
            pdf = doc.tobytes()
        finally:
            doc.close()
    except Exception as exc:
        raise ValueError("This image could not be read.") from exc
    return pdf, os.path.splitext(filename)[0] + ".pdf"
