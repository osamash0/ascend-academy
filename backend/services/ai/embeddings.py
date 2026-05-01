import logging
import asyncio
from typing import List
from .orchestrator import gemini_client

logger = logging.getLogger(__name__)

def _sync_generate_embeddings(text: str) -> List[float]:
    """Synchronous implementation of Gemini embedding generation."""
    if not gemini_client:
        return [0.0] * 768 # Default dimension for fallback
        
    try:
        # text-embedding-004 is the standard model for Gemini
        res = gemini_client.models.embed_content(
            model="text-embedding-004",
            contents=text
        )
        return res.embeddings[0].values
    except Exception as e:
        logger.error("Embedding generation failed: %s", e)
        return [0.0] * 768

async def generate_embeddings(text: str) -> List[float]:
    """Asynchronous wrapper for embedding generation."""
    if not text.strip():
        return [0.0] * 768
    return await asyncio.to_thread(_sync_generate_embeddings, text)
