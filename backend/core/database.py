import os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables from .env file
env_path = Path(__file__).parent.parent / ".env"
root_env_path = Path(__file__).parent.parent.parent / ".env"
venv_env_path = Path(__file__).parent.parent.parent / "venv" / ".env"

if env_path.exists():
    load_dotenv(dotenv_path=env_path)
elif venv_env_path.exists():
    load_dotenv(dotenv_path=venv_env_path)
elif root_env_path.exists():
    load_dotenv(dotenv_path=root_env_path)
else:
    load_dotenv() # try default locations

url: str = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
# Use service role key if available, fallback to anon key for public ops
service_role_key: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not service_role_key:
    # If no service role key, we fall back to SUPABASE_KEY but log a warning if it's likely an anon key
    service_role_key = os.environ.get("SUPABASE_KEY")
    if service_role_key and service_role_key.startswith("eyJh"): # Standard JWT prefix for Supabase anon keys
        print("WARNING: Using ANON_KEY for background tasks. RLS violations may occur. Please set SUPABASE_SERVICE_ROLE_KEY.")

# The anon key enforces RLS - use for user-authenticated sessions
anon_key: str = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY") or service_role_key

if not url or not service_role_key:
    raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) must be set")

# Default client uses service role key for historical compatibility in background tasks
supabase: Client = create_client(url, service_role_key)
