"""Parser storage helpers.

Standalone (imports nothing else from the parser package) so the live unified
pipeline does not depend on any legacy orchestrator module.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

from backend.core.database import get_client

logger = logging.getLogger(__name__)


async def _fetch_pdf_bytes(pdf_hash: str) -> Optional[bytes]:
    """Download PDF bytes from Supabase Storage by sha256 hash."""

    def _sync_fetch() -> Optional[bytes]:
        sb = get_client(use_admin=True)
        try:
            return sb.storage.from_("pdf-uploads").download(f"{pdf_hash}.pdf")
        except Exception as e:
            logger.warning("Failed to fetch PDF %s from storage: %s", pdf_hash, e)
            return None

    return await asyncio.to_thread(_sync_fetch)
