import sys
import os
from pathlib import Path

# Add project root to path
sys.path.append(str(Path(__file__).parent.parent))

from backend.core.database import supabase_admin

def fix_account(email, new_password=None):
    print(f"--- Fixing Auth Account: {email} ---")
    
    # 1. Find the user in auth.users
    try:
        users_res = supabase_admin.auth.admin.list_users()
        user = next((u for u in users_res if u.email == email), None)
    except Exception as e:
        print(f"Error listing users: {e}")
        return
    
    if not user:
        print(f"Error: User {email} not found in Supabase Auth.")
        return

    print(f"User found: {user.id}")

    # 2. Determine Role from user_roles table
    try:
        role_res = supabase_admin.table("user_roles").select("role").eq("user_id", user.id).execute()
        role = role_res.data[0]['role'] if role_res.data else 'student'
        print(f"Current database role: {role}")
    except Exception as e:
        print(f"Error fetching role: {e}")
        role = 'student'

    # 3. Update User (Reset Password + Sync Metadata)
    # Note: supabase-py attributes mapping
    attributes = {
        "app_metadata": {"role": role},
        "email_confirm": True
    }
    
    if new_password:
        attributes["password"] = new_password
        print(f"Preparing to update password for {email}...")

    try:
        supabase_admin.auth.admin.update_user_by_id(
            user.id,
            attributes=attributes
        )
        print(f"Successfully updated {email}.")
        if new_password:
            print(f"IMPORTANT: The new password is set to: {new_password}")
        else:
            print("Role metadata synced. Password was NOT changed.")
    except Exception as e:
        print(f"Error updating user: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/fix_auth_account.py <email> [new_password]")
        sys.exit(1)
    
    target_email = sys.argv[1]
    pwd = sys.argv[2] if len(sys.argv) > 2 else "Academy2026!" # Default secure temporary password
    fix_account(target_email, pwd)
