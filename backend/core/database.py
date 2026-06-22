"""
Supabase client initialization.

Two clients are exposed:
  - supabase_admin: service-role key, bypasses RLS. Use ONLY for trusted
    background tasks (caching, embeddings, schema migrations).
  - supabase_anon: anon key, enforces RLS. Used as the base for per-user
    authenticated clients (see services/analytics_service.get_auth_client).

The legacy `supabase` export points to supabase_admin for historical
backward compatibility, but new code should prefer get_client() and
explicitly opt-in to admin via use_admin=True.
"""
import os
import logging
import contextlib
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv
import asyncpg
from supabase import create_client, Client
from postgrest.exceptions import APIError

from backend.core.exceptions import DomainError, NotFoundError, ForbiddenError, UnauthorizedError

logger = logging.getLogger(__name__)


def _load_env() -> None:
    """Load .env files from common project locations.

    backend/.env wins per-variable; root/.env fills in anything missing.
    load_dotenv skips already-set variables, so the first file wins.
    """
    env_locations = [
        Path(__file__).parent.parent / ".env",          # backend/.env
        Path(__file__).parent.parent.parent / ".env",   # root/.env
    ]
    found_any = False
    for loc in env_locations:
        if loc.exists():
            load_dotenv(dotenv_path=loc)
            found_any = True
    if not found_any:
        load_dotenv()  # try default locations


_load_env()

# ── Configuration ────────────────────────────────────────────────────────────
SUPABASE_URL: str = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or ""
# Service-role key bypasses RLS. Use ONLY for background tasks/admin.
SERVICE_ROLE_KEY: Optional[str] = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("SUPABASE_KEY")
)
# Anon key enforces RLS. Used for user-authenticated requests.
ANON_KEY: Optional[str] = (
    os.environ.get("SUPABASE_ANON_KEY")
    or os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY")
)

if not SUPABASE_URL:
    raise ValueError("SUPABASE_URL is missing from environment")

# ── Clients ──────────────────────────────────────────────────────────────────
# Prefer the service-role key for the "admin" client (bypasses RLS for trusted
# background work like cache writes and embedding upserts). If it is not set,
# fall back to the anon key with a loud warning — this matches the legacy
# behavior so the app keeps booting in dev environments that haven't been
# given a service-role key yet, but cache/embedding writes will fail with
# RLS errors until SUPABASE_SERVICE_ROLE_KEY is provided.
if SERVICE_ROLE_KEY:
    logger.info("Initializing supabase_admin (service role)")
    supabase_admin: Client = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)
elif ANON_KEY:
    logger.warning(
        "SUPABASE_SERVICE_ROLE_KEY is not configured. Falling back to the "
        "anon key for the 'admin' client. Background writes that need to "
        "bypass RLS (cache, embeddings) will fail. Set "
        "SUPABASE_SERVICE_ROLE_KEY in production."
    )
    supabase_admin: Client = create_client(SUPABASE_URL, ANON_KEY)
else:
    raise ValueError(
        "Neither SUPABASE_SERVICE_ROLE_KEY nor SUPABASE_ANON_KEY is set. "
        "Configure at least one to start the backend."
    )

if ANON_KEY:
    logger.info("Initializing supabase_anon (RLS-enforcing)")
    supabase_anon: Optional[Client] = create_client(SUPABASE_URL, ANON_KEY)
else:
    logger.warning(
        "SUPABASE_ANON_KEY is missing. RLS-enforcing client unavailable; "
        "user-facing endpoints will fail until it is configured."
    )
    supabase_anon = None

# Legacy export — points to admin for backward compatibility ONLY.
# New code should call get_client() instead.
supabase: Client = supabase_admin


def get_client(use_admin: bool = False) -> Client:
    """Return the appropriate Supabase client.

    By default returns the RLS-enforcing anon client. Pass use_admin=True
    only for trusted background tasks. Raises RuntimeError if anon client
    is requested but ANON_KEY is not configured — we no longer fall back
    silently to the admin client (that was a privilege-escalation hazard).
    """
    if use_admin:
        return supabase_admin
    if supabase_anon is None:
        raise RuntimeError(
            "Anon Supabase client is not configured. Set SUPABASE_ANON_KEY "
            "(or VITE_SUPABASE_PUBLISHABLE_KEY) and restart the backend."
        )
    return supabase_anon


# --- asyncpg Connection Pool ---
# Used for high-performance direct SQL queries (bypass REST overhead)
DB_URL: Optional[str] = os.environ.get("DATABASE_URL")
db_pool: Optional[asyncpg.Pool] = None

