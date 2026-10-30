# Learnstation — read this first

*Kept under 120 lines on purpose. Facts carry a date; a fact without one was verified against the code on 2026-10-30. Longer orientation: `docs/START_HERE.md`.*

## What this is

Learnstation: you drop a PDF, you read it at once, and the AI (Luna) lights the pages up while you read. The reader is the product; Spaces, Library, Luna sessions and analytics layer onto it, never replace it. The v4 UI is what prod serves (since 2026-10-29). The older rooms (`/course/*`, `/lecture/*`, `/professor/*`) still exist in code but learners are routed to `/v4/*`.

## Where things are

| Path | What |
|---|---|
| `src/` | Vite + React 18 + TypeScript. `src/App.tsx` is the router (`/v4/*` = the live app). |
| `src/features/spaces/` | The v4 app: screens, reader, library, studio, landing. Nothing hard-coded in English; strings come from i18n. |
| `src/i18n/locales/{en,de}/` | 26 namespaces each. `v4*` namespaces are the live app; the rest belong to the older rooms. |
| `src/lib/featureFlags.ts` | Frontend flags, read from `VITE_FEATURE_*` at build time. |
| `backend/` | FastAPI (`backend/main.py`), routes under `backend/api/v1/`, parser in `backend/services/parser/`, Luna in `backend/services/luna/`, LLM calls in `backend/services/ai/orchestrator.py` (providers called direct, no gateway). |
| `backend/workers/arq_worker.py` | The Arq worker that parses uploads. |
| `supabase/migrations/` | Plain SQL, 136 files. The only schema source. |
| `docs/` | `START_HERE.md`, `V4_GLOSSARY.md`, `BRAND_VOICE.md`, `runbooks/`, `prompts/`, `INVENTORY.md`, `archive/`. |
| `e2e/`, `src/**/__tests__`, `backend/tests/` | Playwright, Vitest, pytest. |
| `.claude/launch.json` | Dev servers for `preview_start`: `dev` (5173), `backend-api` (8000), `backend-worker`. |

## Commands that gate (what CI runs, `.github/workflows/ci.yml`)

```
npm run lint                                   # i18n parity + v4 string guard + eslint
npx vitest run
npx tsc --noEmit -p tsconfig.app.json          # tsconfig.json checks NOTHING (it is a references-only file)
.venv/bin/python -m pytest backend/tests -m "not db" -q
ruff check backend/ --select F821,F811,F841
npx playwright test                            # e2e
```

CI runs on pull requests and on pushes to `main`, plus a nightly at 03:17 UTC (DB/RLS tests, SCA, gitleaks, AI eval). **It does not run on a feature-branch push without a PR.** Migration governance: duplicate timestamps fail, new `SECURITY DEFINER` functions are linted.

## Prod (dated facts; the deploy runbook is `docs/runbooks/deploy-main-to-prod.md`)

- Hetzner CX23 at `195.201.221.137`, Ubuntu 24.04, Docker. Live at https://learnstation.app (moved 2026-10-30). www and both old hosts redirect to the apex; Cloudflare is DNS only. Evidence/rollback: `docs/ops/2026-10-30-learnstation-app-move.md`.
- Containers from `docker-compose.prod.yml`: `api`, `worker`, `frontend` (nginx on 3000, proxies `/api/` to `api:8000` unchanged), `redis`, `redis-queue`.
- Deploys are manual over SSH; there is no deploy automation. Last full deploy: main @ 35a30d73, 2026-10-30 15:24 UTC. Rollback images are tagged `pre-deploy-main-<date>`.
- Flags on in prod (2026-10-30): `FEATURE_V4`, `FEATURE_V4_READER`, `FEATURE_LUNA_SESSIONS`. Each `VITE_FEATURE_*` is derived from its backend flag in the compose file. `VITE_*` values are baked at image build, so any frontend change needs a rebuild, not a restart.
- Supabase project `lkiiideqjoiksnycgplc` (eu-west-1, free tier, no PITR). Auth emails go through Resend since 2026-10-30.
- Monitoring and backups (2026-10-30, both free): Better Stack alerts Abi by e-mail when the site, the server's 5-minute heartbeat or the nightly backup goes quiet; each nightly dump is age-encrypted to Cloudflare R2 (`learnstation-backups`). The decryption key is only in Abi's password manager. Runbook: `docs/runbooks/monitoring-and-backups.md`.
- Real usage is near zero since August 2026 (measured 2026-10-30). Optimise for a handful of real students, not scale.

## Rules Abi has set

- Reader first. Every feature is judged by whether it makes reading better; "the reader is the product" is felt, never said in copy.
- Voice: calm, assured, never salesy. No pain-contrast hooks. German is du, never Sie; see `docs/BRAND_VOICE.md`. Words: `docs/V4_GLOSSARY.md` (Space, Lektion, Seite, Idee; never Folie/Vorlesung/Kurs).
- One fact, once: never repeat a label or number on a screen, including the top bar. Show, don't count.
- Only demo or describe what the app really does today. No promised features in copy.
- Luna stays identifiable (her face, helmet, eyes). Vary scale and motion, never abstract her.
- New screens reuse an existing flow's visual language. Adopted design rules: no eyebrow labels, no decorative dots, no glow, figures not gauges, hairline lists.
- End every substantial answer with a short summary section.
- Learnstation only. Plan from the release punch list; never propose other projects.
- Abi runs several Claude sessions on one working tree. Re-run `git status` and `git log -1` before every commit and push.

## Traps (each one cost a session)

- `backend/services/ai/orchestrator.py` calls `load_dotenv(override=True)`: importing it overwrites a blanked env with the prod DSN. Fixed on main by PR #99; still never run backend tests with a `.env` you do not trust.
- Two env files: the API loads `backend/.env`, compose loads root `.env`. To know which flags are live, introspect the running app, not a file.
- `nginx.conf` comments claim `/api` is stripped. It is not; `proxy_pass $backend` with a variable keeps the URI. Do not "fix" nginx to match the comment.
- **Never run `supabase db push`.** The prod migration ledger has 2 rows for 136 files. Apply migrations by hand with psql and verify with `pg_catalog` probes. Runbook: `docs/runbooks/apply-a-migration-by-hand.md`.
- `DATABASE_URL` is the transaction pooler on port 6543. pg_dump and restore need port 5432, and a restore needs the `extensions` schema pre-created or rows vanish.
- A second row in `user_roles` for one user silently bounces that account out of every guarded route (`fetchRole` uses `.single()`).
- Seed scripts never reset an existing user's password. Default test account: `abdul@test.com` (password not in the repo).
- Subagent worktrees branch from `main`, not from your HEAD, and have no `node_modules` or `.env`. A reviewer there reads the wrong code.
- In the browser tools, `form_input` does not register in React forms on `/auth`; click and type instead.
- `docker images` prints UTC; commits are +0200. Compare in one zone before deciding whether a build contains a commit.
- Nothing on the server is "what `git log` says": the server checkout and the running images can differ. Check image build dates.

## Trackers

- Release punch list: the shared artifact "Learnstation Release Punch List" (db collection `issues`, ids `LS-NNN`). Open work lives there, not in this file.
- `docs/INVENTORY.md` says which doc is current. `docs/prompts/` holds reusable session prompts.
- Claude's memory files are per-machine. Anything the repo needs must live in the repo.
