"""
P2-1 (Foundation 10x roadmap, §7 / §4 cross-cutting standard): "No new
`supabase_admin` (service-role) call site in `api/v1/` without an explicit
reviewer sign-off comment; prefer the RLS-enforcing per-user client."

This is intentionally lightweight, not exhaustive: it does not (yet) audit
every one of the ~150 existing `supabase_admin` references across
`backend/api/v1/` -- that's the documented, still-open remainder of P2-1
(see the commit message / roadmap for the itemized list). What it DOES do,
and can actually enforce in CI:

  1. Freezes the current set of `api/v1/*.py` files that already import
     `supabase_admin` (the pre-P2-1 baseline) as a grandfathered allow-list --
     converting all of them is out of scope for this slice.
  2. For every OTHER (i.e. new, or newly-supabase_admin-importing) file under
     `api/v1/`, requires an explicit sign-off marker (`# ADMIN:` or
     `# sign-off:`) on the import line itself, so a reviewer can see *why*
     the RLS-enforcing client wasn't used instead of `supabase_admin`.
  3. Fails loudly (rather than silently passing) the day someone adds a new
     `api/v1/` router that imports `supabase_admin` with no justification, or
     removes the justification comment from an existing non-grandfathered
     file.

If you're deliberately migrating a grandfathered file to the RLS-enforcing
client (as `courses.py::list_courses`/`browse_courses` were in this same
change), you don't need to touch this test -- the file stays on the
allow-list; a future full audit (§14 S-1) is expected to shrink the
allow-list file-by-file rather than this test enforcing it wholesale.
"""
from __future__ import annotations

import re
from pathlib import Path

API_V1_DIR = Path(__file__).resolve().parents[2] / "api" / "v1"

# Baseline as of the P2-1 slice (2026-07-19/20): every api/v1/*.py file that
# already imports supabase_admin. Grandfathered -- NOT required to carry a
# sign-off comment. This is the itemized "still on supabase_admin" surface
# from the roadmap's acceptance criteria; shrinking it is future work.
_GRANDFATHERED_FILES = {
    "academic.py",
    "admin.py",
    "ai_content.py",
    "assignments.py",
    "auth.py",
    "concepts.py",
    "courses.py",
    "feedback.py",
    "mind_map.py",
    "practice_sheets.py",
    "schedule.py",
    "search.py",
    "slides_ai.py",
    "upload.py",
    "worksheets.py",
}

_SIGNOFF_MARKERS = ("# ADMIN:", "# sign-off:")

# Matches any import statement that brings `supabase_admin` into scope,
# e.g. `from backend.core.database import supabase_admin`,
# `from backend.core.database import SUPABASE_URL, supabase_admin, create_client`,
# or `import backend.core.database as db` followed by `db.supabase_admin` use
# (the latter isn't caught by this narrow regex -- see limitation note below).
_IMPORT_RE = re.compile(r"^\s*from\s+[\w.]+\s+import\s+.*\bsupabase_admin\b")


def _api_v1_files() -> list[Path]:
    assert API_V1_DIR.is_dir(), f"expected api/v1 dir at {API_V1_DIR}"
    return sorted(API_V1_DIR.glob("*.py"))


def test_grandfathered_allowlist_files_still_exist():
    """Sanity check: the allow-list doesn't silently rot into referencing
    deleted files (which would make the real check below vacuous for them)."""
    present = {p.name for p in _api_v1_files()}
    missing = _GRANDFATHERED_FILES - present
    assert not missing, (
        f"Grandfathered api/v1/ files no longer exist: {missing!r}. "
        "Remove them from _GRANDFATHERED_FILES in this test."
    )


def test_no_new_unsigned_supabase_admin_imports():
    """
    A file NOT on the grandfathered allow-list that imports `supabase_admin`
    must carry an explicit sign-off comment on the same import line,
    matching the cross-cutting standard in
    docs/ROADMAP_10X_FOUNDATION.md §4: "No new `supabase_admin`
    (service-role) call site in `api/v1/` without an explicit reviewer
    sign-off comment; prefer the RLS-enforcing per-user client."
    """
    violations: list[str] = []

    for path in _api_v1_files():
        if path.name in _GRANDFATHERED_FILES:
            continue
        text = path.read_text()
        for lineno, line in enumerate(text.splitlines(), start=1):
            if _IMPORT_RE.match(line) and not any(m in line for m in _SIGNOFF_MARKERS):
                violations.append(f"{path.relative_to(API_V1_DIR.parent.parent)}:{lineno}: {line.strip()}")

    assert not violations, (
        "New api/v1/ file(s) import supabase_admin without a sign-off "
        "comment (# ADMIN: ... or # sign-off: ...) explaining why the "
        "RLS-enforcing per-user client (analytics_service.get_auth_client) "
        "wasn't used instead. If this is intentional, add the comment on "
        "the import line; if it's an existing/expected site, add the file "
        f"to _GRANDFATHERED_FILES in this test.\n" + "\n".join(violations)
    )
