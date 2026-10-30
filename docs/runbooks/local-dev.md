# Local development

*The toolchain as it is verified on Abi's Mac (2026-08-17, re-checked 2026-10-30). Paths are absolute where the tools need them to be.*

## Dev servers (`.claude/launch.json`, used by `preview_start`)

| Name | What | Port |
|---|---|---|
| `dev` | Vite | 5173 |
| `dev-preview`, `dev-preview-exam`, `dev-preview-student-courses` | extra Vite instances for parallel sessions | 5199, 5202, 5204 |
| `backend-api` | uvicorn `backend.main:app --reload` | 8000 |
| `backend-worker` | Arq worker | none |

Node is pinned by absolute path to `~/.nvm/versions/node/v22.23.1/bin/node` because the agent shell builds `PATH` from every nvm version in sort order and an older one would win. Python is `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python`; a relative `.venv/bin/uvicorn` fails with a permission error before Python starts. Use `.venv/bin/python` for pytest, not `backend/venv`.

Redis for both queues: `docker compose up redis redis-queue -d` (needs `REDIS_PASSWORD` in `.env`). Vite proxies `/api` to `127.0.0.1:8000`, so the app on 5173 talks to the local API and CORS never applies in dev. `./dev.sh` starts API and frontend in one terminal.

## Database

- `DATABASE_URL` in `.env` is the prod Supabase project through the transaction pooler (port 6543). Local development runs against prod data. Be careful with writes; there is no PITR.
- `psql "$DATABASE_URL"` works (`/opt/homebrew/bin/psql`). For dumps use port 5432.
- Supabase CLI is `~/.local/bin/supabase` (raw release binary; brew fails on this machine). It is not linked to the project; use `--db-url`. Never `db push`.
- DB and RLS tests: `pytest -m db backend/tests` needs Docker for testcontainers.

## Accounts

- Default test learner: `abdul@test.com`. The password is not in the repo; ask Abi or set one with the Admin API (`docs/runbooks/rotate-a-secret.md`).
- `prof@admin.com` and `admin@admin.com` exist on prod; passwords rotated 2026-10-30, not recorded.
- A user with two rows in `user_roles` is locked out of every guarded route; fix the data, not the guard.

## Checks

```bash
npm run lint
npx vitest run
npx tsc --noEmit -p tsconfig.app.json          # tsconfig.json checks nothing
.venv/bin/python -m pytest backend/tests -m "not db" -q
npx playwright test                            # chromium must be installed once: npx playwright install chromium
```

The backend tests must not see a `.env` with the prod DSN as the only source of truth: `backend/tests/network_guard.py` and `fake_supabase.py` keep them hermetic, and PR #99 stopped `orchestrator.py` from overwriting the process env on import.

## Browser verification

Use `preview_start` with `dev` and `backend-api`, then walk the rooms. On `/auth` the browser tool's `form_input` does not register in the React form; click the field and type. Sign-up on a fresh address lands on `/onboarding`, then `/v4/home`.

## Several sessions, one tree

Abi runs several Claude sessions on the same checkout on purpose. Before every commit and push: `git status`, `git log -1`, and look at what is staged. Never use bare `git stash`.
