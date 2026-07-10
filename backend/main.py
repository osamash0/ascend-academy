import os
import logging
import time
import uuid
from fastapi import FastAPI, Request, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
import sentry_sdk
from backend.core.config import settings
from backend.core.logging_config import setup_logging, set_correlation_id

# Initialize JSON structured logging
setup_logging()
traces_sample_rate = 0.1 if settings.env != "development" else 1.0
profiles_sample_rate = 0.1 if settings.env != "development" else 1.0

if os.environ.get("SENTRY_DSN"):
    sentry_sdk.init(
        dsn=os.environ.get("SENTRY_DSN"),
        traces_sample_rate=traces_sample_rate,
        profiles_sample_rate=profiles_sample_rate,
    )

from backend.api.v1.analytics import router as analytics_router
from backend.api.v1.auth import router as auth_router
from backend.api.v1.admin import router as admin_router
from backend.api.v1.upload import router as upload_router
from backend.api.v1.ai_content import router as ai_router
from backend.api.v1.mind_map import router as mind_map_router
from backend.api.v1.feedback import router as feedback_router
from backend.api.v1.assignments import router as assignments_router
from backend.api.v1.concepts import router as concepts_router
from backend.api.v1.courses import router as courses_router
from backend.api.v1.worksheets import router as worksheets_router
from backend.api.v1.nudges import router as nudges_router
from backend.api.v1.schedule import router as schedule_router
from backend.api.v1.slides_ai import router as slides_ai_router
from backend.api.v1.practice_sheets import router as practice_sheets_router
from backend.api.v1.academic import router as academic_router
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
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=["*"])

# ── Security & Logging Middleware ────────────────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

class RequestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        correlation_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4()))
        set_correlation_id(correlation_id)
        request.state.correlation_id = correlation_id
        start_time = time.perf_counter()
        
        response = await call_next(request)
        
        process_time_ms = (time.perf_counter() - start_time) * 1000
        logger.info(
            "Request handled",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round(process_time_ms, 2),
                "ip": request.client.host if request.client else None
            }
        )
        response.headers["X-Correlation-ID"] = correlation_id
        return response

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestLogMiddleware)

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

# Create parent router for v1 endpoints
v1_router = APIRouter(prefix="/api/v1")

# Include all sub-routers onto v1_router
v1_router.include_router(auth_router)
v1_router.include_router(analytics_router)
v1_router.include_router(admin_router)
v1_router.include_router(upload_router)
v1_router.include_router(ai_router)
v1_router.include_router(mind_map_router)
v1_router.include_router(feedback_router)
v1_router.include_router(assignments_router)
v1_router.include_router(concepts_router)
v1_router.include_router(courses_router)
v1_router.include_router(worksheets_router)
v1_router.include_router(nudges_router)
v1_router.include_router(schedule_router)
v1_router.include_router(slides_ai_router)
v1_router.include_router(practice_sheets_router)
v1_router.include_router(academic_router)

# Mount parent v1_router onto app
app.include_router(v1_router)

# Import and register DomainError global exception handlers
from backend.core.exceptions import DomainError

@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError):
    # NB: don't use the key "msg" in `extra` — it's a reserved LogRecord
    # attribute and logging raises KeyError, which would crash this handler.
    logger.warning("Domain error", extra={"code": exc.code, "error_message": exc.message, "details": exc.details})
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "data": None,
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details
            }
        }
    )

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled server error", extra={"error": str(exc)})
    return JSONResponse(
        status_code=500,
        content={
            "data": None,
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected error occurred.",
                "details": None
            }
        }
    )
# ── Redirect Legacy API ──────────────────────────────────────────────────────
@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def redirect_legacy_api(request: Request, path: str):
    if path.startswith("v1/"):
        from fastapi import HTTPException
        raise HTTPException(status_code=404)
        
    query_params = request.url.query
    new_path = f"/api/v1/{path}"
    if query_params:
        new_path = f"{new_path}?{query_params}"
    return RedirectResponse(url=new_path, status_code=307)


@app.on_event("startup")
async def startup_event():
    from backend.core.database import init_db_pool
    from backend.core.redis import init_redis
    await init_db_pool()
    await init_redis()
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
    from backend.core.redis import close_redis
    await close_db_pool()
    await close_redis()

@app.get("/")
async def read_root():
    return {"message": "Welcome to Learnstation API"}


@app.get("/health")
async def health_check():
    return {"status": "ok"}
