import logging
import asyncio
from .orchestrator import gemini_client

logger = logging.getLogger(__name__)

async def generate_embeddings(text: str) -> list[float]:
    """Generate vector embeddings using Gemini (768-dim)."""
    if not text.strip():
        return [0.0] * 768
        
    try:
        if not gemini_client:
            logger.warning("Gemini client not initialized for embeddings.")
            return [0.0] * 768
            
        res = await asyncio.to_thread(
            gemini_client.models.embed_content,
            model="text-embedding-004",
            contents=text
        )
        if res and res.embeddings:
            return res.embeddings[0].values
    except Exception as e:
        logger.error("Embedding generation failed: %s", e)
        
    return [0.0] * 768
