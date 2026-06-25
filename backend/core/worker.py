import logging
from arq.connections import RedisSettings
from backend.core.config import settings
from backend.core.database import init_db_pool, close_db_pool

logger = logging.getLogger(__name__)

async def startup(ctx):
    logger.info("Worker starting up...")
    await init_db_pool()
    logger.info("Database pool initialized in worker.")

async def shutdown(ctx):
    logger.info("Worker shutting down...")
    await close_db_pool()
    logger.info("Database pool closed in worker.")

async def test_task(ctx, message: str):
    logger.info(f"Worker received test task with message: {message}")
    return f"Processed: {message}"

class WorkerSettings:
    functions = [test_task]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
