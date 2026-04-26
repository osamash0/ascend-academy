import asyncio
import os
import sys

# Add project root to python path to import backend modules
sys.path.append(os.path.abspath('.'))

from backend.core.database import supabase
from pprint import pprint

res = supabase.table('learning_events').select('*').order('created_at', desc=True).limit(20).execute()
print('--- Recent 20 Learning Events ---')
for e in res.data:
    pprint(e)

res2 = supabase.table('student_progress').select('*').order('updated_at', desc=True).limit(5).execute()
print('\n--- Recent 5 Student Progress ---')
for p in res2.data:
    pprint(p)
