"""Unit tests for compute_pdf_hash."""
from backend.services.cache import compute_pdf_hash


def test_deterministic():
    assert compute_pdf_hash(b"abc") == compute_pdf_hash(b"abc")


def test_different_inputs_different_hashes():
    assert compute_pdf_hash(b"abc") != compute_pdf_hash(b"abd")


def test_returns_hex_string_64():
    h = compute_pdf_hash(b"a")
    assert isinstance(h, str)
    assert len(h) == 64
    int(h, 16)


def test_empty_bytes_hash():
    h = compute_pdf_hash(b"")
    # SHA-256 of empty bytes is well-known
    assert h == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
