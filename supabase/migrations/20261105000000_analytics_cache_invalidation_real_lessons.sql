-- How it's landing, Plan 3: a learning event clears only a real Lesson's cache.
--
-- trg_invalidate_analytics_cache (20260719000001) deletes every analytics_cache
-- row whose lecture_id equals the event's event_data->>'lectureId'. A member
-- writes their own events, so they choose that value. Since Plan 2 the owner's
-- view of a Space ('landing') and its themes ('themes', one metered model call
-- per page) are cached under the SPACE's id in that same slot, so an event that
-- names the Space id wiped both every 15 seconds and re-ran the owner's theme
-- calls on the owner's allowance. professor_overview shares the slot too.
--
-- Fix: invalidate only when lectureId is an existing lecture. A Space's views
-- expire by their own TTL (300 s for landing; themes are keyed by asker count).
-- Same signature, so the trigger binding and the existing ACL stay; the REVOKE
-- below repeats 20261011000000 for this file's own lint.

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

    -- Only a real Lesson's cache. Anything else (a Space's id, a made-up id)
    -- names no lecture: nothing to clear, and no debounce row to write.
    IF NOT EXISTS (SELECT 1 FROM public.lectures WHERE id = lid) THEN
        RETURN NEW;
    END IF;

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

REVOKE ALL ON FUNCTION public.invalidate_analytics_cache_on_event() FROM PUBLIC, anon;
