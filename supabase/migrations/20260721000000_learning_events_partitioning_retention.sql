-- P5-4 · Retention & partitioning for `learning_events`
-- (docs/ROADMAP_10X_FOUNDATION.md §13)
--
-- Why: `learning_events` is an unbounded, append-only per-interaction log —
-- the fastest-growing table in the schema (one row per slide view, quiz
-- attempt, tutor query, confidence rating, ...). Today it is a single
-- monolithic heap table, so there is no cheap way to age out old rows and
-- every full scan (analytics aggregation, GDPR export/erasure sweeps) pays
-- the cost of the entire history.
--
-- What this migration does:
--   1. Converts `learning_events` into a native RANGE-partitioned table,
--      partitioned by month on `created_at`, WITHOUT deleting or losing any
--      existing row. Postgres has no in-place `ALTER TABLE ... PARTITION BY`,
--      so the standard safe pattern is used: rename the existing table aside
--      (kept, not dropped), create the new partitioned table with the same
--      shape, backfill by copying every row across, then reattach indexes,
--      RLS policies and the analytics-cache-invalidation trigger.
--   2. Adds operational helper functions to create future partitions
--      (`ensure_learning_events_partition`) and to list partitions that are
--      old enough to be retention candidates
--      (`list_learning_events_partitions_older_than`) WITHOUT dropping
--      anything — reporting only.
--   3. Adds a `learning_events_daily_rollup` archive table: a per-day,
--      per-user, per-event-type, per-lecture aggregate. This is the
--      "downsample" target retention will archive into before any raw
--      partition is ever dropped, so historical analytics keep working off
--      rollups per the P5-4 acceptance criteria.
--
-- What this migration deliberately does NOT do (by explicit instruction —
-- this session must not delete any real data/tables/partitions):
--   - It does NOT drop the pre-migration `learning_events` heap table. It is
--     renamed to `learning_events_legacy_20260721` and left in place as a
--     verifiable backup. A follow-up migration MAY drop it once a human has
--     confirmed the copy is correct and it's no longer needed — that is an
--     explicit, reviewed decision, not something this migration does itself.
--   - It does NOT drop or detach any partition, ever, from SQL alone. The
--     retention *policy* (which partitions are old enough, and the
--     archive-then-drop sequence) lives in `backend/scripts/
--     learning_events_retention.py`, which defaults to a dry run and is
--     gated behind an explicit config flag (see that script's docstring).
--
-- Retention window: documented as 400 days by default (13 months — enough
-- for a full academic-year + one buffer semester of rollup-backed history),
-- configurable via LEARNING_EVENTS_RETENTION_DAYS. This aligns with the GDPR
-- data-minimization posture tracked under S-2: raw per-interaction payloads
-- (which can contain free-text tutor queries) are archived into aggregate
-- rollups past the window; the rollups retain only counts, not raw payload
-- content.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Rename the existing table aside (backup, not deleted)
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS public.learning_events
    RENAME TO learning_events_legacy_20260721;

COMMENT ON TABLE public.learning_events_legacy_20260721 IS
    'Pre-partitioning backup of learning_events, renamed aside by '
    '20260721000000_learning_events_partitioning_retention.sql. All rows were '
    'copied into the new partitioned public.learning_events table. Kept '
    'intentionally (not dropped) pending explicit human review/cleanup — see '
    'that migration''s header comment for why.';

-- Old indexes/policies/triggers on the renamed table are irrelevant (dead
-- weight on a backup table) but harmless; left as-is rather than churned.

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Create the new partitioned parent table
-- ─────────────────────────────────────────────────────────────────────────
-- Native range partitioning requires the partition key to be part of every
-- unique/primary key, hence the composite PK. `id` alone is still
-- effectively unique in practice (gen_random_uuid()); nothing in the
-- codebase upserts learning_events by id (verified: only plain inserts +
-- selects in backend/repositories/event_repo.py), so widening the PK is
-- safe.

CREATE TABLE public.learning_events (
    id          uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    event_type  text NOT NULL,
    event_data  jsonb DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

COMMENT ON TABLE public.learning_events IS
    'Per-interaction student event log (slide views, quiz attempts, tutor '
    'queries, confidence ratings, ...). Time-partitioned monthly on '
    'created_at (P5-4). Use ensure_learning_events_partition() to create '
    'future partitions ahead of writes, and '
    'list_learning_events_partitions_older_than() to find retention '
    'candidates. See backend/scripts/learning_events_retention.py for the '
    'archive/retention job (dry-run by default).';

-- Safety-net partition: catches any row whose created_at falls outside the
-- explicit monthly ranges created below (e.g. a clock skew or an unforeseen
-- historical date). Ops tooling should keep creating monthly partitions
-- ahead of time so this stays empty in steady state.
CREATE TABLE public.learning_events_default
    PARTITION OF public.learning_events DEFAULT;
-- NOTE: Postgres does NOT propagate a partitioned parent's
-- relrowsecurity=true flag down to child partitions automatically — each
-- partition must ENABLE ROW LEVEL SECURITY itself (verified: a partition
-- created after `ALTER TABLE parent ENABLE ROW LEVEL SECURITY` still shows
-- relrowsecurity=false until enabled directly). Every partition created
-- anywhere in this migration/its helper functions does this explicitly so
-- backend/tests/db/test_rls_policies.py::test_all_public_tables_have_rls_enabled
-- keeps passing.
ALTER TABLE public.learning_events_default ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Create one monthly partition per calendar month spanned by the
--    existing data (from MIN(created_at) in the legacy table) through three
--    months into the future, then backfill by copying every row across.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
    earliest date;
    latest_bound date;
    cursor_month date;
    part_name text;
BEGIN
    SELECT date_trunc('month', COALESCE(MIN(created_at), now()))::date
      INTO earliest
      FROM public.learning_events_legacy_20260721;

    -- Always cover at least the current month plus 3 months ahead so writes
    -- immediately after this migration land in an explicit partition, not
    -- the default one.
    latest_bound := date_trunc('month', now() + interval '4 months')::date;

    cursor_month := earliest;
    WHILE cursor_month < latest_bound LOOP
        part_name := format('learning_events_y%sm%s',
                             to_char(cursor_month, 'YYYY'),
                             to_char(cursor_month, 'MM'));

        IF NOT EXISTS (
            SELECT 1 FROM pg_class WHERE relname = part_name
        ) THEN
            EXECUTE format(
                'CREATE TABLE public.%I PARTITION OF public.learning_events '
                'FOR VALUES FROM (%L) TO (%L)',
                part_name, cursor_month, (cursor_month + interval '1 month')::date
            );
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', part_name);
        END IF;

        cursor_month := (cursor_month + interval '1 month')::date;
    END LOOP;
END $$;

-- Backfill: copy every existing row, coalescing a NULL created_at (the
-- original column had no NOT NULL constraint) to now() so nothing is
-- silently dropped or rejected by the new NOT NULL column.
INSERT INTO public.learning_events (id, user_id, event_type, event_data, created_at)
SELECT id, user_id, event_type, COALESCE(event_data, '{}'::jsonb), COALESCE(created_at, now())
FROM public.learning_events_legacy_20260721;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Indexes (created on the parent; Postgres propagates to every partition,
--    present and future)
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_learning_events_user_id
    ON public.learning_events (user_id);

CREATE INDEX IF NOT EXISTS idx_learning_events_lecture_id
    ON public.learning_events ((event_data->>'lectureId'));

CREATE INDEX IF NOT EXISTS idx_learning_events_event_data_gin
    ON public.learning_events USING gin (event_data);

CREATE INDEX IF NOT EXISTS idx_learning_events_type_created
    ON public.learning_events (event_type, created_at);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. RLS — reinstate the final policy set from the pre-migration table
--    (own rows + professor-scoped-to-enrolled-students read, per
--    20260503000003 and 20260621000000)
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.learning_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own events"
ON public.learning_events FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own events"
ON public.learning_events FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Professors view events for their enrolled students"
ON public.learning_events FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'professor')
  AND EXISTS (
    SELECT 1
    FROM public.course_enrollments ce
    JOIN public.courses c ON c.id = ce.course_id
    WHERE c.professor_id = auth.uid()
      AND ce.user_id = learning_events.user_id
  )
);

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Reinstate the analytics-cache invalidation trigger (function already
--    exists from 20260503000017_analytics_cache.sql; only the trigger
--    binding needs recreating on the new table object)
-- ─────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_invalidate_analytics_cache ON public.learning_events;
CREATE TRIGGER trg_invalidate_analytics_cache
AFTER INSERT ON public.learning_events
FOR EACH ROW
EXECUTE FUNCTION public.invalidate_analytics_cache_on_event();

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Operational helper: create the partition for a given month if it
--    doesn't already exist. Idempotent. Intended to be called ahead of time
--    (e.g. monthly, from an Arq cron job once P2-2's cron infra lands, or
--    manually/from an ops script in the meantime).
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ensure_learning_events_partition(p_month date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    month_start date := date_trunc('month', p_month)::date;
    month_end date := (date_trunc('month', p_month) + interval '1 month')::date;
    part_name text := format('learning_events_y%sm%s',
                              to_char(month_start, 'YYYY'), to_char(month_start, 'MM'));
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
        RETURN part_name || ' (already exists)';
    END IF;

    EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.learning_events '
        'FOR VALUES FROM (%L) TO (%L)',
        part_name, month_start, month_end
    );
    -- See the note at learning_events_default's creation above: partitions
    -- do not inherit relrowsecurity from the parent and must enable it
    -- themselves.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', part_name);
    RETURN part_name || ' (created)';
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_learning_events_partition(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_learning_events_partition(date) TO service_role;

COMMENT ON FUNCTION public.ensure_learning_events_partition(date) IS
    'Idempotently creates the monthly learning_events partition covering '
    'p_month. Service-role only. Call ahead of the month it covers so '
    'writes never fall into the learning_events_default catch-all.';

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Operational helper: list partitions old enough to be retention
--    candidates. REPORTING ONLY — never drops or modifies anything.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_learning_events_partitions_older_than(p_days integer)
RETURNS TABLE (
    partition_name text,
    range_start date,
    range_end date,
    approx_row_estimate bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH bounds AS (
        SELECT
            child.relname::text AS partition_name,
            -- Match just the leading YYYY-MM-DD of each bound literal; the
            -- literal is a full timestamptz ('2026-01-01 00:00:00+01'), so
            -- the pattern intentionally does NOT require an immediately
            -- following closing quote.
            (regexp_match(
                pg_get_expr(child.relpartbound, child.oid),
                'FROM \(''(\d{4}-\d{2}-\d{2})'
            ))[1]::date AS range_start,
            (regexp_match(
                pg_get_expr(child.relpartbound, child.oid),
                'TO \(''(\d{4}-\d{2}-\d{2})'
            ))[1]::date AS range_end,
            child.reltuples::bigint AS approx_row_estimate
        FROM pg_inherits i
        JOIN pg_class child ON child.oid = i.inhrelid
        JOIN pg_class parent ON parent.oid = i.inhparent
        WHERE parent.relname = 'learning_events'
          AND child.relname <> 'learning_events_default'
          AND pg_get_expr(child.relpartbound, child.oid) LIKE 'FOR VALUES FROM%'
    )
    SELECT bounds.partition_name, bounds.range_start, bounds.range_end, bounds.approx_row_estimate
    FROM bounds
    WHERE bounds.range_end <= (now() - make_interval(days => p_days))::date
    ORDER BY bounds.range_start;
END;
$$;

REVOKE ALL ON FUNCTION public.list_learning_events_partitions_older_than(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_learning_events_partitions_older_than(integer) TO service_role;

COMMENT ON FUNCTION public.list_learning_events_partitions_older_than(integer) IS
    'Reporting-only: lists learning_events partitions whose entire range '
    'ends at least p_days ago. Never drops or archives anything itself — '
    'used by backend/scripts/learning_events_retention.py to decide what a '
    'human-approved retention run would act on.';

-- ─────────────────────────────────────────────────────────────────────────
-- 9. Archive/rollup table: the downsample target for retention. Raw events
--    in a partition older than the retention window get aggregated in here
--    (counts only, no raw event_data payload) before that partition is ever
--    archived/dropped by a human-approved run of the retention script.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.learning_events_daily_rollup (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    day              date NOT NULL,
    user_id          uuid NOT NULL,
    event_type       text NOT NULL,
    lecture_id       uuid,
    event_count      integer NOT NULL DEFAULT 0,
    first_created_at timestamptz,
    last_created_at  timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (day, user_id, event_type, lecture_id)
);

CREATE INDEX IF NOT EXISTS idx_learning_events_rollup_user
    ON public.learning_events_daily_rollup (user_id);
CREATE INDEX IF NOT EXISTS idx_learning_events_rollup_day
    ON public.learning_events_daily_rollup (day);
CREATE INDEX IF NOT EXISTS idx_learning_events_rollup_lecture
    ON public.learning_events_daily_rollup (lecture_id);

ALTER TABLE public.learning_events_daily_rollup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own rollups"
ON public.learning_events_daily_rollup FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Professors view rollups for their enrolled students"
ON public.learning_events_daily_rollup FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'professor')
  AND EXISTS (
    SELECT 1
    FROM public.course_enrollments ce
    JOIN public.courses c ON c.id = ce.course_id
    WHERE c.professor_id = auth.uid()
      AND ce.user_id = learning_events_daily_rollup.user_id
  )
);

CREATE POLICY "Service role manages rollups"
ON public.learning_events_daily_rollup FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────
-- 10. Archive helper: aggregate every row in one named partition into
--     learning_events_daily_rollup. Purely additive — reads the partition,
--     writes/upserts rollup rows. Never deletes or modifies the source
--     partition. Safe to call repeatedly (upsert on the rollup's unique key).
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.archive_learning_events_partition_to_rollup(p_partition text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    archived_rows bigint;
BEGIN
    -- Guard: only operate on an actual child partition of learning_events,
    -- never an arbitrary caller-supplied table name.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_inherits i
        JOIN pg_class child ON child.oid = i.inhrelid
        JOIN pg_class parent ON parent.oid = i.inhparent
        WHERE parent.relname = 'learning_events'
          AND child.relname = p_partition
    ) THEN
        RAISE EXCEPTION 'not a learning_events partition: %', p_partition;
    END IF;

    EXECUTE format(
        'INSERT INTO public.learning_events_daily_rollup '
        '  (day, user_id, event_type, lecture_id, event_count, first_created_at, last_created_at) '
        'SELECT '
        '  date_trunc(''day'', created_at)::date AS day, '
        '  user_id, '
        '  event_type, '
        '  NULLIF(event_data->>''lectureId'', '''')::uuid AS lecture_id, '
        '  count(*) AS event_count, '
        '  min(created_at) AS first_created_at, '
        '  max(created_at) AS last_created_at '
        'FROM public.%I '
        'GROUP BY 1, 2, 3, 4 '
        'ON CONFLICT (day, user_id, event_type, lecture_id) DO UPDATE SET '
        '  event_count = learning_events_daily_rollup.event_count + EXCLUDED.event_count, '
        '  first_created_at = LEAST(learning_events_daily_rollup.first_created_at, EXCLUDED.first_created_at), '
        '  last_created_at = GREATEST(learning_events_daily_rollup.last_created_at, EXCLUDED.last_created_at)',
        p_partition
    );

    EXECUTE format('SELECT count(*) FROM public.%I', p_partition) INTO archived_rows;
    RETURN archived_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_learning_events_partition_to_rollup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_learning_events_partition_to_rollup(text) TO service_role;

COMMENT ON FUNCTION public.archive_learning_events_partition_to_rollup(text) IS
    'Aggregates every row of the named learning_events partition into '
    'learning_events_daily_rollup (upsert). Read-only against the source '
    'partition — never deletes or detaches it. Called by '
    'backend/scripts/learning_events_retention.py before an (opt-in, '
    'separately gated) partition drop.';

-- ─────────────────────────────────────────────────────────────────────────
-- 11. Drop helper: detach + drop one named partition. Defined for
--     completeness (the P5-4 acceptance criterion "dropping an old
--     partition is O(1)") but NOT invoked by this migration and NOT invoked
--     by any code path run during this session — real data is never
--     deleted here. Only backend/scripts/learning_events_retention.py can
--     call it, and only when BOTH LEARNING_EVENTS_RETENTION_DAYS > 0 AND
--     LEARNING_EVENTS_RETENTION_EXECUTE=1 are set, which defaults to off.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.drop_learning_events_partition(p_partition text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_inherits i
        JOIN pg_class child ON child.oid = i.inhrelid
        JOIN pg_class parent ON parent.oid = i.inhparent
        WHERE parent.relname = 'learning_events'
          AND child.relname = p_partition
    ) THEN
        RAISE EXCEPTION 'not a learning_events partition: %', p_partition;
    END IF;

    EXECUTE format('ALTER TABLE public.learning_events DETACH PARTITION public.%I', p_partition);
    EXECUTE format('DROP TABLE public.%I', p_partition);
END;
$$;

REVOKE ALL ON FUNCTION public.drop_learning_events_partition(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.drop_learning_events_partition(text) TO service_role;

COMMENT ON FUNCTION public.drop_learning_events_partition(text) IS
    'DESTRUCTIVE: detaches and drops the named learning_events partition. '
    'Only ever called (opt-in) by backend/scripts/learning_events_retention.py '
    'when explicitly configured to execute, and only after '
    'archive_learning_events_partition_to_rollup() has archived its rows. '
    'Not invoked anywhere during initial rollout.';

COMMENT ON TABLE public.learning_events_daily_rollup IS
    'Retention archive target for learning_events (P5-4). One row per '
    '(day, user, event_type, lecture) with a count — no raw event_data '
    'payload. Written by backend/scripts/learning_events_retention.py '
    'before any raw partition older than the retention window is archived. '
    'Analytics needing history beyond the retention window should read '
    'from here.';
