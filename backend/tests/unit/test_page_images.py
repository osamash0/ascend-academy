from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import fitz
import pytest

from backend.services.parser import page_images
from backend.services.parser.page_images import page_image_path, render_page_webp


def _page(doc):
    p = doc.new_page(width=720, height=405)
    p.insert_text((72, 72), "Functional dependencies")
    return p


def test_render_is_webp_at_the_requested_width():
    doc = fitz.open()
    webp = render_page_webp(_page(doc))
    assert webp[:4] == b"RIFF" and webp[8:12] == b"WEBP"
    from PIL import Image
    import io
    assert Image.open(io.BytesIO(webp)).size[0] == 1440


def test_path_keeps_lecture_id_in_segment_two():
    assert page_image_path("abc", 3) == "lectures/abc/p3.webp"
    assert page_image_path("abc", 3).split("/")[1] == "abc"


def _fake_client(fail_times: int):
    calls = {"n": 0}
    bucket = MagicMock()

    def upload(path, data, file_options):
        calls["n"] += 1
        if calls["n"] <= fail_times:
            raise RuntimeError("storage hiccup")
        assert file_options["cache-control"] == "31536000"
        assert file_options["content-type"] == "image/webp"
        assert file_options["upsert"] == "true"

    bucket.upload.side_effect = upload
    client = MagicMock()
    client.storage.from_.return_value = bucket
    return client, calls


def test_store_retries_then_succeeds(monkeypatch):
    client, calls = _fake_client(fail_times=2)
    monkeypatch.setattr(page_images, "_admin_client", lambda: client)
    path = asyncio.run(page_images.store_page_image("lid", 1, b"RIFF0000WEBP", attempts=3))
    assert path == "lectures/lid/p1.webp"
    assert calls["n"] == 3
    client.storage.from_.assert_called_with("lecture-pages")


def test_store_gives_up_after_attempts(monkeypatch):
    client, calls = _fake_client(fail_times=5)
    monkeypatch.setattr(page_images, "_admin_client", lambda: client)
    with pytest.raises(RuntimeError):
        asyncio.run(page_images.store_page_image("lid", 1, b"x", attempts=3))
    assert calls["n"] == 3


def test_tall_page_output_height_is_capped():
    from PIL import Image
    import io
    doc = fitz.open()
    p = doc.new_page(width=100, height=5000)
    webp = render_page_webp(p)
    assert Image.open(io.BytesIO(webp)).size[1] <= 16383
