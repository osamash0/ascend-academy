import os
import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from fastapi.middleware.gzip import GZipMiddleware
import sentry_sdk
from backend.core.config import settings

traces_sample_rate = 0.1 if settings.env != "development" else 1.0
profiles_sample_rate = 0.1 if settings.env != "development" else 1.0

if os.environ.get("SENTRY_DSN"):
    sentry_sdk.init(
        dsn=os.environ.get("SENTRY_DSN"),
        traces_sample_rate=traces_sample_rate,
        profiles_sample_rate=profiles_sample_rate,
    )

from backend.api.analytics import router as analytics_router
from backend.api.auth import router as auth_router
from backend.api.admin import router as admin_router
from backend.api.upload import router as upload_router
from backend.api.ai_content import router as ai_router
from backend.api.mind_map import router as mind_map_router
from backend.api.feedback import router as feedback_router
from backend.api.assignments import router as assignments_router
from backend.api.concepts import router as concepts_router
from backend.api.courses import router as courses_router
from backend.api.worksheets import router as worksheets_router
from backend.api.nudges import router as nudges_router
from backend.api.schedule import router as schedule_router
from backend.api.slides_ai import router as slides_ai_router
from backend.api.practice_sheets import router as practice_sheets_router
from backend.api.fast_upload import router as fast_upload_router
from backend.api.academic import router as academic_router
from backend.core.rate_limit import limiter

logger = logging.getLogger(__name__)

docs_url = "/docs" if settings.env == "development" else None
redoc_url = "/redoc" if settings.env == "development" else None

app = FastAPI(
    title="Learnstation API",
    version="0.1.0",
    docs_url=docs_url,
    redoc_url=redoc_url
)

# ── Rate limiting ────────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# ── Compression ──────────────────────────────────────────────────────────────
app.add_middleware(GZipMiddleware, minimum_size=1000)

# ── CORS ─────────────────────────────────────────────────────────────────────
def _build_cors_origins() -> list[str]:
    """
    Build the CORS allowlist. In production set CORS_ALLOWED_ORIGINS (or ALLOWED_ORIGINS)
    to a comma-separated list of fully-qualified origins.
    """
    raw = os.environ.get("CORS_ALLOWED_ORIGINS") or os.environ.get("ALLOWED_ORIGINS") or ""
    raw = raw.strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]

    origins = [
        "http://localhost:5000",
        "http://localhost:5001",
        "http://localhost:5173",
        "http://localhost:8080",
        "http://127.0.0.1:5000",
        "http://127.0.0.1:5001",
    ]
    dev_domain = os.environ.get("REPLIT_DEV_DOMAIN")
    if dev_domain:
        origins.append(f"https://{dev_domain}")
    replit_domains = os.environ.get("REPLIT_DOMAINS", "").strip()
    if replit_domains:
        for d in replit_domains.split(","):
            d = d.strip()
            if d:
                origins.append(f"https://{d}")
    return origins


_cors_origins = _build_cors_origins()
logger.info("CORS allowed origins: %s", _cors_origins)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)

# Include routers
app.include_router(auth_router)
app.include_router(analytics_router)
app.include_router(admin_router)
app.include_router(upload_router)
app.include_router(ai_router)
app.include_router(mind_map_router)
app.include_router(feedback_router)
app.include_router(assignments_router)
app.include_router(concepts_router)
app.include_router(courses_router)
app.include_router(worksheets_router)
app.include_router(nudges_router)
app.include_router(schedule_router)
app.include_router(slides_ai_router)
app.include_router(practice_sheets_router)
app.include_router(fast_upload_router)
app.include_router(academic_router)

@app.on_event("startup")
async def startup_event():
    from backend.core.database import init_db_pool
    await init_db_pool()
    # Start the daily nudge engine scheduler when explicitly enabled. Off by
    # default (and during tests) so we don't fan out notifications from local
    # dev shells. In production set ENABLE_NUDGE_SCHEDULER=1.
    if os.environ.get("ENABLE_NUDGE_SCHEDULER") == "1":
        try:
            from backend.services.nudge_scheduler import start_scheduler
            start_scheduler()
        except Exception as e:
            logger.error("Failed to start nudge scheduler: %s", e, exc_info=True)

@app.on_event("shutdown")
async def shutdown_event():
    from backend.core.database import close_db_pool
    await close_db_pool()

@app.get("/")
async def read_root():
    return {"message": "Welcome to Learnstation API"}


@app.get("/health")
async def health_check():
    return {"status": "ok"}
