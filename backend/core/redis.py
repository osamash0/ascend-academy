"""
Redis client initialization and connection pooling.
"""
from typing import AsyncGenerator
import redis.asyncio as redis
from backend.core.config import settings
import logging

logger = logging.getLogger(__name__)

# Global Redis client instance
redis_client: redis.Redis | None = None

async def init_redis() -> None:
    """Initialize the Redis client connection pool."""
    global redis_client
    if redis_client is None:
        try:
            redis_client = redis.from_url(
                settings.redis_url,
                encoding="utf-8",
                decode_responses=True,
                socket_timeout=5.0,
                socket_connect_timeout=5.0,
            )
            # Test connection
            await redis_client.ping()
            logger.info("Redis connection established.")
        except Exception as e:
            logger.error(f"Failed to connect to Redis at {settings.redis_url}: {e}")
            raise

async def close_redis() -> None:
    """Close the Redis connection pool."""
    global redis_client
    if redis_client is not None:
        await redis_client.aclose()
        logger.info("Redis connection closed.")
        redis_client = None

def get_redis_client() -> redis.Redis:
    """Get the initialized Redis client instance."""
    if redis_client is None:
        raise RuntimeError("Redis client is not initialized. Call init_redis() first.")
    return redis_client
