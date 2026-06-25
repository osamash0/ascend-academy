"""
Redis client initialization and connection pooling.
"""
from typing import AsyncGenerator, Any
import redis.asyncio as redis
from backend.core.config import settings
import logging
from arq import create_pool
from arq.connections import RedisSettings, ArqRedis

logger = logging.getLogger(__name__)

# Global Redis client instance
redis_client: redis.Redis | None = None
arq_pool: ArqRedis | None = None

async def init_redis() -> None:
    """Initialize the Redis client connection pool."""
    global redis_client, arq_pool
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
    
    if arq_pool is None:
        try:
            arq_pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
            logger.info("Arq Redis pool established.")
        except Exception as e:
            logger.error(f"Failed to connect to Arq Redis pool: {e}")
            raise

async def close_redis() -> None:
    """Close the Redis connection pool."""
    global redis_client, arq_pool
    if redis_client is not None:
        await redis_client.aclose()
        logger.info("Redis connection closed.")
        redis_client = None
    
    if arq_pool is not None:
        await arq_pool.close()
        logger.info("Arq Redis pool closed.")
        arq_pool = None

def get_redis_client() -> redis.Redis:
    """Get the initialized Redis client instance."""
    if redis_client is None:
        raise RuntimeError("Redis client is not initialized. Call init_redis() first.")
    return redis_client

async def enqueue_job(task_name: str, *args: Any, **kwargs: Any) -> None:
    """Enqueue a job to the Arq worker."""
    if arq_pool is None:
        raise RuntimeError("Arq pool is not initialized.")
    await arq_pool.enqueue_job(task_name, *args, **kwargs)
