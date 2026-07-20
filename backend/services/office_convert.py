"""Headless office-document → PDF conversion via LibreOffice (soffice).

Used by the import pipeline to turn native lecture formats (.pptx) into a PDF so
the existing PDF-centric orchestrators (page rasterization, vision OCR, storage)
keep working unchanged. The clean per-slide *text* is supplied separately by
markitdown_service; this module only produces the renderable PDF.
"""
import os
import re
import shutil
import asyncio
import logging
import tempfile
import subprocess
from typing import Optional

logger = logging.getLogger(__name__)

# Conversion is bounded — a runaway soffice process must not hang the request.
_CONVERT_TIMEOUT_SECONDS = 120


def _find_soffice() -> Optional[str]:
    """Locate the LibreOffice headless binary across macOS / Linux installs."""
    override = os.environ.get("SOFFICE_BINARY")
    if override and os.path.exists(override):
        return override
    candidates = [
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",  # macOS cask
        shutil.which("soffice"),
        shutil.which("libreoffice"),
        "/usr/bin/soffice",
        "/usr/bin/libreoffice",
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None


def _convert_sync(file_bytes: bytes, filename: str) -> bytes:
    """Blocking PPTX→PDF conversion — must be called via run_in_executor."""
    soffice = _find_soffice()
    if not soffice:
        raise RuntimeError(
            "LibreOffice (soffice) is not installed. "
            "Install it (e.g. `brew install --cask libreoffice`) "
            "or set SOFFICE_BINARY, or choose a different parser."
        )

    with tempfile.TemporaryDirectory() as tmp:
        # SECURITY: never trust the client filename in a path (traversal →
        # arbitrary write). soffice just needs *an* office file with the right
        # extension; the original name is irrelevant. Mirror odl_service.
        safe_name = os.path.basename(filename or "")
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", safe_name).strip("._")
        if not safe_name.lower().endswith((".pptx", ".ppt")):
            safe_name = (safe_name or "input") + ".pptx"
        in_path = os.path.join(tmp, safe_name)
        with open(in_path, "wb") as f:
            f.write(file_bytes)

        # Isolate the user profile per-conversion: a shared default profile
        # serializes concurrent soffice invocations (and can deadlock).
        profile_dir = os.path.join(tmp, "profile")
        proc = subprocess.run(
            [
                soffice,
                "--headless",
                "--norestore",
                f"-env:UserInstallation=file://{profile_dir}",
                "--convert-to", "pdf",
                "--outdir", tmp,
                in_path,
            ],
            capture_output=True,
            timeout=_CONVERT_TIMEOUT_SECONDS,
        )

        out_path = os.path.splitext(in_path)[0] + ".pdf"
        if not os.path.exists(out_path):
            detail = (proc.stderr or proc.stdout or b"").decode("utf-8", "replace")[:500]
            raise RuntimeError(f"LibreOffice produced no PDF (rc={proc.returncode}): {detail}")

        with open(out_path, "rb") as f:
            return f.read()


async def to_pdf(file_bytes: bytes, filename: str) -> bytes:
    """Convert an office document (.pptx) to PDF bytes.

    Raises RuntimeError if soffice is unavailable or conversion fails.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _convert_sync, file_bytes, filename)


def is_available() -> bool:
    return _find_soffice() is not None
