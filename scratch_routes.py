import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from backend.main import app

for route in app.routes:
    print(f"{getattr(route, 'methods', '')} {route.path}")
