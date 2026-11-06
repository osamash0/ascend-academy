-- Keep profile trust fields server-owned on creation as well as updates.
-- Run before enforce_luna_loadout: unlock checks must see the protected values,
-- never an XP/level/streak supplied in the same client statement.
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.institution_verified := false;
      NEW.total_xp := 0;
      NEW.current_level := 1;
      NEW.current_streak := 0;
      NEW.best_streak := 0;
    ELSE
      NEW.institution_verified := OLD.institution_verified;
      NEW.total_xp := OLD.total_xp;
      NEW.current_level := OLD.current_level;
      NEW.current_streak := OLD.current_streak;
      NEW.best_streak := OLD.best_streak;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_profile_privileged_columns() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS protect_profile_privileged_columns ON public.profiles;
DROP TRIGGER IF EXISTS a_protect_profile_privileged_columns ON public.profiles;
CREATE TRIGGER a_protect_profile_privileged_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_columns();

-- Internal ledger writer. Invoker security is deliberate: only trusted callers
-- and the guarded definer functions below can execute it. One atomic profile
-- update follows a successful, canonical ledger insert.
CREATE OR REPLACE FUNCTION public._record_xp(
  p_user_id uuid, p_xp integer, p_reason text, p_dedupe_key text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.xp_events (user_id, xp, reason, dedupe_key)
  VALUES (p_user_id, p_xp, p_reason, p_dedupe_key)
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  IF NOT FOUND THEN RETURN 0; END IF;

  UPDATE public.profiles
     SET total_xp = COALESCE(total_xp, 0) + p_xp,
         current_level = FLOOR((COALESCE(total_xp, 0) + p_xp) / 100) + 1
   WHERE user_id = p_user_id;
  RETURN p_xp;
END;
$$;
REVOKE ALL ON FUNCTION public._record_xp(uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._record_xp(uuid, integer, text, text) TO service_role;

-- Reviews are written by the backend grader. A client-created review_log row
-- must not become evidence for a reward. SELECT remains available to its owner.
DROP POLICY IF EXISTS review_log_own ON public.review_log;
CREATE POLICY review_log_own ON public.review_log
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.review_log FROM PUBLIC, anon, authenticated;

-- Preserve the legacy completion/review/badge call shape, but require a known
-- activity, its fixed reward, and a canonical dedupe key. Callers cannot mint
-- XP by inventing reasons, amounts or new keys for the same activity.
-- Completion is still a self-reported learning milestone; this bounds its
-- reward to 20 per visible Lesson, not proof that a person read every page.
CREATE OR REPLACE FUNCTION public.grant_xp(
  p_xp integer, p_reason text, p_dedupe_key text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _uid uuid := auth.uid();
  _source uuid;
  _reward integer;
  _key text;
  _today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_xp IS NULL OR p_xp <= 0 OR p_xp > 500 OR p_dedupe_key IS NULL THEN
    RAISE EXCEPTION 'Invalid XP claim';
  END IF;

  IF p_reason = 'lecture_complete' AND p_dedupe_key ~ '^lecture:[0-9a-f-]{36}$' THEN
    _source := split_part(p_dedupe_key, ':', 2)::uuid;
    IF NOT public.lecture_visible_to_caller(_source) OR NOT EXISTS (
      SELECT 1 FROM public.student_progress
      WHERE user_id = _uid AND lecture_id = _source AND completed_at IS NOT NULL
    ) THEN RAISE EXCEPTION 'Lesson is not completed or visible'; END IF;
    _reward := 20;
    _key := 'lecture:' || _source::text;
  ELSIF p_reason = 'review' AND p_dedupe_key ~ '^review:[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9-]{10}$' THEN
    _source := split_part(p_dedupe_key, ':', 3)::uuid;
    _key := 'review:' || _uid::text || ':' || _source::text || ':' || _today::text;
    IF NOT EXISTS (
      SELECT 1 FROM public.review_log
      WHERE user_id = _uid AND card_id = _source
        AND reviewed_at >= (_today::timestamp AT TIME ZONE 'UTC')
        AND reviewed_at < ((_today + 1)::timestamp AT TIME ZONE 'UTC')
    ) THEN RAISE EXCEPTION 'Review has not been graded today'; END IF;
    _reward := 5;
  ELSIF p_reason LIKE 'badge:%' THEN
    SELECT bd.xp_reward INTO _reward
    FROM public.badge_definitions bd
    JOIN public.achievements a ON a.badge_name = bd.key AND a.user_id = _uid
    WHERE bd.key = substr(p_reason, 7);
    _key := p_reason;
  ELSE
    RAISE EXCEPTION 'Unsupported XP activity';
  END IF;

  IF _reward IS NULL OR p_xp <> _reward OR p_dedupe_key IS DISTINCT FROM _key THEN
    RAISE EXCEPTION 'XP claim does not match the activity';
  END IF;
  PERFORM public._record_xp(_uid, _reward, p_reason, _key);
END;
$$;
REVOKE ALL ON FUNCTION public.grant_xp(integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_xp(integer, text, text) TO authenticated, service_role;

-- Legacy quizzes now submit the answer, not an amount or an isCorrect flag.
-- Share the live reader's v4quiz key so crossing readers never awards twice.
CREATE OR REPLACE FUNCTION public.grant_quiz_xp(p_question_id uuid, p_selected_index integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _uid uuid := auth.uid();
  _lecture uuid;
  _correct integer;
  _choices integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT s.lecture_id, q.correct_answer,
         CASE WHEN jsonb_typeof(q.options) = 'array' THEN jsonb_array_length(q.options) ELSE 0 END
    INTO _lecture, _correct, _choices
    FROM public.quiz_questions q JOIN public.slides s ON s.id = q.slide_id
    WHERE q.id = p_question_id;
  IF _lecture IS NULL OR NOT public.lecture_visible_to_caller(_lecture) THEN
    RAISE EXCEPTION 'Question not found or not visible' USING ERRCODE = '42501';
  END IF;
  IF p_selected_index IS NULL OR _correct IS NULL OR _correct < 0
     OR _correct >= _choices OR _choices < 2 OR p_selected_index <> _correct THEN
    RETURN 0;
  END IF;
  RETURN public._record_xp(_uid, 10, 'quiz_correct', 'v4quiz:' || p_question_id::text);
END;
$$;
REVOKE ALL ON FUNCTION public.grant_quiz_xp(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_quiz_xp(uuid, integer) TO authenticated, service_role;

-- No current app caller uses this unverified, self-incrementing overload.
REVOKE ALL ON FUNCTION public.update_user_streak(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_streak(boolean) TO service_role;
