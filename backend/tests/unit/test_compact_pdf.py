"""Unit tests for the reading copy of a lecture PDF.

The rewrite exists so the reader's first page needs fewer byte ranges. These
tests guard what makes it safe to run on every upload: the pages come out the
same, the objects are packed into object streams, and every doubt -- a broken
file, an encrypted one, the kill switch, a rewrite that grows -- keeps the
original bytes.
"""
from __future__ import annotations

import io

import fitz
import pikepdf
import pytest

from backend.services.parser import compact_pdf
from backend.services.parser.compact_pdf import compact_for_reading


def _deck(pages: int = 12) -> bytes:
    """A small deck with text on every page, written the way PyMuPDF writes it
    (one object per object, no object streams) -- as most uploads arrive."""
    doc = fitz.open()
    for n in range(1, pages + 1):
        page = doc.new_page(width=960, height=540)
        page.insert_text((60, 80), f"Lecture page {n}", fontsize=28)
        page.insert_text((60, 140), f"Functional dependency number {n}: X -> A", fontsize=16)
    out = doc.tobytes()
    doc.close()
    return out


def _texts(pdf_bytes: bytes) -> list[str]:
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        return [page.get_text() for page in doc]


def _pixels(pdf_bytes: bytes) -> list[bytes]:
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        return [page.get_pixmap(dpi=40).samples for page in doc]


def test_the_reading_copy_reads_the_same():
    original = _deck()
    compacted = compact_for_reading(original)

    assert compacted != original, "a deck without object streams should be rewritten"
    assert _texts(compacted) == _texts(original)
    assert _pixels(compacted) == _pixels(original)


def test_objects_are_packed_into_object_streams():
    original = _deck()
    assert b"/ObjStm" not in original

    compacted = compact_for_reading(original)

    assert b"/ObjStm" in compacted


def test_works_on_the_shared_sample(sample_pdf_bytes: bytes):
    compacted = compact_for_reading(sample_pdf_bytes)

    with pikepdf.open(io.BytesIO(compacted)) as pdf:
        assert len(pdf.pages) == 3
    assert _texts(compacted) == _texts(sample_pdf_bytes)


def test_bytes_that_are_not_a_pdf_come_back_untouched():
    junk = b"%PDF-1.7\nthis is not really a pdf"

    assert compact_for_reading(junk) is junk


def test_empty_input_comes_back_untouched():
    assert compact_for_reading(b"") == b""


def test_an_encrypted_pdf_is_left_alone():
    doc = fitz.open(stream=_deck(3), filetype="pdf")
    encrypted = doc.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="")
    doc.close()

    assert compact_for_reading(encrypted) is encrypted


@pytest.mark.parametrize("value", ["0", "false", "off", "no", " OFF "])
def test_the_kill_switch_stores_uploads_as_they_came(monkeypatch, value):
    monkeypatch.setenv("PDF_COMPACT_ON_UPLOAD", value)
    original = _deck()

    assert compact_for_reading(original) is original


def test_a_rewrite_that_grows_the_file_is_kept_out(monkeypatch):
    original = _deck()
    # Any real rewrite of this deck is larger than "no growth allowed at all".
    monkeypatch.setattr(compact_pdf, "MAX_GROWTH", 0.01)

    assert compact_for_reading(original) is original


def test_a_failing_save_keeps_the_original(monkeypatch):
    original = _deck()

    def broken_save(self, *args, **kwargs):
        raise RuntimeError("qpdf blew up")

    monkeypatch.setattr(pikepdf.Pdf, "save", broken_save)

    assert compact_for_reading(original) is original


async def test_the_lecture_pdfs_copy_is_the_reading_copy(monkeypatch):
    """`_store_lecture_pdf` uploads the rewritten bytes, not the originals."""
    from uuid import uuid4

    from backend.services.parser import unified_orchestrator as uo

    uploads: list[tuple[str, bytes]] = []

    class _Bucket:
        def upload(self, path, data, file_options=None):
            uploads.append((path, data))

    class _Storage:
        def from_(self, bucket):
            assert bucket == "lecture-pdfs"
            return _Bucket()

    class _Client:
        storage = _Storage()

    from backend.core import database

    monkeypatch.setattr(database, "get_client", lambda use_admin=False: _Client())
    monkeypatch.setattr(uo.compact_pdf, "compact_for_reading", lambda b: b"reading-copy:" + b[:4])

    lecture_id = uuid4()
    path = await uo._store_lecture_pdf(lecture_id, "deck.pdf", b"%PDF-original")

    assert path == f"lectures/{lecture_id}/deck.pdf"
    assert uploads == [(path, b"reading-copy:%PDF")]
