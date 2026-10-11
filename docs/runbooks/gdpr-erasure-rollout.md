# GDPR erasure rollout

Manual steps for Abi. Nothing here is automated; never run `supabase db push`
(the prod migration ledger is unreliable).

**Order matters.** The migration must be live BEFORE the new backend is
deployed: the delete endpoint writes `account_erasure_jobs`, and without the
table every account deletion returns 502 (safe: the account stays untouched).

1. Read-only coverage probe, right before deploying (expect "ok"; exit 1 means
   an export gap or a production user table missing from
   `erasure.NO_FK_USER_TABLES`, reported as "NOT ERASED"):
   `python -m backend.scripts.gdpr_coverage_probe "$DATABASE_URL"`
2. Apply the migration BY HAND, one transaction, only after Abi's go-ahead:
   `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/20261013000000_account_erasure_jobs.sql`
3. Verify: `SELECT has_table_privilege('anon','public.account_erasure_jobs','SELECT');` -- must be `f`
4. Deploy the backend and the worker together (the worker must see the new
   `drain_erasure_jobs_cron`, which runs every 10 minutes, unconditionally).
   The backend image needs `supabase>=2.27,<3.0` (requirements-docker.txt).
5. End to end on production, with a throwaway account Abi creates (one avatar,
   one uploaded PDF): delete it in Settings. The response is
   `{"message":"Account deleted.","files":"removed"}`, or `"finishing"` if the
   file removal is left to the retry. Then confirm
   - the avatar's public URL no longer serves the image,
   - its `lectures/{id}/` objects are gone from `lecture-pdfs` and `lecture-posters`,
   - `SELECT count(*) FROM account_erasure_jobs;` -- 0 within 10 minutes.
6. Watch worker logs for 24 hours:
   - "erasure job ... not finished": a retry is pending; harmless unless it persists.
   - "N erasure job(s) exceeded ... attempts; need a person" (`stuck` > 0):
     a human must look at the job's last error and finish it by hand.
