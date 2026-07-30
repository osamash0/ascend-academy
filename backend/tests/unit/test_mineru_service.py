"""Unit tests for backend/services/mineru_service.py's shared-secret header.

mineru_server.py (repo root) is a standalone service, not wired into any
docker-compose, and its /file_parse endpoint had no authentication at all.
It now enforces an X-Mineru-Run-Secret header only if MINERU_SHARED_SECRET
is configured server-side. These tests cover the client half only (sending
the header) — mineru_server.py itself imports magic_pdf, which isn't a repo
dependency and isn't under pytest.ini's testpaths, so its enforcement half
is verified manually (see the file's own module docstring for the start
command) rather than here.
"""
from __future__ import annotations

import httpx
import pytest

from backend.services import mineru_service


class _FakeResponse:
    status_code = 200

    def json(self):
        return {"pages": []}

    @property
    def text(self):
        return "{}"


class _FakeAsyncClient:
    captured: dict = {}

    def __init__(self, *a, **kw):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, **kwargs):
        _FakeAsyncClient.captured = {"url": url, **kwargs}
        return _FakeResponse()


@pytest.fixture
def fake_httpx_client(monkeypatch):
    _FakeAsyncClient.captured = {}
    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)
    return _FakeAsyncClient


async def test_sends_configured_shared_secret_header(monkeypatch, fake_httpx_client):
    monkeypatch.setenv("MINERU_SHARED_SECRET", "top-secret-value")
    await mineru_service.extract_pages(b"%PDF-1.4", "lecture.pdf")
    assert fake_httpx_client.captured["headers"]["X-Mineru-Run-Secret"] == "top-secret-value"


async def test_sends_empty_header_when_unconfigured(monkeypatch, fake_httpx_client):
    monkeypatch.delenv("MINERU_SHARED_SECRET", raising=False)
    await mineru_service.extract_pages(b"%PDF-1.4", "lecture.pdf")
    assert fake_httpx_client.captured["headers"]["X-Mineru-Run-Secret"] == ""
