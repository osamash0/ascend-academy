"""Unit tests for backend.services.llamaparse_service.

These tests stub out the network/SDK boundary by replacing
`llama_cloud_services.LlamaParse` with a fake class, so they run with no
external dependencies and no API key in CI.
"""

from __future__ import annotations

import sys
import types

import pytest

from backend.services import llamaparse_service


class _FakeDoc:
    def __init__(self, text: str, metadata: dict | None = None) -> None:
        self.text = text
        self.metadata = metadata or {}


def _install_fake_module(monkeypatch: pytest.MonkeyPatch, fake_class) -> None:
    mod = types.ModuleType("llama_cloud_services")
    mod.LlamaParse = fake_class
    monkeypatch.setitem(sys.modules, "llama_cloud_services", mod)


@pytest.mark.asyncio
async def test_extract_pages_raises_when_api_key_missing(monkeypatch):
    monkeypatch.setattr(llamaparse_service.settings, "llama_cloud_api_key", None)
    with pytest.raises(RuntimeError, match="LLAMA_CLOUD_API_KEY"):
        await llamaparse_service.extract_pages(b"%PDF-1.4 fake", "x.pdf")


@pytest.mark.asyncio
async def test_extract_pages_returns_one_indexed_dict(monkeypatch):
    monkeypatch.setattr(llamaparse_service.settings, "llama_cloud_api_key", "sk-test")

    captured = {}

    class FakeParser:
        def __init__(self, **kwargs):
            captured["init"] = kwargs

        async def aload_data(self, data, extra_info=None):
            captured["data"] = data
            captured["extra_info"] = extra_info
            return [
                _FakeDoc("page one body", {"page_number": 1, "title": "Intro"}),
                _FakeDoc("page two body", {"page_number": 2}),
            ]

    _install_fake_module(monkeypatch, FakeParser)

    out = await llamaparse_service.extract_pages(b"PDFBYTES", "lecture.pdf")

    assert set(out.keys()) == {1, 2}
    assert out[1] == {"text": "page one body", "title": "Intro"}
    assert out[2] == {"text": "page two body", "title": None}
    assert captured["init"]["api_key"] == "sk-test"
    assert captured["init"]["result_type"] == "markdown"
    assert captured["data"] == b"PDFBYTES"
    assert captured["extra_info"] == {"file_name": "lecture.pdf"}


@pytest.mark.asyncio
async def test_extract_pages_falls_back_to_index_when_metadata_missing(monkeypatch):
    monkeypatch.setattr(llamaparse_service.settings, "llama_cloud_api_key", "sk-test")

    class FakeParser:
        def __init__(self, **kwargs):
            pass

        async def aload_data(self, data, extra_info=None):
            return [_FakeDoc("a"), _FakeDoc("b"), _FakeDoc("c")]

    _install_fake_module(monkeypatch, FakeParser)

    out = await llamaparse_service.extract_pages(b"x", "x.pdf")
    assert sorted(out.keys()) == [1, 2, 3]
    assert out[1]["text"] == "a"
    assert out[3]["text"] == "c"


@pytest.mark.asyncio
async def test_extract_pages_wraps_sdk_failure_as_runtime_error(monkeypatch):
    monkeypatch.setattr(llamaparse_service.settings, "llama_cloud_api_key", "sk-test")

    class FakeParser:
        def __init__(self, **kwargs):
            pass

        async def aload_data(self, data, extra_info=None):
            raise ConnectionError("upstream 502")

    _install_fake_module(monkeypatch, FakeParser)

    with pytest.raises(RuntimeError, match="LlamaParse request failed"):
        await llamaparse_service.extract_pages(b"x", "x.pdf")


@pytest.mark.asyncio
async def test_extract_pages_rejects_non_list_response(monkeypatch):
    monkeypatch.setattr(llamaparse_service.settings, "llama_cloud_api_key", "sk-test")

    class FakeParser:
        def __init__(self, **kwargs):
            pass

        async def aload_data(self, data, extra_info=None):
            return {"not": "a list"}

    _install_fake_module(monkeypatch, FakeParser)

    with pytest.raises(ValueError, match="unexpected type"):
        await llamaparse_service.extract_pages(b"x", "x.pdf")


@pytest.mark.asyncio
async def test_extract_pages_passes_optional_model_env(monkeypatch):
    monkeypatch.setattr(llamaparse_service.settings, "llama_cloud_api_key", "sk-test")
    monkeypatch.setattr(llamaparse_service.settings, "llamaparse_model", "premium-mode")
    monkeypatch.setattr(llamaparse_service.settings, "llamaparse_result_type", "text")

    captured = {}

    class FakeParser:
        def __init__(self, **kwargs):
            captured["init"] = kwargs

        async def aload_data(self, data, extra_info=None):
            return []

    _install_fake_module(monkeypatch, FakeParser)

    await llamaparse_service.extract_pages(b"x", "x.pdf")
    assert captured["init"]["model"] == "premium-mode"
    assert captured["init"]["result_type"] == "text"
