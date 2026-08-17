-- The first return after activation is a distinct onboarding retention event.
-- Store a timestamp so repeated sign-ins do not inflate the metric.
ALTER TABLE public.onboarding_progress
  ADD COLUMN IF NOT EXISTS second_session_started_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.record_onboarding_second_session()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  did_record BOOLEAN := FALSE;
BEGIN
  UPDATE public.onboarding_progress
  SET second_session_started_at = now(), updated_at = now()
  WHERE user_id = auth.uid()
    AND activated_at IS NOT NULL
    AND second_session_started_at IS NULL
  RETURNING TRUE INTO did_record;

  IF COALESCE(did_record, FALSE) THEN
    INSERT INTO public.learning_events (user_id, event_type, event_data)
    VALUES (auth.uid(), 'second_session_started', jsonb_build_object('onboarding_version', 2));
  END IF;

  RETURN COALESCE(did_record, FALSE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_onboarding_second_session() TO authenticated;
