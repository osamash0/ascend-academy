-- Per-feature analytics cache.
-- Stores precomputed aggregate payloads for the professor analytics dashboard,
-- keyed by (lecture_id, view_name, params_hash). Invalidated whenever new
-- student events are written for the lecture, or via the manual refresh endpoint.

CREATE TABLE IF NOT EXISTS public.analytics_cache (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lecture_id   uuid NOT NULL,
    view_name    text NOT NULL,
    params_hash  text NOT NULL DEFAULT '_',
    payload      jsonb NOT NULL,
    computed_at  timestamptz NOT NULL DEFAULT now(),
    ttl_seconds  integer NOT NULL DEFAULT 300,
    UNIQUE (lecture_id, view_name, params_hash)
);

CREATE INDEX IF NOT EXISTS idx_analytics_cache_lecture ON public.analytics_cache(lecture_id);
CREATE INDEX IF NOT EXISTS idx_analytics_cache_computed_at ON public.analytics_cache(computed_at);

ALTER TABLE public.analytics_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role select on analytics_cache" ON public.analytics_cache;
DROP POLICY IF EXISTS "Service role insert on analytics_cache" ON public.analytics_cache;
DROP POLICY IF EXISTS "Service role update on analytics_cache" ON public.analytics_cache;
DROP POLICY IF EXISTS "Service role delete on analytics_cache" ON public.analytics_cache;

CREATE POLICY "Service role select on analytics_cache"
  ON public.analytics_cache FOR SELECT TO service_role USING (true);

CREATE POLICY "Service role insert on analytics_cache"
  ON public.analytics_cache FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "Service role update on analytics_cache"
  ON public.analytics_cache FOR UPDATE TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role delete on analytics_cache"
  ON public.analytics_cache FOR DELETE TO service_role USING (true);

COMMENT ON TABLE public.analytics_cache IS
  'Per-lecture analytics aggregate cache. Service-role only; invalidated on event writes.';

-- ── Invalidation trigger ─────────────────────────────────────────────────────
-- Most student events (slide_view, quiz_attempt, ai_tutor_query,
-- confidence_rating, …) are written to learning_events directly from the
-- browser, bypassing the backend. A small AFTER INSERT trigger keeps the
-- analytics cache honest by dropping every cached aggregate row for the
-- affected lecture as soon as a new event lands. Cheap: index lookup +
-- delete by lecture_id, no heavy work in the trigger body.

CREATE OR REPLACE FUNCTION public.invalidate_analytics_cache_on_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    lid uuid;
BEGIN
    BEGIN
        lid := NULLIF(NEW.event_data->>'lectureId', '')::uuid;
    EXCEPTION WHEN others THEN
        lid := NULL;
    END;

    IF lid IS NULL THEN
        BEGIN
            lid := NULLIF(NEW.event_data->>'lecture_id', '')::uuid;
        EXCEPTION WHEN others THEN
            lid := NULL;
        END;
    END IF;

    IF lid IS NOT NULL THEN
        DELETE FROM public.analytics_cache WHERE lecture_id = lid;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invalidate_analytics_cache ON public.learning_events;
CREATE TRIGGER trg_invalidate_analytics_cache
AFTER INSERT ON public.learning_events
FOR EACH ROW
EXECUTE FUNCTION public.invalidate_analytics_cache_on_event();

-- Same logic for student_progress completions which also feed several
-- aggregates (overview, dropoff, students matrix).
DROP TRIGGER IF EXISTS trg_invalidate_analytics_cache_progress ON public.student_progress;
CREATE OR REPLACE FUNCTION public.invalidate_analytics_cache_on_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.lecture_id IS NOT NULL THEN
        DELETE FROM public.analytics_cache WHERE lecture_id = NEW.lecture_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invalidate_analytics_cache_progress
AFTER INSERT OR UPDATE ON public.student_progress
FOR EACH ROW
EXECUTE FUNCTION public.invalidate_analytics_cache_on_progress();
