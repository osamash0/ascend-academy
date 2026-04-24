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
key: str = os.environ.get("SUPABASE_KEY") or os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY")

if not url or not key:
    raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in the .env file")

# Initialize Supabase client (singleton)
supabase: Client = create_client(url, key)
