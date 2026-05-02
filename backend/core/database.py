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
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv
from supabase import create_client, Client

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