async def init_db_pool():
    """Initialize the asyncpg connection pool."""
    global db_pool
    if not DB_URL:
        logger.warning("DATABASE_URL missing; asyncpg pool will not be initialized.")
        return
    try:
        db_pool = await asyncpg.create_pool(
            DB_URL,
            min_size=5,
            max_size=20,
            max_queries=1000,
            max_inactive_connection_lifetime=300,
            statement_cache_size=0,  # required for pgbouncer transaction-mode pooling
        )
        logger.info("asyncpg connection pool initialized.")
    except Exception as e:
        logger.error("Failed to initialize asyncpg pool: %s", e)


async def get_db_connection():
    """Get a connection from the pool."""
    if not db_pool:
        await init_db_pool()
    if not db_pool:
        raise RuntimeError("Database pool not initialized. Check DATABASE_URL.")
    return db_pool.acquire()


@contextlib.asynccontextmanager
async def handle_db_errors():
    """Async context manager to catch database-related errors (postgrest-py and asyncpg)
    and raise standard domain-specific exceptions.
    """
    try:
        yield
    except APIError as e:
        code_str = str(e.code) if e.code is not None else ""
        
        # 404: Single row request found 0 rows
        if code_str == "PGRST116":
            raise NotFoundError(
                message=e.message or "Resource not found.",
                code="NOT_FOUND",
                details=e.details
            ) from e
            
        # 42501: Postgres Insufficient Privilege (RLS failure)
        if code_str == "42501":
            raise ForbiddenError(
                message=e.message or "Access forbidden. Database policy restriction.",
                code="FORBIDDEN",
                details=e.details
            ) from e
            
        # HTTP Status Code mapping
        if code_str == "404":
            raise NotFoundError(message=e.message or "Resource not found.") from e
        elif code_str in ("403", "401"):
            raise ForbiddenError(message=e.message or "Access forbidden.") from e
            
        # DB Constraints
        if code_str == "23505":
            raise DomainError(
                message="A record with this unique value already exists.",
                code="DB_CONFLICT",
                details=e.details
            ) from e
        if code_str == "23503":
            raise DomainError(
                message="Referenced record does not exist (Foreign Key Violation).",
                code="DB_FOREIGN_KEY_VIOLATION",
                details=e.details
            ) from e
        if code_str == "23502":
            raise DomainError(
                message="Required field is missing or null.",
                code="DB_NOT_NULL_VIOLATION",
                details=e.details
            ) from e

        raise DomainError(
            message=e.message or "Database operation failed.",
            code=f"DB_ERROR_{code_str}" if code_str else "DB_ERROR",
            details=e.details
        ) from e

    except asyncpg.exceptions.PostgresError as e:
        code_str = getattr(e, "sqlstate", "")
        
        # Safely convert to string in case asyncpg's __str__ fails (e.g. empty args)
        try:
            details_str = str(e)
        except Exception:
            details_str = e.__class__.__name__
        
        if code_str == "23505":
            raise DomainError(
                message="A record with this unique value already exists.",
                code="DB_CONFLICT",
                details=details_str
            ) from e
        if code_str == "23503":
            raise DomainError(
                message="Referenced record does not exist (Foreign Key Violation).",
                code="DB_FOREIGN_KEY_VIOLATION",
                details=details_str
            ) from e
        if code_str == "23502":
            raise DomainError(
                message="Required field is missing or null.",
                code="DB_NOT_NULL_VIOLATION",
                details=details_str
            ) from e
        if code_str == "42501":
            raise ForbiddenError(
                message="Access forbidden. Database policy restriction.",
                code="FORBIDDEN",
                details=details_str
            ) from e
            
        raise DomainError(
            message="Database query failed.",
            code=f"DB_ERROR_{code_str}" if code_str else "DB_ERROR",
            details=details_str
        ) from e



@contextlib.asynccontextmanager
async def db_transaction():
    """Async context manager to acquire an asyncpg connection and execute a block
    inside a transaction. Automatically handles rolls backs on failure and maps
    database errors.
    """
    if not db_pool:
        await init_db_pool()
    if not db_pool:
        raise RuntimeError("Database pool not initialized. Check DATABASE_URL.")

    async with handle_db_errors():
        async with db_pool.acquire() as conn:
            async with conn.transaction():
                yield conn


async def close_db_pool():
    """Gracefully close all active pool connections during worker shutdown."""
    global db_pool
    if db_pool:
        try:
            await db_pool.close()
            logger.info("asyncpg connection pool closed successfully.")
        except Exception as e:
            logger.error("Failed to close asyncpg pool: %s", e)
        finally:
            db_pool = None

