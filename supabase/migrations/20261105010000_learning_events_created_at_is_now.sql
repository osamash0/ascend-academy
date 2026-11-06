-- A client cannot move its own learning events in time.
--
-- The policy "Users can insert their own events" lets any signed-in user write rows of their own with
-- any created_at. The owner's view of a Space ("How it's landing") reads events by week, so a member
-- could back-date events into any week. The legacy rooms still insert through Supabase (and never send
-- created_at), so direct inserts stay open; what a client may not do is say the event happened at some
-- other time than now.
--
-- Why a check and not a rewrite: public.learning_events is RANGE-partitioned by created_at. A BEFORE
-- ROW trigger that changed created_at would have to move the row to another partition, which Postgres
-- refuses. So the trigger only rejects: when the caller is `authenticated` or `anon` (the roles
-- Supabase switches to per client request), a created_at more than 5 minutes from now() raises
-- check_violation. A client that sends no created_at gets the column default now() and passes; the
-- 5 minutes leave room for a client clock a little off.
--
-- Every other role is untouched: the backend's own connection, service_role and postgres (seeds,
-- retention tests, backfills) keep whatever created_at they give.
--
-- SECURITY INVOKER on purpose: it must see the caller's current_user. A row-level BEFORE INSERT trigger
-- on the partitioned parent is cloned to every partition (Postgres 13+), so it fires for routed rows.
--
-- Apply by hand with psql (docs/runbooks/apply-a-migration-by-hand.md); probe with
--   select tgname from pg_trigger where tgrelid = 'public.learning_events'::regclass and not tgisinternal;

CREATE OR REPLACE FUNCTION public.learning_events_reject_moved_time()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND abs(extract(epoch FROM NEW.created_at - now())) > 300 THEN
    RAISE EXCEPTION 'learning_events.created_at must be within 5 minutes of now(); a row is stamped when it is written'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS learning_events_created_at_is_now ON public.learning_events;
CREATE TRIGGER learning_events_created_at_is_now
  BEFORE INSERT ON public.learning_events
  FOR EACH ROW EXECUTE FUNCTION public.learning_events_reject_moved_time();
