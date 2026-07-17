"""Coverage for odl_service._run_odl_sync — the blocking ODL extraction body.

The native ODL `convert` is replaced with a fake that writes a JSON output, so
we exercise the real temp-dir plumbing, JSON discovery, and — importantly — the
path-traversal sanitization of the client-supplied filename, without running the
native binary.
"""
from __future__ import annotations

import json
import os

import pytest

from backend.services import odl_service


class _FakeODL:
    """Stand-in for the opendataloader_pdf module. Records call args and writes
    a JSON output file so _run_odl_sync's discovery/parse path runs."""

    last_kwargs: dict = {}

    @classmethod
    def convert(cls, **kwargs):
        cls.last_kwargs = kwargs
        out_dir = kwargs["output_dir"]
        with open(os.path.join(out_dir, "result.json"), "w") as f:
            json.dump(
                {"kids": [{"page number": 1, "type": "text", "content": "hello world"}]},
                f,
            )


class _NoOutputODL:
    @staticmethod
    def convert(**kwargs):
        pass  # writes nothing → discovery finds no JSON


def test_run_odl_sync_parses_written_json(monkeypatch):
    monkeypatch.setattr(odl_service, "opendataloader_pdf", _FakeODL, raising=False)
    out = odl_service._run_odl_sync(b"%PDF-1.4 data", "lecture.pdf")
    assert out[1]["text"] == "hello world"


def test_run_odl_sync_sanitizes_traversal_filename(monkeypatch):
    monkeypatch.setattr(odl_service, "opendataloader_pdf", _FakeODL, raising=False)
    odl_service._run_odl_sync(b"%PDF", "../../etc/evil name!.pdf")
    in_path = _FakeODL.last_kwargs["input_path"][0]
    base = os.path.basename(in_path)
    assert ".." not in in_path                 # traversal stripped
    assert " " not in base and "!" not in base  # unsafe chars replaced
    assert base.endswith(".pdf")


def test_run_odl_sync_appends_pdf_extension(monkeypatch):
    monkeypatch.setattr(odl_service, "opendataloader_pdf", _FakeODL, raising=False)
    odl_service._run_odl_sync(b"%PDF", "notes")   # no extension
    base = os.path.basename(_FakeODL.last_kwargs["input_path"][0])
    assert base.endswith(".pdf")


def test_run_odl_sync_empty_filename_uses_placeholder(monkeypatch):
    monkeypatch.setattr(odl_service, "opendataloader_pdf", _FakeODL, raising=False)
    odl_service._run_odl_sync(b"%PDF", "")
    base = os.path.basename(_FakeODL.last_kwargs["input_path"][0])
    assert base.endswith(".pdf")
    assert len(base) > len(".pdf")  # a real placeholder name, not just ".pdf"


def test_run_odl_sync_raises_when_no_json_produced(monkeypatch):
    monkeypatch.setattr(odl_service, "opendataloader_pdf", _NoOutputODL, raising=False)
    with pytest.raises(FileNotFoundError):
        odl_service._run_odl_sync(b"%PDF", "x.pdf")
