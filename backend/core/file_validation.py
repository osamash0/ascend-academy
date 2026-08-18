import os
from typing import Optional

from backend.core.config import settings

# Single source of truth: backend/core/config.py (MAX_UPLOAD_MB).
MAX_FILE_BYTES = settings.max_upload_mb * 1024 * 1024

PDF_MAGIC = b"%PDF-"
# A UTF-8 BOM is the only real-world prefix known to precede the PDF magic
# bytes (some tools accidentally stamp one on binary files they touched as
# text). No other leading noise is tolerated.
UTF8_BOM = b"\xef\xbb\xbf"

def validate_pdf_content(content: bytes) -> None:
    """
    Validates that the provided bytes represent a valid PDF.
    - Checks the absolute file size against MAX_FILE_BYTES.
    - Checks the magic bytes `%PDF-` at the start of the file (optionally
      after a UTF-8 BOM).
    """
    if len(content) > MAX_FILE_BYTES:
        raise ValueError(f"File exceeds the {MAX_FILE_BYTES // (1024 * 1024)}MB limit.")

    if len(content) < 8:
        raise ValueError("File is too small to be a valid PDF.")

    body = content[len(UTF8_BOM):] if content.startswith(UTF8_BOM) else content
    # Real PDFs begin with `%PDF-` at byte 0 (per the PDF spec). A substring
    # match anywhere in the first 1KB let non-PDF files with `%PDF` embedded
    # mid-content pass, so this must be an anchored startswith check.
    if not body.startswith(PDF_MAGIC):
        raise ValueError("Invalid file format. Only PDF files are supported.")

def sanitize_filename(filename: Optional[str]) -> str:
    """
    Sanitizes the filename to prevent path traversal and null byte injections.
    """
    if not filename:
        return "upload.pdf"

    # Remove null bytes
    safe_name = filename.replace("\x00", "")

    # Extract the base name to strip out directory paths like ../ or /
    safe_name = os.path.basename(safe_name)

    # Strip HTML metacharacters. Currently inert defense-in-depth (nothing in
    # the app renders raw HTML from a filename today), kept narrow so it
    # doesn't touch legitimate non-ASCII names (umlauts, em dashes, etc.).
    for ch in ("<", ">", '"'):
        safe_name = safe_name.replace(ch, "")

    if not safe_name or safe_name in (".", ".."):
        return "upload.pdf"

    return safe_name
