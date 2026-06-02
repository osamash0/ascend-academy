import os
import sys

# Add project root to python path to import backend modules
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.core.database import supabase

def main():
    try:
        res = supabase.table('user_feedback').select('*').order('created_at', desc=True).execute()
        print('========================================')
        print('           USER FEEDBACK LOGS           ')
        print('========================================')
        if not res.data:
            print("No feedback found in the database yet.")
        else:
            for idx, item in enumerate(res.data, 1):
                print(f"\n[{idx}] FEATURE: {item.get('feature')}")
                print(f"    MESSAGE: {item.get('message')}")
                print(f"    ROUTE: {item.get('route')}")
                print(f"    CREATED AT: {item.get('created_at')}")
                print(f"    USER ID: {item.get('user_id')}")
                print(f"    USER AGENT: {item.get('user_agent')}")
        print('\n========================================')
    except Exception as e:
        print("Error querying user_feedback table:", e)

if __name__ == '__main__':
    main()
