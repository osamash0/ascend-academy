import os
import re
import json
import tempfile
import asyncio
import logging
from typing import Dict, Optional

logger = logging.getLogger(__name__)

try:
    import opendataloader_pdf
    _ODL_AVAILABLE = True
except ImportError:
    _ODL_AVAILABLE = False
    logger.warning("opendataloader-pdf not installed — ODL extraction unavailable")


def _run_odl_sync(pdf_bytes: bytes, filename: str) -> Dict[int, dict]:
    """Blocking ODL extraction — must be called via run_in_executor.

    Returns {1-based page_num: {"text": str, "title": str | None}}.
    """
    with tempfile.TemporaryDirectory() as tmp:
        in_path = os.path.join(tmp, filename)
        out_dir = os.path.join(tmp, "out")
        os.makedirs(out_dir)

        with open(in_path, "wb") as f:
            f.write(pdf_bytes)

        opendataloader_pdf.convert(
            input_path=[in_path],
            output_dir=out_dir,
            format="json",
            quiet=True,
            reading_order="xycut",
        )

        json_path = None
        for root, _, files in os.walk(out_dir):
            for fname in files:
                if fname.endswith(".json"):
                    json_path = os.path.join(root, fname)
                    break

        if not json_path:
            raise FileNotFoundError("ODL produced no JSON output")

        with open(json_path) as f:
            data = json.load(f)

    return _parse_odl_json(data)


def _collect(node: dict, page_map: dict):
    """Recursively collect text content and headings per page."""
    pg = node.get("page number", 0)
    el_type = node.get("type", "")
    content = node.get("content", "")

    entry = page_map.setdefault(pg, {"texts": [], "headings": []})

    if content and el_type not in ("image", "header", "footer"):
        entry["texts"].append(content)

    if el_type == "heading" and content:
        level = node.get("heading level", 99)
        # Skip document-level titles (level 1 / "Doctitle") — these are the course
        # name that appears on every slide, not the individual slide topic.
        doc_level = node.get("level", "")
        if doc_level != "Doctitle" and level != 1:
            entry["headings"].append({"text": content, "level": level})

    for item in node.get("list items", []):
        _collect(item, page_map)
    for kid in node.get("kids", []):
        _collect(kid, page_map)


_TITLE_NOISE = re.compile(
    r'^[\•\·\-\–\—\*\>\|]'   # starts with bullet / dash / arrow
    r'|^\d+[\s\.\)]+\w'       # starts with "1. " or "1) "
    r'|\bfigure\b|\btable\b'  # captions
    , re.IGNORECASE
)


def _best_heading(headings: list) -> Optional[str]:
    """Pick the most specific (highest level number) heading for a page."""
    if not headings:
        return None
    headings.sort(key=lambda h: h["level"], reverse=True)
    for h in headings:
        text = h["text"].strip()
        if len(text) < 3 or len(text) > 150:
            continue
        if _TITLE_NOISE.search(text):
            continue
        return text
    return None


def _parse_odl_json(data: dict) -> Dict[int, dict]:
    page_map: dict = {}
    for kid in data.get("kids", []):
        _collect(kid, page_map)

    result = {}
    for pg, entry in page_map.items():
        result[pg] = {
            "text": "\n".join(entry["texts"]),
            "title": _best_heading(entry["headings"]),
        }
    return result


async def extract_pages(pdf_bytes: bytes, filename: str) -> Dict[int, dict]:
    """Returns {1-based page_num: {"text": str, "title": str | None}}.

    Raises RuntimeError if ODL is not installed, or any exception on failure.
    Caller should catch and fall back to PyMuPDF.
    """
    if not _ODL_AVAILABLE:
        raise RuntimeError("opendataloader-pdf not installed")
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _run_odl_sync, pdf_bytes, filename)
