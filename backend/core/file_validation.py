import os
from typing import Optional

MAX_FILE_BYTES = 50 * 1024 * 1024  # 50 MB

def validate_pdf_content(content: bytes) -> None:
    """
    Validates that the provided bytes represent a valid PDF.
    - Checks the absolute file size against MAX_FILE_BYTES.
    - Checks the magic bytes `%PDF` at the start of the file.
    """
    if len(content) > MAX_FILE_BYTES:
        raise ValueError(f"File exceeds the {MAX_FILE_BYTES // (1024 * 1024)}MB limit.")
    
    if len(content) < 8:
        raise ValueError("File is too small to be a valid PDF.")
    
    # PDF magic bytes usually start at index 0, but can be preceded by whitespace or BOM in rare cases.
    # We will simply check if b"%PDF" is in the first 1024 bytes.
    if b"%PDF" not in content[:1024]:
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
    
    if not safe_name or safe_name in (".", ".."):
        return "upload.pdf"
        
    return safe_name
