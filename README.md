# Learnstation

Drop a PDF. Read it at once. Luna, the AI, lights the pages up while you read.

Learnstation is a reading-first learning app for anyone with material to get through: lecture slides, a paper, a chapter. You put it into a Space, the reader opens it page by page before any AI has run, and explanations, questions, checkpoints and practice arrive beside the page as Luna reads behind you. Spaces hold people and Lessons; the Library holds everything you have dropped. English and German from one setting, including the AI's answers.

Live at [learnstation.app](https://learnstation.app). Public repository; the production secrets are not in it.

## Run it

Prerequisites: Node ≥ 20.19, Python ≥ 3.11, Docker with Compose, a Supabase project.

```bash
cp .env.example .env     # fill in Supabase keys, an LLM key, REDIS_PASSWORD
docker compose up --build
# Frontend http://localhost:3000 · API http://localhost:8000
```

For day-to-day development run the infrastructure in Docker and the app locally: `docs/runbooks/local-dev.md`. The manual path, env reference and troubleshooting table are in `docs/SETUP_GUIDE.md`.

## What is in the box

| Part | Where | Built with |
|---|---|---|
| The app | `src/`, the live rooms under `src/features/spaces/` | Vite, React 18, TypeScript, Tailwind, shadcn/ui, TanStack Query, i18next |
| The API | `backend/` (`backend/main.py`, routes in `backend/api/v1/`) | FastAPI, Pydantic v2, slowapi |
| The parser and Luna | `backend/services/parser/`, `backend/services/luna/`, `backend/services/ai/` | PyMuPDF, an Arq worker, LLM providers called direct |
| The data | `supabase/migrations/` | Supabase: Postgres with RLS, Auth, Storage |
| Queues and cache | `docker-compose*.yml` | Two Redis instances |
| Tests | `src/**/__tests__`, `backend/tests/`, `e2e/` | Vitest, pytest, Playwright |

## Checks before a pull request

```bash
npm run lint                                 # i18n parity, v4 string guard, eslint
npx vitest run
npx tsc --noEmit -p tsconfig.app.json
.venv/bin/python -m pytest backend/tests -m "not db" -q
```

CI runs these plus Playwright, migration governance and nightly security scans (`docs/SECURITY_CI.md`). Only pull requests and pushes to `main` trigger it.

## Documentation

- `CLAUDE.md`: the one page to read first, kept short and dated.
- `docs/START_HERE.md`: ten-minute orientation, every room with its route, the pipeline, how a change ships.
- `docs/INVENTORY.md`: every document in the repo with a status.
- `docs/runbooks/`: deploy, apply a migration by hand, rotate a secret, local dev, GDPR erasure rollout.
- `docs/V4_GLOSSARY.md` and `docs/BRAND_VOICE.md`: the words and the voice.
- `docs/GDPR_DATA_PROTECTION.md`, `docs/threat_model.md`: data protection and security posture.
- `CHANGELOG.md`: merged pull requests by date.

## Contributing

Branch from `origin/main`, keep a pull request to one concern, write the title in plain words that say what changed for a reader ("fix(reader): the deck opens without a blank wait"). Every string a learner sees comes from `src/i18n/locales/{en,de}/` and follows the glossary; `npm run lint` enforces both.

## Operator

The repository has no license file; all rights stay with the operator named in the [Impressum](https://learnstation.app/impressum).
