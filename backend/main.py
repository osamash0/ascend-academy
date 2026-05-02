import os
import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from backend.api.analytics import router as analytics_router
from backend.api.upload import router as upload_router
from backend.api.ai_content import router as ai_router
from backend.api.mind_map import router as mind_map_router
from backend.api.feedback import router as feedback_router
from backend.api.assignments import router as assignments_router
from backend.api.concepts import router as concepts_router
from backend.core.rate_limit import limiter

logger = logging.getLogger(__name__)

app = FastAPI(title="Learnstation API", version="0.1.0")

# ── Rate limiting ────────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

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
        "http://localhost:5173",
        "http://localhost:8080",
        "http://127.0.0.1:5000",
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
app.include_router(analytics_router)
app.include_router(upload_router)
app.include_router(ai_router)
app.include_router(mind_map_router)
app.include_router(feedback_router)
app.include_router(assignments_router)
app.include_router(concepts_router)

@app.on_event("startup")
async def startup_event():
    from backend.core.database import init_db_pool
    await init_db_pool()

@app.get("/")
async def read_root():
    return {"message": "Welcome to Learnstation API"}


@app.get("/health")
async def health_check():
    return {"status": "ok"}
