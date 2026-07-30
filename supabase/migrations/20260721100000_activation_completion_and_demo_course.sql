-- Phase 0 activation release gate:
--   * complete the first-run journey through one server-authoritative RPC;
--   * identify the starter course by a stable key rather than display text.
--
-- The demo course is optional in every environment.  A missing row is an
-- expected catalog state that the client handles explicitly; it must never
-- fall back to a translated title match.

ALTER TABLE public.onboarding_progress
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS demo_slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS courses_demo_slug_unique
  ON public.courses (demo_slug)
  WHERE demo_slug IS NOT NULL;

-- Mark an existing published seed, if this environment has one.  The stable
-- slug is the runtime contract; this one-time backfill only helps databases
-- that already seeded the example before the slug existed.
WITH candidate AS (
  SELECT id
  FROM public.courses
  WHERE demo_slug IS NULL
    AND status = 'published'
    AND is_archived = FALSE
    AND lower(trim(title)) IN ('database systems', 'datenbanksysteme')
  ORDER BY created_at ASC
  LIMIT 1
)
UPDATE public.courses
SET demo_slug = 'database-systems'
WHERE id IN (SELECT id FROM candidate);

CREATE OR REPLACE FUNCTION public.complete_activation_onboarding(
  p_path TEXT,
  p_study_goal TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id UUID := auth.uid();
  _completed_now BOOLEAN := FALSE;
  _selected_path TEXT;
  _study_goal TEXT;
  _version SMALLINT;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_path NOT IN ('material', 'example') THEN
    RAISE EXCEPTION 'Invalid onboarding path';
  END IF;
  IF p_study_goal IS NOT NULL
     AND p_study_goal NOT IN ('weekly_study', 'exam', 'assignment', 'understanding') THEN
    RAISE EXCEPTION 'Invalid study goal';
  END IF;
  IF p_path = 'example' AND p_study_goal IS NOT NULL THEN
    RAISE EXCEPTION 'Example onboarding does not accept a study goal';
  END IF;

  -- The WHERE clause makes completion first-write-wins and serializes the
  -- conversion event: retries return the original choice without emitting a
  -- second onboarding_completed row.
  INSERT INTO public.onboarding_progress (
    user_id, selected_path, study_goal, completed_at, updated_at
  )
  VALUES (_user_id, p_path, p_study_goal, now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET selected_path = EXCLUDED.selected_path,
        study_goal = EXCLUDED.study_goal,
        completed_at = EXCLUDED.completed_at,
        updated_at = now()
    WHERE onboarding_progress.completed_at IS NULL
  RETURNING selected_path, study_goal, version
  INTO _selected_path, _study_goal, _version;

  _completed_now := FOUND;

  IF NOT _completed_now THEN
    SELECT selected_path, study_goal, version
    INTO _selected_path, _study_goal, _version
    FROM public.onboarding_progress
    WHERE user_id = _user_id;
  END IF;

  UPDATE public.profiles
  SET has_completed_activation_onboarding = TRUE
  WHERE user_id = _user_id;

  IF _completed_now THEN
    INSERT INTO public.learning_events (user_id, event_type, event_data)
    VALUES (
      _user_id,
      'onboarding_completed',
      jsonb_build_object(
        'role', 'student',
        'path', _selected_path,
        'study_goal', _study_goal,
        'onboarding_version', _version
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'completed', _completed_now,
    'path', _selected_path,
    'study_goal', _study_goal,
    'onboarding_version', _version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_activation_onboarding(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_activation_onboarding(TEXT, TEXT) TO authenticated;
