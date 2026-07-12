# Learnstation — Setup Guide

> The canonical quickstart lives in [README.md](README.md) (“Run with Docker”).
> This guide covers the manual/local path and project-specific details.
> Last refreshed: 2026-07-11.

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Node.js | ≥ 20.19 | `node --version` |
| Python | ≥ 3.11 | `python3 --version` |
| Docker + Compose | current | `docker compose version` |

## Environment

```bash
cp .env.example .env
```

Fill in at minimum: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`,
and `REDIS_PASSWORD` (required by docker-compose). The full variable reference
is in the README env table and in `.env.example` comments.

**Never commit `.env`** (it is gitignored) and never put server secrets in a
`VITE_`-prefixed variable — anything `VITE_*` that gets imported is baked into
the public JS bundle.

## Install

```bash
# Frontend
npm install

# Backend (full local set, includes optional parser extras)
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
# For running tests:
pip install -r backend/requirements-dev.txt
```

## Database

Schema is managed as plain SQL migrations in `supabase/migrations/` (70+
files). Apply them with the Supabase CLI (`supabase db push`) or by running
them in the dashboard SQL editor in filename order. There is no Alembic.

## Run

**Everything in Docker** (frontend + api + worker + redis + litellm):

```bash
docker compose up --build
# Frontend http://localhost:3000 · API http://localhost:8000
```

**Hybrid (recommended for development)** — infrastructure in Docker, app local:

```bash
docker compose up redis litellm -d

# Terminal 1 — API
uvicorn backend.main:app --reload            # http://localhost:8000 (docs at /docs)

# Terminal 2 — Arq worker (async PDF processing)
python -m arq backend.workers.arq_worker.WorkerSettings

# Terminal 3 — Frontend
npm run dev                                   # http://localhost:5173
```

There is also `./dev.sh`, which starts the hybrid stack in one command.

## Tests

```bash
npm run test                 # frontend (vitest)
pytest backend/tests/unit    # backend unit tests
pytest -m db backend/tests   # DB/RLS tests (needs Docker for testcontainers)
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Compose exits: `set REDIS_PASSWORD in .env` | Add `REDIS_PASSWORD=<anything strong>` to `.env` |
| Port 8000 in use | `lsof -i :8000`, kill it, or `--port 8001` |
| Redis connection refused | `docker compose up redis -d` |
| LiteLLM 404 errors | `docker compose up litellm -d` (first boot takes ~1–2 min) |
| Supabase auth errors | Verify `SUPABASE_SERVICE_ROLE_KEY` is the service_role key |
| ESLint crashes with `structuredClone is not defined` | Your shell is on Node < 17 — switch to Node 20+ (`nvm use 20`) |
| Parser v3/v4 fails inside Docker | Expected — the image ships the lean requirement set; use `PARSER_VERSION=5` (default) or `2` |

More detail: [backend/README.md](backend/README.md) ·
[PRODUCTION_INFRA_GUIDE.md](PRODUCTION_INFRA_GUIDE.md) ·
[project_docs/](project_docs/)
