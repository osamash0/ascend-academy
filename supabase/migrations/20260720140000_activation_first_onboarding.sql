-- Activation-first onboarding.  Profile completion is no longer a prerequisite
-- for learning; this table captures the small amount of state that actually
-- belongs to the first-study journey.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS has_completed_activation_onboarding BOOLEAN NOT NULL DEFAULT FALSE;

-- Users who have already completed the legacy identity flow must never be
-- dropped into the new first-run journey after this migration ships.
UPDATE public.profiles
SET has_completed_activation_onboarding = TRUE
WHERE has_completed_activation_onboarding = FALSE
  AND (full_name IS NOT NULL OR has_seen_dashboard_tour = TRUE);

CREATE TABLE IF NOT EXISTS public.onboarding_progress (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  version SMALLINT NOT NULL DEFAULT 2,
  selected_path TEXT CHECK (selected_path IN ('material', 'example')),
  study_goal TEXT CHECK (study_goal IN ('weekly_study', 'exam', 'assignment', 'understanding')),
  acquisition_source TEXT,
  demo_mission_step SMALLINT NOT NULL DEFAULT 0 CHECK (demo_mission_step BETWEEN 0 AND 4),
  activated_at TIMESTAMPTZ,
  first_activity_type TEXT,
  luna_customization_seen_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own activation onboarding"
ON public.onboarding_progress FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Preserve analytics meaning for existing accounts: their next lecture must
-- not be recorded as a newly activated onboarding journey.
INSERT INTO public.onboarding_progress (user_id, activated_at, first_activity_type)
SELECT user_id, now(), 'legacy'
FROM public.profiles
WHERE has_completed_activation_onboarding = TRUE
ON CONFLICT (user_id) DO NOTHING;

-- The activation is an immutable first event.  The RPC is deliberately
-- idempotent because opening a lecture can be reported by more than one UI.
CREATE OR REPLACE FUNCTION public.record_onboarding_activation(
  p_activity_type TEXT,
  p_course_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  did_activate BOOLEAN := FALSE;
BEGIN
  INSERT INTO public.onboarding_progress (user_id, activated_at, first_activity_type)
  VALUES (auth.uid(), now(), p_activity_type)
  ON CONFLICT (user_id) DO UPDATE
    SET activated_at = EXCLUDED.activated_at,
        first_activity_type = EXCLUDED.first_activity_type,
        updated_at = now()
    WHERE onboarding_progress.activated_at IS NULL
  RETURNING TRUE INTO did_activate;

  IF COALESCE(did_activate, FALSE) THEN
    INSERT INTO public.learning_events (user_id, event_type, event_data)
    VALUES (
      auth.uid(),
      'learning_activity_started',
      jsonb_build_object('activity_type', p_activity_type, 'course_id', p_course_id, 'onboarding_version', 2)
    );
  END IF;

  RETURN COALESCE(did_activate, FALSE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_onboarding_activation(TEXT, UUID) TO authenticated;
