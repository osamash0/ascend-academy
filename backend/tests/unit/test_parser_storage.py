"""Unit tests for backend.services.parser.storage._fetch_pdf_bytes.

The Supabase storage client is mocked at get_client so no network runs.
"""
from __future__ import annotations

from types import SimpleNamespace

from backend.services.parser import storage


class _FakeBucket:
    def __init__(self, data=None, raises=False):
        self._data = data
        self._raises = raises
        self.downloaded: list = []

    def download(self, path):
        self.downloaded.append(path)
        if self._raises:
            raise RuntimeError("storage 404")
        return self._data


class _FakeStorage:
    def __init__(self, bucket):
        self._bucket = bucket

    def from_(self, name):
        return self._bucket


def _client(bucket):
    return SimpleNamespace(storage=_FakeStorage(bucket))


async def test_fetch_pdf_bytes_returns_downloaded_content(monkeypatch):
    bucket = _FakeBucket(data=b"%PDF-1.4 bytes")
    monkeypatch.setattr(storage, "get_client", lambda use_admin=False: _client(bucket))
    out = await storage._fetch_pdf_bytes("a" * 64)
    assert out == b"%PDF-1.4 bytes"
    assert bucket.downloaded == ["a" * 64 + ".pdf"]


async def test_fetch_pdf_bytes_returns_none_on_error(monkeypatch):
    bucket = _FakeBucket(raises=True)
    monkeypatch.setattr(storage, "get_client", lambda use_admin=False: _client(bucket))
    out = await storage._fetch_pdf_bytes("b" * 64)
    assert out is None
