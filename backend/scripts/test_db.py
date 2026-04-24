import os
import sys
import asyncio
from pathlib import Path
from dotenv import load_dotenv

# Add project root to path
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))

from backend.core.database import supabase

def test_connection():
    try:
        print("🔌 Testing Supabase Connection...")
        
        # Test 1: Simple Select (even if empty, it proves connection works)
        # Assuming 'profiles' table exists from previous context, but let's try a safe approach
        # We'll just try to get the current session or a public table.
        # If no tables exist, we might get an error, which is fine for now.
        
        response = supabase.table("profiles").select("*").limit(1).execute()
        print(f"✅ Query Successful! Data: {response.data}")
        
    except Exception as e:
        print(f"❌ Database Error: {e}")
        # Print expected error if table doesn't exist
        if "relation" in str(e) and "does not exist" in str(e):
             print("⚠️  Connection likely works, but table 'profiles' is missing.")

if __name__ == "__main__":
    test_connection()
