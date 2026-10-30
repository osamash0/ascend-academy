# Apply a migration to prod by hand

*Never run `supabase db push` against prod. The migration ledger (`supabase_migrations.schema_migrations`) holds 2 rows for 136 files because migrations were applied through the dashboard and psql for a year. `db push` would try to replay them all. The lint in CI (`backend/scripts/check_migration_timestamps.py`) stops duplicate timestamps, which once shadowed a real migration.*

## Rules

1. One migration per pull request. The PR merges first; the migration is applied before the code that needs it is deployed.
2. Apply in one transaction with `ON_ERROR_STOP`, from the file on `origin/main`, never from a worktree copy.
3. Verify with `pg_catalog`, not with the ledger. The ledger does not know what was applied.
4. Snapshot first if the migration touches data or drops anything: `/usr/local/bin/db-backup.sh` on the server, or locally `pg_dump` on port 5432 (6543 is the transaction pooler and produces a broken dump).

## The sequence

```bash
set -a; source .env; set +a                     # DATABASE_URL = the pooler, port 6543; fine for psql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/<timestamp>_<name>.sql
```

If you have the Supabase CLI (`~/.local/bin/supabase`, not brew), `supabase migration list --db-url "$DATABASE_URL"` shows the ledger, which is the wrong place to look. Use it only to confirm the CLI can connect.

## Verify

Pick the probe that matches what the migration did:

```sql
-- a table
SELECT to_regclass('public.<table>');
-- a column
SELECT column_name FROM information_schema.columns WHERE table_name='<table>' AND column_name='<col>';
-- a function and who may run it (anon must not run SECURITY DEFINER functions)
SELECT proname, prosecdef FROM pg_proc WHERE proname='<fn>';
SELECT has_function_privilege('anon','public.<fn>(<argtypes>)','EXECUTE');
-- a policy
SELECT policyname, cmd, roles FROM pg_policies WHERE tablename='<table>';
-- a grant on a table
SELECT has_table_privilege('anon','public.<table>','SELECT');
```

Write what you verified into the pull request that carried the migration, with the date.

## Things that bit before

- `REVOKE ... FROM PUBLIC` does not remove Supabase's direct grant to `anon`. Revoke from `anon` and `authenticated` by name (migration `20261011000000` is the pattern).
- An `AFTER` trigger on a table in the erasure cascade runs as `supabase_auth_admin` when Auth deletes a user. Such trigger functions must be `SECURITY DEFINER` (migration `20261026000000`), or every account deletion fails with "Database error deleting user".
- Prod has no `CHECK` on `learning_events.event_type` and the table is not partitioned, although a migration on `main` says otherwise. Do not assume a constraint exists because a file does; probe.
- Restoring a dump into a vanilla Postgres needs the `extensions` schema created first, or every `uuid_generate_v4()` default silently fails and rows vanish.
