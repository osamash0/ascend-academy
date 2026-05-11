import os
import asyncio
import logging
from typing import Dict, Optional
import httpx

logger = logging.getLogger(__name__)

def _get_api_key() -> str:
    from backend.core.config import settings
    key = settings.llama_cloud_api_key
    if not key:
        raise RuntimeError(
            "LLAMA_CLOUD_API_KEY is not set. "
            "Get a key from https://cloud.llamaindex.ai and add it to your .env file, "
            "or choose a different parser."
        )
    return key

async def extract_pages(pdf_bytes: bytes, filename: str) -> Dict[int, dict]:
    """Parse a PDF via LlamaParse HTTP API directly and return pages keyed by 1-indexed page number.

    Returns: {page_num: {"text": str, "title": Optional[str]}}
    Raises:
        RuntimeError on missing API key, network failure, or upstream HTTP errors.
    """
    api_key = _get_api_key()
    result_type = os.environ.get("LLAMAPARSE_RESULT_TYPE", "markdown")
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json"
    }

    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            # 1. Upload the file
            files = {"file": (filename, pdf_bytes, "application/pdf")}
            data = {"result_type": result_type}
            
            logger.info("Uploading %s to LlamaParse...", filename)
            upload_res = await client.post(
                "https://api.cloud.llamaindex.ai/api/parsing/upload",
                headers=headers,
                files=files,
                data=data
            )
            upload_res.raise_for_status()
            job_id = upload_res.json()["id"]
            
            # 2. Poll for completion
            logger.info("Polling LlamaParse job %s...", job_id)
            while True:
                status_res = await client.get(
                    f"https://api.cloud.llamaindex.ai/api/parsing/job/{job_id}",
                    headers=headers
                )
                status_res.raise_for_status()
                status = status_res.json().get("status")
                
                if status == "SUCCESS":
                    break
                elif status == "ERROR":
                    raise RuntimeError("LlamaParse job failed on the server.")
                    
                await asyncio.sleep(2)
                
            # 3. Fetch results
            logger.info("LlamaParse job %s complete. Fetching markdown...", job_id)
            result_res = await client.get(
                f"https://api.cloud.llamaindex.ai/api/parsing/job/{job_id}/result/markdown",
                headers=headers
            )
            result_res.raise_for_status()
            markdown_result = result_res.json().get("markdown", "")
            
    except Exception as exc:
        raise RuntimeError(f"LlamaParse request failed for {filename!r}: {exc}") from exc

    # LlamaParse separates pages with --- in the markdown result
    pages = markdown_result.split("\n---\n")
    
    result: Dict[int, dict] = {}
    for i, text in enumerate(pages):
        result[i + 1] = {"text": text.strip(), "title": None}
    
    logger.info("LlamaParse parsed %d pages successfully from %s", len(result), filename)
    return result
