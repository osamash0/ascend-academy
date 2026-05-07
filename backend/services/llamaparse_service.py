import os
import asyncio
import logging
from typing import Dict, Optional

logger = logging.getLogger(__name__)


def _get_api_key() -> str:
    key = os.environ.get("LLAMA_CLOUD_API_KEY")
    if not key:
        raise RuntimeError(
            "LLAMA_CLOUD_API_KEY is not set. "
            "Get a key from https://cloud.llamaindex.ai and export it, "
            "or choose a different parser."
        )
    return key


def _page_number_from_metadata(meta: dict, fallback_index: int) -> int:
    for k in ("page_number", "page_label", "page", "page_index", "page_num"):
        v = meta.get(k) if isinstance(meta, dict) else None
        if v is None:
            continue
        try:
            n = int(v)
        except (TypeError, ValueError):
            continue
        # LlamaParse usually returns 1-indexed; if it gave 0-indexed, normalize.
        return n if n >= 1 else n + 1
    return fallback_index + 1


async def extract_pages(pdf_bytes: bytes, filename: str) -> Dict[int, dict]:
    """Parse a PDF via LlamaParse and return pages keyed by 1-indexed page number.

    Returns: {page_num: {"text": str, "title": Optional[str]}}
    Raises:
        RuntimeError on missing API key, network failure, or upstream HTTP errors.
        ValueError on malformed response.
    """
    api_key = _get_api_key()

    try:
        from llama_cloud_services import LlamaParse
    except ImportError as exc:
        raise RuntimeError(
            "llama-cloud-services is not installed. "
            "Run `pip install llama-cloud-services` or choose a different parser."
        ) from exc

    result_type = os.environ.get("LLAMAPARSE_RESULT_TYPE", "markdown")
    model = os.environ.get("LLAMAPARSE_MODEL")

    kwargs = {"api_key": api_key, "result_type": result_type}
    if model:
        kwargs["model"] = model

    parser = LlamaParse(**kwargs)

    try:
        documents = await parser.aload_data(
            pdf_bytes,
            extra_info={"file_name": filename},
        )
    except Exception as exc:
        raise RuntimeError(f"LlamaParse request failed for {filename!r}: {exc}") from exc

    if not isinstance(documents, list):
        raise ValueError(
            f"LlamaParse returned unexpected type {type(documents).__name__}; expected list."
        )

    result: Dict[int, dict] = {}
    for idx, doc in enumerate(documents):
        text = getattr(doc, "text", None) or ""
        meta = getattr(doc, "metadata", None) or {}
        page_num = _page_number_from_metadata(meta, idx)
        title: Optional[str] = None
        if isinstance(meta, dict):
            t = meta.get("title")
            if isinstance(t, str) and t.strip():
                title = t.strip()
        result[page_num] = {"text": str(text), "title": title}

    logger.info("LlamaParse parsed %d pages from %s", len(result), filename)
    return result
