# The event table in production versus the repository

Cited by chapter 5, section 5.2 ("Storage").

**Method.** One read-only query on the production system catalogue, November
2026, inside `BEGIN READ ONLY … ROLLBACK` with `default_transaction_read_only=on`.
Only catalogue metadata was read, no rows of the table. An earlier read-only
probe in the same month found the same.

```sql
SELECT c.relkind,
       (SELECT count(*) FROM pg_inherits i WHERE i.inhparent = c.oid) AS partitions,
       (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='learning_events') AS indexes,
       (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'learning_events_rollup%') AS rollup_tables
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'learning_events';
```

| | repository (migration `20260721010000`) | production |
|---|---|---|
| table kind | partitioned by month (`PARTITION BY RANGE (created_at)`, line 106) with a default partition (line 122) | plain table (`relkind = r`) |
| partitions | default plus monthly | 0 |
| indexes | four declared (lines 188–197) plus the key | 3 in all |
| daily roll-up table | `learning_events_rollup` (from line 363) | none |

**Retention.** `backend/scripts/learning_events_retention.py` archives old
partitions into the roll-up table and then drops them, and only when both
`LEARNING_EVENTS_RETENTION_DAYS` (default 0, which disables it) and
`LEARNING_EVENTS_RETENTION_EXECUTE` are set. No scheduler runs it: the worker's
`cron_jobs` (`arq_worker.py:329–339` at the pin) hold the overview refresh,
the stalled-run sweep, erasure draining and the optional nudge job, and
`docker-compose.prod.yml` has no service for it. Production has neither the
partitions it drops nor the roll-up table it fills, so it has never run there.
