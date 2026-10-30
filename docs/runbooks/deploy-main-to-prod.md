# Deploy main to prod

*Manual, over SSH. There is no deploy automation: `.github/workflows/` has only `ci.yml` and the Makefile has no deploy target. This is the sequence used for the full deploy of 2026-10-30 15:24 UTC. Facts about the server come from that session; the repo cannot verify them.*

## Production address and auth (2026-10-30)

- Canonical address: **https://learnstation.app**. `www.learnstation.app`, `learnstation.duckdns.org` and `195-201-221-137.sslip.io` return 301 redirects to the apex, preserving paths and queries. Users sign in once at the new address because sessions are stored per site address.
- Cloudflare serves DNS only: apex A and www CNAME must remain **DNS only** (grey cloud). Host nginx terminates Let's Encrypt TLS and proxies the app to `127.0.0.1:3000`. Keep the old hosts' certificates for their HTTPS redirects.
- Apex nginx site: `/etc/nginx/sites-available/learnstation.app`. Legacy redirect sites: `ascend-academy` and `195-201-221-137.sslip.io` in the same directory. Back up a file before editing it; run `nginx -t` before `systemctl reload nginx`. Renewal check: `certbot renew --dry-run --non-interactive --no-random-sleep-on-renew`.
- `CORS_ALLOWED_ORIGINS` in the server's root `.env` includes `https://learnstation.app` plus both previous origins. Supabase Auth Site URL is `https://learnstation.app`; Redirect URLs include `https://learnstation.app/**` and retain both previous entries.
- Recovery emails currently use `{{ .ConfirmationURL }}`. The token-hash reset page is merged (PR #160) but **not deployed** as of 2026-10-30 evening; switch the Supabase Reset Password template to `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery` only after a frontend deploy that contains #160, then send yourself one reset email to check. Resend receiving, open tracking and click tracking stay off.

See the [migration log](../ops/2026-10-30-learnstation-app-move.md) for verification, backup paths and rollback details. Historical audits keep the addresses they tested.

## Before you start

1. `main` is green on GitHub and the commit you deploy is `origin/main` (local `main` can be stale).
2. Every migration the commit needs is already applied to prod: `docs/runbooks/apply-a-migration-by-hand.md`. Code that writes to a table that does not exist yet returns 502 on that route; it never corrupts data, but it breaks the feature.
3. Check whether `docker-compose.prod.yml`, either Dockerfile, `requirements*.txt` or `package-lock.json` changed since the last deploy. If so, expect a longer build and a possible OOM on the 4 GB box; the frontend build has a 4 GB swapfile for this.
4. New backend settings (`backend/core/config.py`) need a value in the server's `.env` before the swap, or they fall back to their default. Flags default to off.

## The sequence

```bash
ssh abo@195.201.221.137            # key auth; abo is in the docker group. root@ works with the same key.
sudo -i                            # /root is mode 700
cd /root/ascend-academy

# 1. Rollback point first. The tag is the only way back without a rebuild.
for s in api worker frontend; do
  docker tag ascend-academy-prod-$s:latest ascend-academy-prod-$s:pre-deploy-main-$(date -u +%Y%m%d)
done

# 2. Database snapshot (the free tier has no PITR). Session-mode pooler, port 5432, never 6543.
/usr/local/bin/db-backup.sh        # the nightly script; writes to /var/backups/learnstation/db/

# 3. Fetch the exact commit.
git fetch origin main && git checkout -B main origin/main && git log --oneline -1

# 4. Build BEFORE swapping. The site stays up while this runs (2 to 4 minutes for the frontend).
docker compose -f docker-compose.prod.yml build api worker frontend

# 5. Swap. --no-deps leaves redis and redis-queue untouched.
docker compose -f docker-compose.prod.yml up -d --no-deps api worker frontend
```

For a backend-only or frontend-only change, name only those services in steps 1, 4 and 5. A frontend change always needs a rebuild: every `VITE_*` value is baked into the bundle at build time from the server's `.env` (see the `args:` of the `frontend` service).

## Verify

```bash
docker compose -f docker-compose.prod.yml exec api curl -s localhost:8000/health/ready   # nginx proxies only /api/; database, redis_cache, redis_queue all "ok"
curl -fsS https://learnstation.app/ | grep -oE 'index-[A-Za-z0-9_-]+\.js'   # the hash changes on every rebuild; TLS verification stays on
docker compose -f docker-compose.prod.yml logs --since 5m api worker | grep -iE "error|traceback" | head
docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedAt}}' | grep ascend-academy-prod   # UTC; commits are +0200
```

Then open the app as a learner: sign in, open a Space, open a Lesson, read two pages, see one face arrive. Mark the verified punch-list items.

## Roll back

```bash
for s in api worker frontend; do
  docker tag ascend-academy-prod-$s:pre-deploy-main-<date> ascend-academy-prod-$s:latest
done
docker compose -f docker-compose.prod.yml up -d --no-deps api worker frontend
```

A migration is not rolled back by this. Write a down migration by hand if the data shape must go back.

## Things that bit before

- The server checkout and the running images can differ. Trust image build dates, not `git log`.
- Disk: the box had a disk-full outage once. `docker system df` and `docker image prune` if free space is under 10 GB.
- Flags on since 2026-10-29: `FEATURE_V4=1`, `FEATURE_V4_READER=1`, `FEATURE_LUNA_SESSIONS=1`; the compose file derives each `VITE_FEATURE_*` from them. `.env.bak-pre-v4-20261029` is the pre-flag copy.
- LiteLLM is gone; providers are called direct from `backend/services/ai/orchestrator.py`.
