import os
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables from .env file
from pathlib import Path
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")

if not url or not key:
    raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in the .env file")

# Initialize Supabase client
supabase: Client = create_client(url, key)
