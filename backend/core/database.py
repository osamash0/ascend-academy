import os
import logging
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv
from supabase import create_client, Client

logger = logging.getLogger(__name__)

# Load environment variables from .env file
def _load_env() -> None:
    """Load .env files from all common project locations.

    Load backend/.env first so its values take priority, then root/.env fills
    in anything missing (e.g. SUPABASE_SERVICE_ROLE_KEY). load_dotenv skips
    variables that are already set, so the first file wins per-variable.
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

# Configuration
SUPABASE_URL: str = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
# The service role key bypasses RLS - use only for background tasks/admin
SERVICE_ROLE_KEY: Optional[str] = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
# The anon key enforces RLS - use for user-authenticated sessions
ANON_KEY: Optional[str] = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY")

if not SUPABASE_URL:
    raise ValueError("SUPABASE_URL is missing from environment")

if not SERVICE_ROLE_KEY:
    raise ValueError("SUPABASE_SERVICE_ROLE_KEY (or legacy SUPABASE_KEY) is missing from environment")

# Initialize Clients
# supabase_admin: Use for background tasks, migrations, and internal system calls (bypasses RLS)
if SERVICE_ROLE_KEY:
    logger.info("Initializing supabase_admin with SERVICE_ROLE_KEY (len: %d)", len(SERVICE_ROLE_KEY))
else:
    logger.error("SUPABASE_SERVICE_ROLE_KEY is missing!")

supabase_admin: Client = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)

# supabase_anon: Use for user-facing API calls where RLS should be enforced
if ANON_KEY:
    logger.info("Initializing supabase_anon with ANON_KEY (len: %d)", len(ANON_KEY))
else:
    logger.warning("SUPABASE_ANON_KEY is missing!")

supabase_anon: Optional[Client] = create_client(SUPABASE_URL, ANON_KEY) if ANON_KEY else None

# Legacy export for historical compatibility
supabase: Client = supabase_admin

def get_client(use_admin: bool = False) -> Client:
    """Helper to get the appropriate Supabase client."""
    if use_admin:
        return supabase_admin
    if not supabase_anon:
        logger.warning("No ANON_KEY found; falling back to admin client (RLS will be bypassed)")
        return supabase_admin
    return supabase_anon
