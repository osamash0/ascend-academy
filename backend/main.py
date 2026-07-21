import os
import logging
import time
import uuid
from fastapi import FastAPI, Request, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import _rate_limit_exceeded_handler
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
from backend.api.v1.review import router as review_router
from backend.api.v1.exams import router as exams_router
from backend.api.v1.search import router as search_router
from backend.api.v1.materials import router as materials_router
from backend.core.rate_limit import limiter

logger = logging.getLogger(__name__)

# In non-dev environments disable the interactive docs AND the raw OpenAPI schema,
# so the full endpoint surface (incl. /admin/*) isn't published to the public internet.
_docs_enabled = settings.env == "development"
docs_url = "/docs" if _docs_enabled else None
redoc_url = "/redoc" if _docs_enabled else None
openapi_url = "/openapi.json" if _docs_enabled else None

app = FastAPI(
    title="Learnstation API",
    version="0.1.0",
    docs_url=docs_url,
    redoc_url=redoc_url,
    openapi_url=openapi_url,
)

def _trusted_proxy_hosts() -> list[str]:
    """Hosts/CIDRs allowed to set X-Forwarded-For / X-Forwarded-Proto.

    S-3 (docs/ROADMAP_10X_FOUNDATION.md §14): this used to be ``["*"]``,
    which tells ``ProxyHeadersMiddleware`` to trust EVERY peer's
    X-Forwarded-For value, including a direct internet client's own
    self-supplied header — i.e. any caller could set
    ``X-Forwarded-For: 1.2.3.4`` and have it taken as their "real" IP,
    trivially defeating per-IP rate limiting (rotate the header, dodge the
    limit).

    In the real deployment topology (docker-compose.prod.yml) the `api`
    container is never reachable directly — only the `frontend` nginx
    container talks to it, over the `ascend_net` bridge network, whose
    default (unpinned) subnet falls in Docker's standard bridge range. We
    trust only that range plus loopback (used by local dev / tests /
    reverse-proxy-on-localhost setups), so ProxyHeadersMiddleware ignores
    X-Forwarded-For from anything else — e.g. a request that reaches `api`
    some other way can no longer inject a fake header.

    Override with the comma-separated ``TRUSTED_PROXY_HOSTS`` env var if a
    deployment's proxy sits somewhere else (e.g. a pinned bridge subnet, a
    cloud LB's known egress range).
    """
    raw = os.environ.get("TRUSTED_PROXY_HOSTS", "").strip()
    if raw:
        return [h.strip() for h in raw.split(",") if h.strip()]
    return ["127.0.0.1", "::1", "172.16.0.0/12"]


# ── Rate limiting ────────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=_trusted_proxy_hosts())

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
# Roadmap Phase 1.1 (review engine) — off by default; FEATURE_REVIEW_ENGINE=1 to enable.
if settings.feature_review_engine:
    v1_router.include_router(review_router)
# Roadmap Phase 1.2 (exam mode) — off by default; FEATURE_EXAM_MODE=1 to enable.
if settings.feature_exam_mode:
    v1_router.include_router(exams_router)

if settings.feature_global_search:
    v1_router.include_router(search_router)

# Roadmap Phase 3.1 (student self-serve uploads) — off by default; FEATURE_STUDENT_UPLOADS=1 to enable.
if settings.feature_student_uploads:
    v1_router.include_router(materials_router)

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
    from backend.core.auth_middleware import get_auth_http_client
    get_auth_http_client()
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
    from backend.core.auth_middleware import close_auth_http_client
    await close_auth_http_client()

@app.get("/")
async def read_root():
    return {"message": "Welcome to Learnstation API"}


@app.get("/health")
async def health_check():
    """Liveness: the process is up and the event loop is responsive.

    Deliberately dependency-free so a transient DB/Redis blip never triggers
    a container restart loop. Use /health/ready for dependency health.
    """
    return {"status": "ok"}


@app.get("/health/ready")
async def readiness_check():
    """Readiness: the API can actually serve traffic.

    Checks the asyncpg pool, the app-cache Redis, and the job-queue Redis.
    Returns 503 (with a per-component breakdown) if any critical dependency
    is down, so the orchestrator can gate traffic / cycle the container
    instead of routing requests that would 500 on every real route.
    """
    checks: dict[str, str] = {}
    ok = True

    # Postgres via the asyncpg pool. Only critical when DATABASE_URL is actually
    # configured — the app supports a REST-only (Supabase) mode with no pool, and
    # we must not report not-ready (and block frontend startup) in that mode.
    from backend.core.database import db_pool, DB_URL
    if not DB_URL:
        checks["database"] = "not_configured"
    else:
        try:
            if db_pool is None:
                checks["database"] = "uninitialized"
                ok = False
            else:
                async with db_pool.acquire() as conn:
                    await conn.fetchval("SELECT 1")
                checks["database"] = "ok"
        except Exception as e:
            checks["database"] = f"error: {e.__class__.__name__}"
            ok = False

    # App-cache Redis.
    try:
        from backend.core.redis import get_redis_client
        await get_redis_client().ping()
        checks["redis_cache"] = "ok"
    except Exception as e:
        checks["redis_cache"] = f"error: {e.__class__.__name__}"
        ok = False

    # Job-queue Redis (Arq broker). Reuses the shared enqueue pool so we probe
    # the exact connection uploads depend on.
    try:
        from backend.services.upload_service import get_arq_pool
        pool = await get_arq_pool()
        await pool.ping()
        checks["redis_queue"] = "ok"
    except Exception as e:
        checks["redis_queue"] = f"error: {e.__class__.__name__}"
        ok = False

    body = {"status": "ok" if ok else "unavailable", "checks": checks}
    return JSONResponse(body, status_code=200 if ok else 503)
