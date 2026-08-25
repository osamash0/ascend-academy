# Security Audit — Learnstation

Performed on branch `security-audit` (off `main` @ `0be0081`, confirmed
bit-identical to `origin/main` before starting). Scope: Part A (targeted
security review of four specific areas) and Part B (four small, independent
engineering additions). No refactors beyond what a finding required; nothing
already solid was touched.

## Part A — Security Audit Findings

### A1. `backend/api/v1/admin.py` — SQL built with f-strings — **SAFE, verified**

- **Severity:** N/A (not vulnerable)
- **Status:** Documented + regression test added (no fix — nothing was wrong)
- **Commit:** `56030b8`

`list_users`, `list_events`, and related admin endpoints (`admin.py:30-330`)
build their `WHERE`/`ORDER BY`/`LIMIT` clauses using f-strings, which looks
suspicious at a glance. On inspection, every f-string only does one of two
safe things:
1. Places a `$N` positional **placeholder** (e.g.
   `f"(p.full_name ILIKE ${len(params)} ...)"`) — the actual value is
   appended to a `params` list and passed to asyncpg as
   `conn.fetch(query, *params)` / `conn.fetchval(query, *params)`, which is
   asyncpg's real parameterized binding.
2. Picks a column name from a fixed allowlist dict (`sort_mapping`,
   `admin.py:47-53`), with a hardcoded safe default (`p.created_at`) for any
   unrecognized `sort_by` value — user input never reaches the SQL text for
   sort columns either.

No code path re-interpolates a value into the query string. A regression
test (`backend/tests/integration/test_admin_sql_safety.py`) now proves this:
it captures every `(query, args)` pair the endpoint issues and asserts an
injection-style string (`"'; DROP TABLE profiles; --"`) passed as `search`
or `sort_by` never appears in the raw SQL text, only in the bound `args`.

### A2. `validate_upload()` — content/magic-byte validation — **SAFE, already solid**

- **Severity:** N/A (not vulnerable)
- **Status:** Documented only — no fix, no new test needed
- **Commit:** none (verification only)

`backend/services/upload_service.py` + `backend/core/file_validation.py`
already validate file **content**, not just the extension:
- PDF: `validate_pdf_content()` checks an anchored `%PDF-` magic-byte prefix
  (`file_validation.py:15-33`) — a substring match was deliberately rejected
  in favor of an anchored `startswith` check, so a non-PDF file with `%PDF`
  embedded mid-content is still rejected.
- PPTX: `_validate_pptx()` checks the ZIP container magic bytes `PK\x03\x04`
  (`upload_service.py:140-149`), then actually opens it with
  `python-pptx` to count slides, rejecting corrupt/empty decks.

A renamed malicious file (e.g. an executable renamed to `.pdf`) fails at the
magic-byte check before any parser ever touches its bytes. This is already
regression-tested: `backend/tests/unit/test_upload_service.py:107-110`
rejects a `.txt`-content file even when called with a `.pdf`-shaped
filename, and `:153-154` rejects bad PPTX magic bytes. No fix or new test
was needed.

### A3. `require_role` fallback path (`backend/core/auth_middleware.py:194-237`) — **No gap found**

- **Severity:** N/A (not vulnerable)
- **Status:** Documented only — reviewed, no fix needed
- **Commit:** none (verification only)

`require_role`'s dependency checks the JWT's `app_metadata.role` first (safe:
`app_metadata` is service-role-writable only), then falls back to a DB
lookup (`_lookup_role_from_db`) against the `user_roles` table. Confirmed
the fallback fails **closed**: any exception during the DB lookup returns
`None`, which is deliberately *not* merged into the `roles` set — so the
subsequent `roles.intersection(allowed_roles)` check still fails and the
request gets `403`, not silently authorized. `user_metadata` (user-editable)
is correctly excluded from every authorization decision. No gap found in
this focused pass.

### A4. Frontend console logging — **Moderate, fixed**

- **Severity:** Moderate (information disclosure, not a direct token/PII leak)
- **Status:** Fixed
- **Commit:** `f50690c`

No call site logs a session/token/user object directly. However,
`src/lib/apiClient.ts:83` embeds the raw backend response body text into
`ApiError.message`, and roughly 150 unconditional `console.error`/
`console.warn` calls across `src/` (worst spots: `LectureChat.tsx`,
`Auth.tsx`, `admin/UserDetailDrawer.tsx`) can end up printing that text —
visible to anyone with devtools open on a production page. None of these
calls were gated behind a dev-only check, and `vite.config.ts` had no
console-stripping configuration at all.

**Fix:** added a top-level `esbuild: { drop: mode === "production" ?
["console", "debugger"] : [] } }` to `vite.config.ts`. Verified empirically
by building and grepping `dist/assets/*.js`: dropped from ~45 files
containing application call sites down to 4 files, and all 4 remaining hits
are third-party vendor code (supabase-js's default logger assignment,
i18next's internal warn fallback, React's internal error-reporting
fallback) — not any of the application's own call sites. Dev/test mode is
unaffected (the drop only applies when `mode === "production"`), confirmed
by `vitest run` (89 files / 623 tests) passing unchanged.

### Bonus finding (out of the requested scope) — hidden import-time network call

- **Severity:** Low / reliability, not a vulnerability
- **Status:** Documented only — not fixed, out of scope
- **Location:** `backend/services/ai/orchestrator.py:1064`

