# Rotate a secret

*Where each secret lives and what has to happen after it changes. Verified against `backend/core/config.py`, `docker-compose.prod.yml`, `Dockerfile.frontend` and `.env.example` on 2026-10-30; server paths from the deploy sessions.*

## Where secrets live

| Secret | Local | Prod | Read by |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_KEY`, `SUPABASE_URL` | `backend/.env` first, then root `.env` (`backend/core/config.py`) | `/root/ascend-academy/.env` (compose `env_file`) | api, worker |
| LLM keys: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY` | same | same | api, worker (`backend/services/ai/orchestrator.py`) |
| `REDIS_PASSWORD` | root `.env` | server `.env` | compose builds the Redis URLs from it |
| `DATABASE_URL` | root `.env` (pooler, 6543) | not on the server; used from a laptop for migrations and dumps | psql, pg_dump |
| `SENTRY_DSN`, `VITE_SENTRY_DSN` | optional | unset on the server as of 2026-10-30 | api; frontend at build |
| `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL` | root `.env` | server `.env`, baked into the bundle at build (`Dockerfile.frontend` ARGs) | the browser; this is the public anon key, not a secret |
| `NUDGE_RUN_SECRET` | root `.env` | server `.env` | the nudge cron route |
| Resend API key (auth email SMTP) | nowhere in the repo | Supabase dashboard → Authentication → Emails → SMTP | Supabase Auth |
| Supabase Auth site URL and redirect URLs | nowhere in the repo | Supabase dashboard → Authentication → URL Configuration | Supabase Auth |
| Admin and professor account passwords | nowhere; rotated by Abi 2026-10-30 | Supabase Auth | people |
| SSH key for the server | `~/.ssh/id_ed25519` | `abo@` and `root@` on 195.201.221.137 | you |
| Better Stack heartbeat URLs | nowhere in the repo | `/etc/learnstation-heartbeat.conf` (600 root) | heartbeat timer, `db-backup.service` |
| R2 access key (`learnstation-server-backups`) | nowhere in the repo | `/etc/offsite-backup.conf` (600 root) | `offsite-backup.sh` |
| Backup decryption key (age) | Abi's password manager only | never on the server; the server holds only the public half | whoever restores |

Two env files locally: the API reads `backend/.env` before root `.env`. To know which value is live, introspect the running app, not a file.

## Rotate a backend key (LLM, service role, Redis)

1. Create the new key at the provider. For the service role key, Supabase dashboard → Project Settings → API → rotate; the old one stops working at once, so do the next step immediately.
2. On the server, edit `/root/ascend-academy/.env` in the SSH session (do not scp a laptop `.env` over it; it has local-only values). Keep a dated copy first: `cp .env .env.bak-<date>`.
3. Recreate the containers that read it. No rebuild is needed for backend values:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps api worker
   ```
   `REDIS_PASSWORD` also needs `redis` and `redis-queue` recreated, which drops the queue; do it when no parse is running.
4. Verify: `/health/ready` all ok; for an LLM key, open a Lesson and ask Luna one thing; for the service role key, run one account export from Settings.
5. Revoke the old key at the provider. Update the laptop `.env` files last.

## Rotate a frontend value (`VITE_*`)

Edit the server `.env`, then rebuild and swap the frontend only (`docs/runbooks/deploy-main-to-prod.md`, frontend-only variant). A restart does nothing; the value is in the bundle.

## Rotate an account password

The dashboard cannot set a password and `@admin.com` addresses receive no mail. Use the Admin API with the service role key: `auth.admin.update_user_by_id(user_id, {"password": ...})` from a throwaway script that takes the password as an argument. Never commit a script with a password in it (PR #134 removed the last one). Seed scripts never reset an existing user.

## Rotate the monitoring and backup secrets

Re-run the matching installer; it asks for the new values and overwrites the config (`docs/runbooks/monitoring-and-backups.md`). For the R2 key, create the new token first, install, then delete the old token in Cloudflare. A new age key pair cannot read copies made with the old one, so keep the old private key until those copies are deleted (30 days).

## If a secret reached git

The repo is public. Rotate first, then record the fingerprint in `.gitleaksignore` with a note that the value is dead; history is not rewritten. `docs/SECRETS_AUDIT.md` has the precedent.
