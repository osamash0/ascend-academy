-- Roadmap Foundation-10x, Phase 5, P5-4: retention & partitioning for
-- learning_events (docs/ROADMAP_10X_FOUNDATION.md §13, tied to the GDPR
-- posture in §14 S-2).
--
-- PROBLEM: learning_events is an unbounded per-interaction log (one row per
-- slide view / quiz attempt / confidence rating / AI query). It grows
-- forever, old raw rows have low analytical value relative to their
-- storage + sequential-scan cost, and GDPR wants a bounded retention
-- window for raw personal-activity logs.
--
-- FIX: convert learning_events to a natively time-partitioned table
-- (PARTITION BY RANGE (created_at)) with one partition per calendar month,
-- plus two maintenance functions: one to create partitions ahead of time,
-- one to drop partitions past a retention cutoff. Dropping a partition is
-- `DROP TABLE` — O(1) relative to table size, unlike a row-by-row DELETE
-- which has to scan + WAL-log + vacuum every matching row and bloats the
-- table/indexes it deletes from.
--
-- INTERVAL CHOICE — monthly, not daily/weekly/yearly:
--   * Access pattern (see 20260711030000_analytics_event_indexes.sql and
--     analytics_service.py) filters mostly by event_type + a JSONB
--     lectureId, windowed by created_at over "last 7 days" / "this course
--     term" style ranges — a handful of monthly partitions covers those
--     scans without partition-count blowup.
--   * Retention is granted in whole months anyway (see below), so a
--     retention sweep drops a clean set of partitions with no partial-month
--     leftovers to separately purge.
--   * Daily partitions for a single-node teaching-app volume would be
--     thousands of child tables over a few years for no pruning benefit;
--     yearly partitions are too coarse to ever drop cheaply once GDPR
--     erasure requests need a row removed from a "current" partition.
--
-- RETENTION WINDOW — 24 months (RECOMMENDATION, NOT a final legal
-- determination): raw learning_events keep 24 trailing months so a student
-- with a 2-semester (year-long) course history still has raw slide/quiz
-- telemetry available for that period; anything older is dropped by
-- partition-drop. This number is a starting point for the S-2 GDPR posture
-- work (docs/ROADMAP_10X_FOUNDATION.md §14) to confirm or override — it is
-- NOT itself the GDPR policy. The retention function below defaults to
-- this value but takes retention_months as a parameter so S-2 can change it
-- without another migration.
--
-- CAVEAT (acceptance criteria: "analytics that need history read
-- rollups"): dropping a raw-event partition permanently deletes those
-- rows. There is currently NO pre-computed rollup/aggregate table that
-- survives raw-event deletion (P5-2 "OLTP/OLAP split" / analytics
-- materialized views is a separate, not-yet-landed initiative — see
-- branch fix/p5-2-analytics-materialized-views, which at the time of this
-- migration has no commits beyond main). Until such a rollup exists,
-- drop_learning_events_partitions_older_than() must NOT be run against
-- production with dry_run := false, or multi-month/lifetime analytics
-- (dashboards, drop-off, distractor detection) silently lose history for
-- the dropped months. It defaults to dry_run := true for exactly this
-- reason — enabling real drops in prod is a follow-up decision gated on
-- P5-2 landing, not a decision this migration makes.
--
-- APPROACH FOR THIS EXISTING TABLE: learning_events already exists (created
-- unpartitioned in 20260122202809_...sql). Postgres cannot ALTER an
-- existing table into a partitioned one in place, so this migration does
-- the clean rename-recreate-backfill conversion: rename the old table,
-- create the new partitioned one with the same columns/RLS/policies/
-- indexes/trigger, copy the rows across (each row routes to the partition
-- matching its own created_at), then drop the old table. This is safe here
-- because this branch's migration chain has no live production data
-- dependent on it (per initiative brief); a cutover against a large,
-- already-populated production table should instead use a background
-- dual-write + swap strategy to avoid a long exclusive lock — that's a
-- separate concern from the technical mechanism being added here.

-- ── 1. Preserve existing rows + drop the dependent trigger/policies ────────
ALTER TABLE public.learning_events RENAME TO learning_events_pre_partition;

-- Constraints/indexes/trigger stay attached to the renamed table (renaming
-- a table does NOT rename its indexes/constraints — those are separate,
-- schema-wide-unique catalog objects). RLS policies also stay attached to
-- the renamed table; policy names are unique per table, so leaving them in
-- place would make the CREATE POLICY statements below fail on a fresh
-- migration run. Drop all policies from the current schema state explicitly
-- before recreating the new table's final policy set below. The renamed table
-- is dropped outright at the end of this migration anyway.
DROP TRIGGER IF EXISTS trg_invalidate_analytics_cache ON public.learning_events_pre_partition;
ALTER TABLE public.learning_events_pre_partition DROP CONSTRAINT IF EXISTS learning_events_pkey;
DROP POLICY IF EXISTS "Users can view their own events" ON public.learning_events_pre_partition;
DROP POLICY IF EXISTS "Users can insert their own events" ON public.learning_events_pre_partition;
DROP POLICY IF EXISTS "Professors can view all events" ON public.learning_events_pre_partition;
DROP POLICY IF EXISTS "Professors can view events for their lectures" ON public.learning_events_pre_partition;
DROP POLICY IF EXISTS "Professors view events for their enrolled students" ON public.learning_events_pre_partition;
DROP POLICY IF EXISTS "Admins view learning events" ON public.learning_events_pre_partition;
DROP POLICY IF EXISTS "Admins delete learning events" ON public.learning_events_pre_partition;
DROP INDEX IF EXISTS public.idx_learning_events_user_id;
DROP INDEX IF EXISTS public.idx_learning_events_event_data_gin;
DROP INDEX IF EXISTS public.idx_learning_events_type_created;
DROP INDEX IF EXISTS public.idx_learning_events_lecture_id;

-- ── 2. Create the partitioned table ─────────────────────────────────────────
-- Partitioned tables require the partition key in every unique/primary key,
-- so the PK becomes (id, created_at) instead of (id) alone. No other table
-- has a FK to learning_events.id (verified — grep of "REFERENCES ...
-- learning_events" across supabase/migrations/ returns nothing), so this is
-- safe.
CREATE TABLE public.learning_events (
    id          UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    event_type  TEXT NOT NULL,
    event_data  JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

COMMENT ON TABLE public.learning_events IS
    'Per-interaction student telemetry (slide views, quiz attempts, AI '
    'queries, confidence ratings). Time-partitioned monthly by created_at '
    '(Foundation-10x P5-4). Default recommended raw-event retention: 24 '
    'months, see drop_learning_events_partitions_older_than() — pending '
    'S-2 GDPR sign-off. Do NOT enable real partition drops until a rollup '
    '/ analytics-history table exists (P5-2); see migration header comment.';

ALTER TABLE public.learning_events ENABLE ROW LEVEL SECURITY;

-- Indexes on a partitioned parent automatically propagate to every
-- existing + future partition (Postgres 11+), so these are declared once.
CREATE INDEX idx_learning_events_user_id ON public.learning_events (user_id);
CREATE INDEX idx_learning_events_event_data_gin ON public.learning_events USING gin (event_data);
CREATE INDEX idx_learning_events_type_created ON public.learning_events (event_type, created_at);
CREATE INDEX idx_learning_events_lecture_id ON public.learning_events ((event_data ->> 'lectureId'));

-- Recreate the final live policy state. In particular, the June scoping
-- migration superseded the earlier lecture-id policy with enrollment-based
-- access, and the admin migration added read/delete policies.
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

CREATE POLICY "Admins view learning events"
ON public.learning_events FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete learning events"
ON public.learning_events FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Reuse the existing cache-invalidation function (defined in
-- 20260503000017_analytics_cache.sql) — only the trigger binding changes.
CREATE TRIGGER trg_invalidate_analytics_cache
AFTER INSERT ON public.learning_events
FOR EACH ROW
EXECUTE FUNCTION public.invalidate_analytics_cache_on_event();

-- ── 3. Partition-maintenance functions ──────────────────────────────────────

-- Creates (idempotently) the monthly partition that contains target_month.
-- Partition naming convention: learning_events_yYYYY_mMM — the retention
-- function below relies on this exact pattern to compute each partition's
-- month without having to parse pg_get_expr()'s partition-bound text.
CREATE OR REPLACE FUNCTION public.create_learning_events_partition_for_month(target_month date)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    month_start date := date_trunc('month', target_month)::date;
    month_end   date := (date_trunc('month', target_month) + interval '1 month')::date;
    part_name   text := format('learning_events_y%s_m%s',
                                to_char(month_start, 'YYYY'),
                                to_char(month_start, 'MM'));
BEGIN
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.learning_events
             FOR VALUES FROM (%L) TO (%L)',
        part_name, month_start, month_end
    );
    RETURN part_name;
END;
$$;

COMMENT ON FUNCTION public.create_learning_events_partition_for_month(date) IS
    'Idempotently creates the monthly learning_events partition covering '
    'target_month. Call ahead of the month it covers (e.g. from an Arq '
    'cron job once P2-2 lands, or manually via psql/an admin script) so '
    'inserts never fall through to the catch-all default partition.';

-- Ensures partitions exist for [months_back, months_ahead] months around
-- today. Convenience wrapper for bootstrapping / a single cron call.
CREATE OR REPLACE FUNCTION public.ensure_learning_events_partitions(
    months_back int DEFAULT 1,
    months_ahead int DEFAULT 3
)
RETURNS SETOF text
LANGUAGE plpgsql
AS $$
DECLARE
    i int;
BEGIN
    FOR i IN -months_back .. months_ahead LOOP
        RETURN NEXT public.create_learning_events_partition_for_month(
            (date_trunc('month', now()) + (i || ' months')::interval)::date
        );
    END LOOP;
END;
$$;

-- Drops every dedicated monthly partition whose entire date range is older
-- than retention_months trailing months (i.e. the partition's upper bound
-- <= the cutoff month start) — an O(1) DROP TABLE per partition, not a
-- row-by-row DELETE. The catch-all "default" partition is NEVER touched
-- here (it can hold rows outside any declared range and dropping it would
-- be unbounded/unsafe to reason about).
--
-- Defaults to dry_run := true: it reports which partitions WOULD be
-- dropped without dropping anything. Pass dry_run := false to actually
-- drop. See the migration header + table comment for why this must stay
-- dry-run in production until a rollup/analytics-history table exists
-- (P5-2) and the retention window has S-2 sign-off.
CREATE OR REPLACE FUNCTION public.drop_learning_events_partitions_older_than(
    retention_months int DEFAULT 24,
    dry_run boolean DEFAULT true
)
RETURNS TABLE(partition_name text, dropped boolean)
LANGUAGE plpgsql
AS $$
DECLARE
    cutoff date := (date_trunc('month', now()) - (retention_months || ' months')::interval)::date;
    child  record;
    part_year int;
    part_month int;
    part_end date;
BEGIN
    FOR child IN
        SELECT c.relname
        FROM pg_inherits i
        JOIN pg_class c ON c.oid = i.inhrelid
        JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = 'learning_events'
          AND c.relname ~ '^learning_events_y\d{4}_m\d{2}$'
    LOOP
        part_year := substring(child.relname FROM 'y(\d{4})')::int;
        part_month := substring(child.relname FROM 'm(\d{2})')::int;
        part_end := (make_date(part_year, part_month, 1) + interval '1 month')::date;

        IF part_end <= cutoff THEN
            IF NOT dry_run THEN
                EXECUTE format('DROP TABLE IF EXISTS public.%I', child.relname);
            END IF;
            partition_name := child.relname;
            dropped := NOT dry_run;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION public.drop_learning_events_partitions_older_than(int, boolean) IS
    'Retention sweep for learning_events. Default 24-month window is a '
    'starting recommendation pending the S-2 GDPR policy decision, not a '
    'final legal determination. Defaults to dry_run so calling it is safe; '
    'pass dry_run := false only once a rollup/history table exists so '
    'dropped raw events do not take analytics history with them.';

-- ── 4. Seed partitions + backfill existing rows ─────────────────────────────
CREATE TABLE public.learning_events_default PARTITION OF public.learning_events DEFAULT;

SELECT public.ensure_learning_events_partitions(months_back := 24, months_ahead := 3);

INSERT INTO public.learning_events (id, user_id, event_type, event_data, created_at)
SELECT id, user_id, event_type, event_data, created_at
FROM public.learning_events_pre_partition;

DROP TABLE public.learning_events_pre_partition;
