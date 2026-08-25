"""Export the FastAPI OpenAPI schema to a static JSON file.

`backend/main.py` disables the live `/docs`, `/redoc`, and `/openapi.json`
HTTP routes outside `development` (so the full endpoint surface, including
`/admin/*`, isn't published to the public internet) — but `app.openapi()`
is still callable in-process regardless of that HTTP gating, since it only
disables the *route*, not the schema-generation method on the app object.
This script uses that to produce a static, offline copy for tooling
(client generators, docs sites, diffing) without ever exposing the live
`/docs` UI in a deployed environment.

Sets the same throwaway env vars `backend/tests/conftest.py` sets before
importing `backend.main` — module-level imports elsewhere in the app
require real-looking values or they raise, and everything here is a
one-shot schema dump, not a live server.
"""
import os

os.environ.setdefault("SUPABASE_URL", "https://fake.supabase.test")
os.environ.setdefault("SUPABASE_KEY", "fake-anon-key-for-tests")
os.environ.setdefault("SUPABASE_ANON_KEY", "fake-anon-key-for-tests")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key-for-tests")
os.environ.setdefault("VITE_SUPABASE_URL", "https://fake.supabase.test")
os.environ.setdefault("VITE_SUPABASE_PUBLISHABLE_KEY", "fake-anon-key-for-tests")
os.environ.setdefault("GROQ_API_KEY", "fake-groq")
os.environ.setdefault("GEMINI_API_KEY", "fake-gemini")
os.environ.setdefault("FEATURE_REVIEW_ENGINE", "1")
os.environ.setdefault("FEATURE_EXAM_MODE", "1")
os.environ.setdefault("DATABASE_URL", "postgresql://guard:guard@db.invalid:5432/unit_tests")

import json
import sys
from pathlib import Path


def main() -> None:
    from backend.main import app

    schema = app.openapi()

    out_path = Path(__file__).resolve().parent.parent.parent / "docs" / "openapi.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(schema, indent=2, default=str) + "\n")
    print(f"Wrote OpenAPI schema ({len(schema.get('paths', {}))} paths) to {out_path}")


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    main()
