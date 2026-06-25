import logging
import json
from arq.connections import RedisSettings
from backend.core.config import settings
from backend.core.database import init_db_pool, close_db_pool, supabase_admin
import redis.asyncio as aioredis
from backend.services.file_parse_service import import_pdf_lazy

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

async def process_pdf_lazy_worker(ctx, pdf_hash: str, filename: str, ai_model: str):
    """
    Background worker for lazy PDF parsing. Downloads the PDF, runs import_pdf_lazy,
    and publishes the events to a Redis pubsub channel.
    """
    logger.info(f"Starting lazy parse for pdf_hash: {pdf_hash}")
    redis_client = aioredis.from_url(settings.redis_url)
    channel = f"parse_lazy:{pdf_hash}"
    try:
        # Download the file from storage
        res = supabase_admin.storage.from_("pdf-uploads").download(f"{pdf_hash}.pdf")
        
        # We need to notify the client we are starting
        await redis_client.publish(channel, json.dumps({'type': 'info', 'parser': 'pymupdf-lazy'}))
        
        async for update in import_pdf_lazy(res, filename=filename, ai_model=ai_model):
            await redis_client.publish(channel, json.dumps(update))
            
        await redis_client.publish(channel, json.dumps({"type": "complete"}))
    except Exception as e:
        logger.error("Lazy import worker failed: %s", e, exc_info=True)
        await redis_client.publish(channel, json.dumps({'type': 'error', 'message': str(e), 'recoverable': False}))
    finally:
        await redis_client.aclose()

async def refresh_analytics_worker(ctx, type: str, target_id: str, days: int = 7):
    """
    Background worker for refreshing analytics caches.
    type: 'course' or 'lecture'
    target_id: course_id or lecture_id
    """
    logger.info(f"Starting analytics refresh for {type} {target_id}")
    from backend.services import analytics_service
    # Since this is a system background task, we pass None as the token.
    # The service layer checks must allow None (admin bypass) or use a service token.
    try:
        if type == "course":
            await analytics_service.get_professor_overview(target_id, days, None, force_refresh=True)
        elif type == "lecture":
            await analytics_service.get_dashboard_data(target_id, None, force_refresh=True)
        logger.info(f"Successfully refreshed analytics for {type} {target_id}")
    except Exception as e:
        logger.error(f"Failed to refresh analytics for {type} {target_id}: %s", e, exc_info=True)

class WorkerSettings:
    functions = [test_task, process_pdf_lazy_worker, refresh_analytics_worker]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
