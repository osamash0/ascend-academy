"""Unit tests for the upload security boundary (backend/core/file_validation.py).

These guard the two checks every PDF upload passes through before any parsing:
size + magic-byte validation, and filename sanitization (path-traversal / null
bytes). Pure functions — no mocks. A regression here is a security/abuse hole,
so the edge cases (traversal, null bytes, oversize, spoofed content) matter more
than the happy path.
"""
from __future__ import annotations

import pytest

from backend.core.file_validation import (
    MAX_FILE_BYTES,
    sanitize_filename,
    validate_pdf_content,
)

MIN_PDF = b"%PDF-1.4\n%binarycomment\n"  # >= 8 bytes, magic at index 0


# ── validate_pdf_content ──────────────────────────────────────────────────────

def test_accepts_minimal_valid_pdf():
    # No exception == valid.
    validate_pdf_content(MIN_PDF)


def test_accepts_magic_within_first_1024_bytes_after_leading_noise():
    # Some PDFs prepend a BOM / whitespace; magic is found within the first 1KB.
    content = (b" " * 50) + MIN_PDF
    validate_pdf_content(content)


def test_rejects_when_magic_is_beyond_the_first_1024_bytes():
    content = (b"\x00" * 1024) + b"%PDF-1.4\n"
    with pytest.raises(ValueError, match="Invalid file format"):
        validate_pdf_content(content)


def test_rejects_non_pdf_content():
    with pytest.raises(ValueError, match="Invalid file format"):
        validate_pdf_content(b"<html>not a pdf</html>")


def test_rejects_file_too_small():
    with pytest.raises(ValueError, match="too small"):
        validate_pdf_content(b"%PDF")  # 4 bytes < 8


def test_rejects_empty_file():
    with pytest.raises(ValueError, match="too small"):
        validate_pdf_content(b"")


def test_rejects_oversize_file_before_inspecting_content():
    # One byte over the cap; size check fires regardless of (here valid) magic.
    oversize = b"%PDF-1.4" + b"\x00" * (MAX_FILE_BYTES - 7)
    assert len(oversize) > MAX_FILE_BYTES
    with pytest.raises(ValueError, match="exceeds"):
        validate_pdf_content(oversize)


def test_accepts_file_exactly_at_the_size_cap():
    # Boundary: == MAX is allowed (only strictly-greater is rejected).
    at_cap = MIN_PDF + b"\x00" * (MAX_FILE_BYTES - len(MIN_PDF))
    assert len(at_cap) == MAX_FILE_BYTES
    validate_pdf_content(at_cap)


# ── sanitize_filename ─────────────────────────────────────────────────────────

def test_sanitize_none_and_empty_default_to_safe_name():
    assert sanitize_filename(None) == "upload.pdf"
    assert sanitize_filename("") == "upload.pdf"


def test_sanitize_strips_posix_path_traversal():
    assert sanitize_filename("../../etc/passwd") == "passwd"
    assert sanitize_filename("/etc/passwd") == "passwd"
    assert sanitize_filename("foo/bar/lecture.pdf") == "lecture.pdf"


def test_sanitize_removes_null_bytes():
    # Null-byte injection (e.g. "real.pdf\x00.exe") must not survive.
    assert sanitize_filename("lecture\x00.pdf") == "lecture.pdf"
    assert "\x00" not in sanitize_filename("a\x00b\x00.pdf")


def test_sanitize_dot_and_dotdot_become_default():
    assert sanitize_filename(".") == "upload.pdf"
    assert sanitize_filename("..") == "upload.pdf"


def test_sanitize_passes_through_a_normal_name():
    assert sanitize_filename("Lecture 3 — Intro.pdf") == "Lecture 3 — Intro.pdf"
