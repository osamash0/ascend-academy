# Secrets & Supply-Chain Audit (S-5)

> Companion to `docs/ROADMAP_10X_FOUNDATION.md` §14 S-5. Findings from a local run of
> `pip-audit`, `npm audit`, and `gitleaks` against this repo, plus a manual audit of the
> service-role key's blast radius and a review of `.env.example`. All commands below can be
> re-run locally; the same scans now run in CI (`.github/workflows/ci.yml` — `dependency-scan`,
> `secret-scan` jobs).

## 1. Dependency vulnerability scan (SCA)

### Backend — `pip-audit -r backend/requirements.txt`

**8 known vulnerabilities, all in one package: `litellm` (resolved to 1.83.0` from the
previously-unpinned `litellm>=1.40`):**

| ID | Fixed in | Summary |
|---|---|---|
| PYSEC-2026-388 | 1.84.0 | Host-header parsing flaw in the LiteLLM **proxy server** could allow unauthenticated access to protected management routes |
| PYSEC-2026-391 | 1.83.7 | Proxy API-key check mixed caller-supplied key into a SQL query instead of parameterizing it |
| PYSEC-2026-2602 | 1.83.7 | `POST /prompts/test` rendered user-supplied templates unsandboxed |
| PYSEC-2026-2601 | 1.83.10 | `POST /guardrails/test_custom_code` sandbox for user-supplied Python was escapable |
| PYSEC-2026-2599 | 1.83.7 | MCP-server preview endpoints allowed request forgery |
| PYSEC-2026-2598 | 1.83.14 | Authenticated internal_user could create API keys with routes beyond their role |
| PYSEC-2026-2600 | 1.83.10 | A user could modify their own `user_role` via `/user/update` |

**Context that matters:** every one of these is a vulnerability in the **LiteLLM proxy
server**. This repo does not run that proxy server from the pip package — the actual gateway
in prod is the Docker image `ghcr.io/berriai/litellm:main-latest` (`docker-compose*.yml`), a
separate artifact with its own patch cadence. The pip package in `backend/requirements.txt` is
only imported as an SDK, and only from **`backend/_legacy/`** (`fast_upload.py`,
`stage2/3/5_*.py` — dead code already flagged for deletion in P4-4). The live parser path
(`backend/api/v1/courses.py`, `backend/core/config.py`) talks to the gateway over HTTP via a
plain `AsyncOpenAI` client pointed at `LITELLM_BASE_URL`, never importing `litellm` directly.

**Net risk today: low** (no live code path exercises the vulnerable proxy code), but the
floating `>=1.40` requirement meant any fresh install silently picked up all 8 CVEs with zero
signal. Fixed by pinning the floor to `litellm>=1.84.0` (past every fix version above) in this
change. Once `_legacy/` is deleted per P4-4, this dependency can likely be dropped entirely —
flagged there, not duplicated here.

Re-run: `pip install pip-audit && pip-audit -r backend/requirements.txt`

### Frontend — `npm audit`

**0 vulnerabilities** (info/low/moderate/high/critical all zero) at time of this audit.
Re-run: `npm ci --legacy-peer-deps && npm audit`

## 2. Secret scanning (`gitleaks`)

Ran `gitleaks detect` two ways:

1. **Working tree** (`--no-git`, scans files on disk including untracked): 61 matches.
   - The only *real* secret-shaped matches are in the local, **untracked** `.env` file
     (Groq `gsk_...`, Cerebras `csk-...`, OpenRouter `sk-or-v1-...`, a Redis password) — this
     is exactly what `.env` is for, and `git ls-files | grep -x .env` confirms it is **not**
     tracked by git (`.gitignore:20` excludes `.env`/`.env.*`, with an explicit
     `!.env.example` allowlist). No leak.
   - The remaining ~57 matches are false positives: a documented example Supabase anon-key
     JWT repeated across `SETUP_GUIDE.md` in several worktrees, and an i18n string key
     (`privacy.section7Body`) in `src/pages/Datenschutz.tsx` that gitleaks' generic-api-key
     regex misfires on.
2. **Git history** (last 30 commits, `gitleaks detect --log-opts="-30"`): **no leaks found.**

Conclusion: no real secret is committed to git history or tracked files. `secret-scan` is now
wired into CI (`gitleaks/gitleaks-action@v2`, free for github.com repos — only GitHub
Enterprise Server needs a paid license) to keep it that way; it will flag any future commit
that accidentally includes a real key.

## 3. Service-role key blast radius

`backend/core/database.py:60-109` resolves the service-role key from
`SUPABASE_SERVICE_ROLE_KEY` (falling back to the anon key with a loud warning if unset), and
uses it to construct the single `supabase_admin` client — the only client in the codebase
built from that key. It is:

- Read **only** from a backend-side env var (`SUPABASE_SERVICE_ROLE_KEY` in `.env`/
  `.env.example:36`, "grants full DB access; keep secret").
- **Never** referenced with a `VITE_` prefix anywhere. Vite (`vite.config.ts`) uses its
  default `envPrefix` (no override), so only `import.meta.env.VITE_*` vars are inlined into
  the client bundle. `grep -rn "import.meta.env" src/` finds exactly 8 `VITE_*` vars in use
  (`VITE_ANON_SALT`, `VITE_API_URL`, three `VITE_FEATURE_*` flags, `VITE_SENTRY_DSN`,
  `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`) — the anon/publishable key and public
  project URL only, both explicitly designed to be public.
- **Conclusion: safe.** The service-role key has no `VITE_`-prefixed alias, no reference in
  frontend source, and cannot reach the browser bundle through the Vite build. This confirms
  the S-5 acceptance criterion ("the service-role key's blast radius is documented; it never
  reaches the browser bundle").

The broader blast-radius question — *how many backend call sites* use `supabase_admin`
(151 per the roadmap's P2-1 finding) — is P2-1's concern (make RLS the API boundary), not
duplicated here; this audit only confirms the key itself never leaves the backend process.

## 4. `.env.example` review

8.0 KB, ~220 lines, heavily commented (every variable has a 1-3 line explanation of what it
is, where to get it, and whether it's required). Reviewed for two things:

1. **Anything that looks like a real secret** (`grep` for long random-looking strings,
   `sk-`/`gsk_`/`csk-`/`AIza`/JWT-shaped prefixes): **none found.** Every credential-shaped
   variable (`SUPABASE_SERVICE_ROLE_KEY`, `*_API_KEY`, `LITELLM_MASTER_KEY`,
   `SENTRY_AUTH_TOKEN`, etc.) is left blank; the only non-empty values are non-secret defaults
   (`PARSER_VERSION=5`, `ARQ_MAX_QUEUE_DEPTH=50`, `ENVIRONMENT=local`,
   `FEEDBACK_EMAIL_TO=admin@learnstation.edu`) or explicitly-safe-to-expose values
   (`VITE_SUPABASE_URL`, `VITE_ANON_SALT=learnstation-analytics-2026` — a fixed non-secret
   salt for client-side analytics hashing, not a credential).
2. **Is it excessively broad?** The file lists ~40 variables across Supabase, 7 LLM
   providers, Redis, LiteLLM, CORS, frontend build vars, the PDF parser, feature flags, and
   Sentry — but every one is either required by a currently-active integration or an
   explicitly-optional provider in the orchestrator's fallback chain (`GROQ_API_KEY` /
   `GEMINI_API_KEY` / `CEREBRAS_API_KEY` / `OPENROUTER_API_KEY` / `MISTRAL_API_KEY` /
   `CLOUDFLARE_*`). Its size is a documentation-thoroughness artifact, not scope creep or a
   leaked-value risk. **No changes made** — the file is broad but not unsafe.

## 5. Deferred (not in this change)

- Deleting `backend/_legacy/` (would remove the only live `litellm` SDK import) — P4-4's
  scope.
- Full `requirements.txt` re-pinning of all 30/39 unpinned lines — P4-4's scope
  (`pip-tools`/`uv` lockfile); only `litellm` was bumped here because it had an active,
  checkable vulnerability.
- `supabase_admin` call-site reduction (151 references in `api/v1/`) — P2-1's scope.
