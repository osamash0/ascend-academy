import os
import io
import logging
from typing import Dict

import httpx

logger = logging.getLogger(__name__)


def _get_api_url() -> str:
    return os.environ.get("MINERU_API_URL", "http://localhost:8888").rstrip("/")


def _parse_response(data) -> Dict[int, dict]:
    pages = data if isinstance(data, list) else data.get("pages") or data.get("results") or []
    result = {}
    for item in pages:
        page_num = item.get("page") or item.get("page_num") or item.get("index")
        if page_num is None:
            continue
        result[int(page_num)] = {
            "text": str(item.get("markdown") or item.get("text") or ""),
            "title": item.get("title") or None,
        }
    return result


async def extract_pages(pdf_bytes: bytes, filename: str) -> Dict[int, dict]:
    """Raises RuntimeError on connection failure, ValueError on bad JSON."""
    api_url = _get_api_url()
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(
                f"{api_url}/file_parse",
                files={"file": (filename, io.BytesIO(pdf_bytes), "application/pdf")},
            )
    except httpx.ConnectError as exc:
        raise RuntimeError(
            f"MinerU service is not reachable at {api_url}. "
            "Start the MinerU server or choose a different parser."
        ) from exc
    except httpx.TimeoutException as exc:
        raise RuntimeError(f"MinerU request timed out for {filename!r}.") from exc

    if r.status_code >= 400:
        raise RuntimeError(f"MinerU returned HTTP {r.status_code}: {r.text[:200]}")

    try:
        data = r.json()
    except Exception as exc:
        raise ValueError(f"MinerU response was not valid JSON: {r.text[:200]}") from exc

    pages = _parse_response(data)
    logger.info("MinerU parsed %d pages from %s", len(pages), filename)
    return pages
