#!/bin/bash
# Post-merge setup for Learnstation.
# Runs automatically after a task is merged into main.
# Must be idempotent, non-interactive, and fail fast.
set -euo pipefail

echo "[post-merge] Installing frontend dependencies (npm)..."
# --legacy-peer-deps matches what the testing harness task documented:
# the project's existing peer-dep tree blocks a normal install.
# --no-audit / --no-fund keep the output quiet and the run fast.
npm install --legacy-peer-deps --no-audit --no-fund

echo "[post-merge] Installing backend dependencies (pip)..."
# --break-system-packages is required because Replit's NixOS Python is
# externally-managed (PEP 668); packages still go into the project-local
# .pythonlibs dir, not /nix/store.
# --upgrade lets new pinned versions in requirements.txt take effect;
# --quiet keeps logs short.
python -m pip install \
    --break-system-packages \
    --upgrade \
    --quiet \
    -r backend/requirements.txt

# ---------------------------------------------------------------------------
# Apply pending Supabase migrations.
#
# Tracked via a `public._post_merge_migrations` table so each .sql file is
# applied at most once, regardless of whether the file's own statements are
# idempotent. (Many of the older migrations have bare `CREATE POLICY` calls
# without a matching `DROP POLICY IF EXISTS` and would crash on re-run.)
#
# Gated on `SUPABASE_DB_URL` being set in the environment. That secret should
# hold the project's full Postgres connection URI (Project Settings →
# Database → Connection string). Without it we can't reach the live Supabase
# DB from a CI / post-merge context, so we skip with a loud warning instead
# of silently leaving the schema stale — task-28 was caused by exactly that
# silent skip.
# ---------------------------------------------------------------------------
MIGRATIONS_DIR="supabase/migrations"
if [[ -d "$MIGRATIONS_DIR" ]] && compgen -G "$MIGRATIONS_DIR/*.sql" > /dev/null; then
    if [[ -n "${SUPABASE_DB_URL:-}" ]]; then
        echo "[post-merge] Applying Supabase migrations from ${MIGRATIONS_DIR}..."

        # Bootstrap the tracking table on every run (idempotent).
        psql "$SUPABASE_DB_URL" --quiet --no-psqlrc -v ON_ERROR_STOP=1 -c "
            CREATE TABLE IF NOT EXISTS public._post_merge_migrations (
                filename    TEXT PRIMARY KEY,
                applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
            );
        " > /dev/null

        # Snapshot the already-applied set into a temp file.
        applied_list=$(mktemp)
        trap 'rm -f "$applied_list"' EXIT
        psql "$SUPABASE_DB_URL" --quiet --no-psqlrc -At \
            -c "SELECT filename FROM public._post_merge_migrations;" > "$applied_list"

        # Apply every migration file that isn't already in the tracker.
        # The tracker entry is only inserted *after* the file applies cleanly,
        # so a failing migration leaves the row absent and the next run will
        # retry it. We deliberately do NOT auto-seed the tracker — silently
        # marking files as applied without executing them was the bug that
        # let task-28's two pending migrations rot in the repo.
        applied=0
        skipped=0
        failed=0
        for f in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
            base=$(basename "$f")
            if grep -Fxq "$base" "$applied_list"; then
                skipped=$((skipped + 1))
                continue
            fi
            echo "[post-merge]   → $base"
            # `-1` runs the file as a single transaction so a partially-applied
            # migration rolls back cleanly. `ON_ERROR_STOP=1` halts on the
            # first failing statement.
            if psql "$SUPABASE_DB_URL" \
                    --quiet --no-psqlrc -1 -v ON_ERROR_STOP=1 -f "$f"; then
                psql "$SUPABASE_DB_URL" --quiet --no-psqlrc -v ON_ERROR_STOP=1 -c \
                    "INSERT INTO public._post_merge_migrations (filename) VALUES ('$base');" > /dev/null
                applied=$((applied + 1))
            else
                echo "[post-merge] ❌ Migration ${base} failed."
                echo "[post-merge]    If this file was already applied to this DB"
                echo "[post-merge]    out-of-band (Supabase Studio, manual psql, etc.),"
                echo "[post-merge]    mark it applied with:"
                echo "[post-merge]      INSERT INTO public._post_merge_migrations (filename)"
                echo "[post-merge]      VALUES ('${base}') ON CONFLICT DO NOTHING;"
                failed=$((failed + 1))
            fi
        done
        echo "[post-merge] Applied ${applied} new; skipped ${skipped}; failed ${failed}."

        # Verify required schema objects exist after the migration loop.
        # These are the objects task-28 fixed; if they're missing, the parse
        # pipeline will 500 on /check-duplicate and lose telemetry — fail
        # loudly here so the regression cannot recur silently.
        echo "[post-merge] Verifying critical schema objects…"
        verify_out=$(psql "$SUPABASE_DB_URL" --quiet --no-psqlrc -At -c "
            SELECT
              (SELECT to_regclass('public.lectures')          IS NOT NULL),
              (SELECT to_regclass('public.pipeline_run_metrics') IS NOT NULL),
              EXISTS (
                SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public'
                   AND table_name='lectures'
                   AND column_name='pdf_hash'
              );
        ")
        IFS='|' read -r has_lectures has_pipeline_metrics has_pdf_hash <<< "$verify_out"
        if [[ "$has_lectures" != "t" || "$has_pipeline_metrics" != "t" || "$has_pdf_hash" != "t" ]]; then
            echo "[post-merge] ❌ Schema verification failed:"
            echo "[post-merge]    public.lectures              present=${has_lectures}"
            echo "[post-merge]    public.pipeline_run_metrics  present=${has_pipeline_metrics}"
            echo "[post-merge]    lectures.pdf_hash column     present=${has_pdf_hash}"
            exit 1
        fi
        echo "[post-merge] ✓ Schema verification passed."

        if [[ "$failed" -gt 0 ]]; then
            exit 1
        fi
    else
        echo "[post-merge] ⚠️  SUPABASE_DB_URL is not set — skipping Supabase migrations."
        echo "[post-merge]    Set the secret to your project's Postgres URI"
        echo "[post-merge]    (Supabase Dashboard → Project Settings → Database → Connection string)"
        echo "[post-merge]    so future merges can apply pending migrations automatically."
    fi
fi

echo "[post-merge] Done."