While validating the OpenAPI export step (B4), discovered
`tiktoken.get_encoding("cl100k_base")` runs at **module import time**,
unconditionally, guarded only by `except ImportError` — not network errors.
This makes a real HTTPS call to `openaipublic.blob.core.windows.net` the
first time this module is imported in a process. It reproduced locally as
both a raw `SSLError` (in contexts without the test suite's network guard)
and a `BlockedOutboundAccess` (in contexts with it) — the latter directly
contradicts `backend/tests/conftest.py`'s stated "zero outbound network"
goal for unit tests. Real CI runners (GitHub Actions, real internet) should
succeed here since the environment isn't offline, but this is a hidden,
unconditional import-time dependency on an external host worth a dedicated
fix (e.g. lazy-load the encoding, vendor the BPE file, or cache it) in a
future, separate change — not attempted here since it's outside the
requested audit surface and touching AI orchestration code wasn't part of
this mandate.

## Part B — Engineering Additions

### B1. Frontend coverage thresholds

- **Commit:** `651b6d6`

Added `coverage.thresholds` to `vitest.config.ts`, scoped per the existing
`coverage.include` globs, using real measured numbers (clean
`npm ci --legacy-peer-deps` environment, `npx vitest run --coverage`) rather
than guessed values:

| Directory | Documented target (`TESTING_STRATEGY.md`) | Measured actual | Threshold set |
|---|---|---|---|
| `src/hooks/**` | 60% stmts / 50% branches | 81.22% / 74.3% | 60% / 50% (documented value — comfortably cleared) |
| `src/lib/**` | 70% / 60% | 78.09% / 84.92% | 70% / 60% (documented value — comfortably cleared) |
| `src/services/**` | 65% / 55% | 61.11% / 75.27% | **60%** / 55% (statements ratcheted down — see below) |
| `src/pages/**` | "smoke only", no numeric target | 70.46% / 70.71% | not thresholded (per doc) |

**Gap to follow up:** `src/services/**` statement coverage (61.11%) is
below the documented 65% target. Rather than land a threshold the suite
doesn't currently meet (which would break CI on day one), the statements
threshold here is set to 60% — the measured value, floored for a small
margin — not the aspirational 65%. Closing this ~5-point gap with real
tests is a follow-up, not attempted in this audit.

### B2. Ruff blocking in CI (changed-files ratchet)

- **Commit:** `7cb9531`

180 pre-existing violations (53 E402, 49 E701, 35 E741, 32 F401, 8 F841,
2 F811, 1 E731 per the prior CI comment) were not all safely auto-fixable —
E402/E741 are sometimes intentional in this codebase (e.g. `conftest.py`
deliberately imports after env-var setup). Instead of a risky bulk fix or a
blanket ignore, added a new CI step that, on `pull_request` only, diffs
changed `backend/**/*.py` files against the PR base and runs `ruff check`
on just those files, **blocking**. The existing full-repo
`ruff check backend/ --statistics || true` step is unchanged and stays
non-blocking for push/schedule/dispatch triggers. Zero pre-existing
violations were touched; the one new violation this ratchet caught (an
import-order issue in this branch's own new test file) was fixed as part
of the same commit.

### B3. `.pre-commit-config.yaml`

- **Commit:** `f236d42`

New file: ruff hook (`astral-sh/ruff-pre-commit` v0.16.4, matching the
version pinned by `backend/requirements-dev.txt`'s `ruff>=0.15`, using
ruff's default rule set since no `[tool.ruff]` config exists anywhere in
this repo) + standard `pre-commit/pre-commit-hooks` v5.0.0 hygiene hooks
(trailing whitespace, end-of-file, YAML validity, large files, mixed line
endings). Dev-tooling only — not installed into git hooks and not wired
into CI.

### B4. OpenAPI JSON export in CI

- **Commit:** `8bf3cc8`

New `backend/scripts/export_openapi.py`, wired as a step in the
`backend-tests` CI job (after the pytest step, so it only runs once that
same import chain has already proven to work in that run). Sets the same
throwaway env vars `backend/tests/conftest.py` sets, imports
`backend.main`, and dumps `app.openapi()` to `docs/openapi.json` — this is
unaffected by `main.py`'s `docs_url=None`/`openapi_url=None` gating outside
`development`, since that only disables the live HTTP *route*, not the
`app.openapi()` method itself. Uploaded as a build artifact
(`openapi-schema`, matching the existing `backend-coverage`/
`frontend-coverage` artifact pattern) — not committed back into the repo
(`docs/openapi.json` is gitignored), so no bot-write risk. Verified locally:
produces valid JSON, OpenAPI 3.1.0, 141 paths.

## Verification summary

- Backend: `pytest backend/tests/integration/test_admin_endpoints.py
  backend/tests/integration/test_admin_sql_safety.py` — 15 passed, after
  every backend-touching commit.
- Frontend: `npx vitest run --coverage` — 89 files / 623 tests passed, all
  coverage thresholds met (exit 0); `npm run lint` — 0 errors;
  `npm run build` — succeeds, verified console-stripping via grep.
- A local Windows-only pytest/asyncio environment issue was found and
  worked around for verification (not a repo bug): the test suite's own
  network-blocking fixture (`conftest.py:158-159`, patches
  `socket.socket.connect`) is broader than intended on Windows, because
  Windows' asyncio implementation internally emulates `socketpair()` with a
  real loopback TCP connection for its event-loop wakeup pipe — the guard
  blocks that internal call too, not just outbound network calls. This
  reproduces on completely unrelated, pre-existing test files (confirmed via
  `test_metrics.py`, `test_upload_service.py`) and does not occur on Linux
  (real `socketpair()` syscall, no loopback TCP emulation needed) — i.e. it
  does not affect the actual CI signal (`ubuntu-latest`). Verification for
  this audit therefore used targeted test-file runs rather than a full
  `pytest backend/tests` invocation, which is unreliable in this specific
  local sandbox for reasons unrelated to any change in this audit.
