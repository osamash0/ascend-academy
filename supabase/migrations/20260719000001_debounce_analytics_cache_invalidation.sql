-- P2-4 (Foundation 10x roadmap): fix analytics-cache invalidation thrash.
--
-- Problem: `trg_invalidate_analytics_cache` (20260503000017_analytics_cache.sql)
-- fires AFTER INSERT PER ROW on `learning_events` and unconditionally does
-- `DELETE FROM analytics_cache WHERE lecture_id = lid`. `learning_events` is
-- the fastest-growing table (one row per slide view / quiz attempt /
-- ai_tutor_query / confidence_rating / …), so a lecture's entire cache is
-- wiped on EVERY student interaction — hit-rate collapses precisely when a
-- lecture is actively being studied, and the professor dashboard ends up
-- recomputing the same aggregates over and over.
--
-- Fix: debounce the delete itself. A tiny per-lecture timestamp table
-- (`analytics_cache_invalidation_debounce`) tracks the last time a lecture's
-- cache was actually invalidated. The trigger only performs the DELETE (and
-- bumps the timestamp) if more than `ANALYTICS_CACHE_DEBOUNCE_SECONDS`
-- has elapsed since the last invalidation for that lecture; otherwise it is
-- a no-op. This is a small, surgical change (no materialized-view rewrite —
-- that is explicitly a later lift, see roadmap P5-2) that keeps the cache
-- honest while bounding the DELETE rate to at most once per debounce
-- window per lecture, no matter how many events land in between.
--
-- Bounded staleness: during an actively-used lecture, the professor
-- dashboard's cached aggregates can be at most
-- ANALYTICS_CACHE_DEBOUNCE_SECONDS (15s) stale, since the trigger guarantees
-- a real cache-drop at least that often. That is strictly *tighter* than
-- the cache's own `ttl_seconds` (default 300s) already tolerates for an
-- idle lecture, so this never makes worst-case staleness worse — it only
-- stops the pathological "wiped on every single row" behavior for hot
-- lectures.
--
-- Also fixes the double key-spelling parse: the trigger used to try both
-- `event_data->>'lectureId'` and `event_data->>'lecture_id'`. Grepping the
-- actual writers of `learning_events` (frontend `logLearningEvent` in
-- src/services/studentService.ts, called from LectureView.tsx,
-- InlineLecturePlayer.tsx, LectureChat.tsx, MicroQuizCard.tsx — plus the
-- backend's own `event_repo.get_events_for_lecture` `.contains(...,
-- {"lectureId": ...})` query) shows the ONE spelling actually written today
-- is camelCase `lectureId`, not `lecture_id`. The snake_case branch was dead
-- weight (and a footgun: any accidental snake_case field named
-- `lecture_id` written by something else would previously have silently
-- also matched). Trigger now only parses `lectureId`.

-- ── Debounce state ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.analytics_cache_invalidation_debounce (
    lecture_id          uuid PRIMARY KEY,
    last_invalidated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.analytics_cache_invalidation_debounce IS
  'Per-lecture "last actually invalidated" timestamp used to debounce '
  'trg_invalidate_analytics_cache. Written only by that trigger function '
  '(SECURITY DEFINER); not intended for direct app reads/writes.';

ALTER TABLE public.analytics_cache_invalidation_debounce ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role all on analytics_cache_invalidation_debounce"
  ON public.analytics_cache_invalidation_debounce;
CREATE POLICY "Service role all on analytics_cache_invalidation_debounce"
  ON public.analytics_cache_invalidation_debounce
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Debounced invalidation trigger ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invalidate_analytics_cache_on_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    lid              uuid;
    did_invalidate   boolean;
BEGIN
    BEGIN
        lid := NULLIF(NEW.event_data->>'lectureId', '')::uuid;
    EXCEPTION WHEN others THEN
        lid := NULL;
    END;

    IF lid IS NULL THEN
        RETURN NEW;
    END IF;

    -- Atomic, race-safe debounce: try to bump the per-lecture timestamp,
    -- but only let the UPDATE branch of the upsert "win" (and thus report
    -- back via RETURNING) when the debounce window has actually elapsed.
    -- Concurrent inserts for the same lecture serialize on the row lock
    -- from ON CONFLICT, so at most one of them will ever see
    -- did_invalidate = true within a given window.
    did_invalidate := NULL;
    INSERT INTO public.analytics_cache_invalidation_debounce (lecture_id, last_invalidated_at)
    VALUES (lid, now())
    ON CONFLICT (lecture_id) DO UPDATE
        SET last_invalidated_at = now()
        WHERE public.analytics_cache_invalidation_debounce.last_invalidated_at
              <= now() - interval '15 seconds'
    RETURNING true INTO did_invalidate;

    IF did_invalidate THEN
        DELETE FROM public.analytics_cache WHERE lecture_id = lid;
    END IF;

    RETURN NEW;
END;
$$;

-- Trigger definition itself (target table/timing/level) is unchanged, but
-- re-create it defensively in case this migration is ever applied to a
-- database where it was dropped out of band.
DROP TRIGGER IF EXISTS trg_invalidate_analytics_cache ON public.learning_events;
CREATE TRIGGER trg_invalidate_analytics_cache
AFTER INSERT ON public.learning_events
FOR EACH ROW
EXECUTE FUNCTION public.invalidate_analytics_cache_on_event();

-- NOTE (deferred, out of this initiative's scope): `student_progress` and
-- the course-overview triggers (20260503000017_analytics_cache.sql:89-107,
-- 20260503000020_invalidate_course_overview_triggers.sql) also do
-- unconditional per-row DELETEs, but they fire on much lower-frequency
-- tables (one row per completion / per lecture-course mutation, not one
-- per slide view), so they were not the "fastest-growing table" thrash
-- source called out by roadmap P2-4. Left as-is; revisit only if profiling
-- shows them to be hot too.
