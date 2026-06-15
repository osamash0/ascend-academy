-- ─────────────────────────────────────────────────────────────────────────────
-- Gamification engine — XP + badges across every feature
--
-- Turns the previously ad-hoc, client-scattered XP/badge logic into a single
-- server-authoritative, idempotent engine:
--   • badge_definitions  — the ONE source of truth for every badge (replaces the
--                          three out-of-sync lists in gamification.ts / Ascent.tsx
--                          / inline LectureView code)
--   • grant_xp()         — XP with a reason + optional one-time dedupe key
--   • award_badge()      — idempotent grant of an EVENT badge (+ bundled XP + notify)
--   • evaluate_badges()  — server-side sweep that awards every STATE badge whose
--                          threshold is now met, derived from durable tables
--
-- Conventions mirror the recent 20260615* migrations: SECURITY DEFINER,
-- SET search_path = public, auth.uid() guard, REVOKE ALL … GRANT EXECUTE.
-- ─────────────────────────────────────────────────────────────────────────────

SET check_function_bodies = off;

-- ── 1. Idempotency primitives ────────────────────────────────────────────────

-- Collapse any pre-existing duplicate achievements (keep the earliest row) so the
-- unique index can be created. Historically dedup was enforced only by a
-- client-side SELECT-then-INSERT, which is race-prone.
DELETE FROM public.achievements a
USING public.achievements b
WHERE a.user_id = b.user_id
  AND a.badge_name = b.badge_name
  AND a.ctid > b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS achievements_user_badge_uniq
  ON public.achievements (user_id, badge_name);

-- xp_events gains a dedupe key so one-time XP grants (e.g. a per-lecture
-- completion bonus, or a badge's bundled reward) can never be double-counted.
ALTER TABLE public.xp_events ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS xp_events_user_dedupe_uniq
  ON public.xp_events (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- ── 2. Badge catalog — single source of truth ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.badge_definitions (
  key         TEXT PRIMARY KEY,             -- canonical, locale-stable id (also stored in achievements.badge_name)
  name        TEXT NOT NULL,                -- English fallback; UI localizes via i18n keyed off `key`
  description TEXT NOT NULL,
  icon        TEXT NOT NULL,
  category    TEXT NOT NULL,
  xp_reward   INTEGER NOT NULL DEFAULT 0,
  metric      TEXT,                         -- NULL = event badge (awarded explicitly); set = state badge (swept by evaluate_badges)
  threshold   INTEGER,                      -- minimum metric value to earn (only when metric is set)
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_secret   BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE public.badge_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Badge catalog is readable by authenticated" ON public.badge_definitions;
CREATE POLICY "Badge catalog is readable by authenticated"
  ON public.badge_definitions FOR SELECT
  TO authenticated
  USING (true);
-- No write policies → only the service role / migrations may modify the catalog.

-- Seed / upsert the catalog. Re-running the migration keeps it in sync.
INSERT INTO public.badge_definitions
  (key, name, description, icon, category, xp_reward, metric, threshold, sort_order)
VALUES
  ('Welcome Aboard',      'Welcome Aboard',      'Opened your very first slide.',                 '🚀', 'onboarding',    10,  'first_slide',          1,   10),
  ('Identity Set',        'Identity Set',        'Chose a display name and a profile photo.',     '🪪', 'onboarding',    25,  'profile_complete',     1,   11),
  ('Verified Scholar',    'Verified Scholar',    'Verified your university email.',               '🎓', 'onboarding',    100, 'email_verified',       1,   12),

  ('First Quiz Completed','First Quiz Completed','Completed your first lecture quiz.',            '🎯', 'quiz',          10,  NULL,                   NULL, 20),
  ('Perfect Score',       'Perfect Score',       'Scored 100% on a lecture quiz.',                '💯', 'quiz',          50,  'perfect_scores',       1,   21),
  ('Flawless Five',       'Flawless Five',       'Scored 100% on five lectures.',                 '✨', 'quiz',          150, 'perfect_scores',       5,   22),
  ('Quiz Master',         'Quiz Master',         'Answered 50 questions correctly.',              '🏆', 'quiz',          100, 'correct_answers',      50,  23),
  ('Sharpshooter',        'Sharpshooter',        'Answered 250 questions correctly.',             '🏹', 'quiz',          300, 'correct_answers',      250, 24),

  ('On Fire',             'On Fire',             'Five correct answers in a row.',                '🔥', 'streak',        25,  NULL,                   NULL, 30),
  ('Unstoppable',         'Unstoppable',         'Ten correct answers in a row.',                 '⚡', 'streak',        50,  NULL,                   NULL, 31),

  ('First Steps',         'First Steps',         'Completed your first lecture.',                 '👣', 'learning',      25,  'lectures_completed',   1,   40),
  ('Bookworm',            'Bookworm',            'Completed five lectures.',                      '📚', 'learning',      50,  'lectures_completed',   5,   41),
  ('Graduate',            'Graduate',            'Completed ten lectures.',                       '🎓', 'learning',      100, 'lectures_completed',   10,  42),
  ('Scholar',             'Scholar',             'Completed twenty-five lectures.',               '🧠', 'learning',      250, 'lectures_completed',   25,  43),
  ('Course Conqueror',    'Course Conqueror',    'Finished an entire course.',                    '🏔️', 'learning',      200, 'courses_completed',    1,   44),
  ('Polymath',            'Polymath',            'Finished three full courses.',                  '🌐', 'learning',      500, 'courses_completed',    3,   45),

  ('Getting Started',     'Getting Started',     'Kept a three-day study streak.',                '🌱', 'consistency',   25,  'best_streak',          3,   50),
  ('Consistent',          'Consistent',          'Kept a seven-day study streak.',                '🗓️', 'consistency',   75,  'best_streak',          7,   51),
  ('Dedicated',           'Dedicated',           'Kept a thirty-day study streak.',               '💎', 'consistency',   300, 'best_streak',          30,  52),

  ('Curious Mind',        'Curious Mind',        'Asked the AI tutor your first question.',       '💡', 'tutor',         15,  'ai_tutor_queries',     1,   60),
  ('Inquisitive',         'Inquisitive',         'Asked the AI tutor twenty questions.',          '🤖', 'tutor',         100, 'ai_tutor_queries',     20,  61),

  ('Quick Thinker',       'Quick Thinker',       'Did your first comprehension check.',           '⚡', 'comprehension', 10,  'comprehension_checks', 1,   70),
  ('Checkpoint Champion', 'Checkpoint Champion', 'Did twenty-five comprehension checks.',         '✅', 'comprehension', 100, 'comprehension_checks', 25,  71),

  ('Voice Heard',         'Voice Heard',         'Shared feedback to help us improve.',           '🗣️', 'community',     30,  NULL,                   NULL, 80),

  ('Level 5 Scholar',     'Level 5 Scholar',     'Reached level 5.',                              '⭐', 'milestone',     0,   'level',                5,   90),
  ('Level 10 Expert',     'Level 10 Expert',     'Reached level 10.',                             '🌟', 'milestone',     0,   'level',                10,  91),
  ('Level 25 Legend',     'Level 25 Legend',     'Reached level 25.',                             '👑', 'milestone',     0,   'level',                25,  92)
ON CONFLICT (key) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  icon        = EXCLUDED.icon,
  category    = EXCLUDED.category,
  xp_reward   = EXCLUDED.xp_reward,
  metric      = EXCLUDED.metric,
  threshold   = EXCLUDED.threshold,
  sort_order  = EXCLUDED.sort_order,
  is_secret   = EXCLUDED.is_secret;

-- ── 3. grant_xp() — XP with reason + optional one-time dedupe ─────────────────

CREATE OR REPLACE FUNCTION public.grant_xp(
  p_xp         INTEGER,
  p_reason     TEXT,
  p_dedupe_key TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id   UUID := auth.uid();
  _inserted  INTEGER;
  _new_total INTEGER;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- A non-null dedupe_key makes the grant idempotent (one-time events / bonuses).
  INSERT INTO public.xp_events (user_id, xp, reason, dedupe_key)
  VALUES (_user_id, p_xp, p_reason, p_dedupe_key)
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS _inserted = ROW_COUNT;
  IF _inserted = 0 THEN
    RETURN;  -- duplicate one-time grant → no XP change
  END IF;

  UPDATE public.profiles
     SET total_xp = total_xp + p_xp
   WHERE user_id = _user_id
   RETURNING total_xp INTO _new_total;

  UPDATE public.profiles
     SET current_level = FLOOR(_new_total / 100) + 1
   WHERE user_id = _user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_xp(INTEGER, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_xp(INTEGER, TEXT, TEXT) TO authenticated;

-- Keep the original 1-arg entrypoint as a thin wrapper for any legacy callers.
CREATE OR REPLACE FUNCTION public.add_xp_to_user(p_xp INTEGER)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.grant_xp(p_xp, NULL, NULL);
END;
$$;

-- ── 4. Internal badge grant (insert + bundled XP + notification) ──────────────
-- Not exposed to clients; only the SECURITY DEFINER wrappers below call it.

CREATE OR REPLACE FUNCTION public._grant_badge(p_user_id UUID, p_key TEXT)
RETURNS public.badge_definitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _def      public.badge_definitions;
  _inserted INTEGER;
BEGIN
  SELECT * INTO _def FROM public.badge_definitions WHERE key = p_key;
  IF _def.key IS NULL THEN
    RETURN NULL;  -- unknown badge
  END IF;

  INSERT INTO public.achievements (user_id, badge_name, badge_description, badge_icon)
  VALUES (p_user_id, _def.key, _def.description, _def.icon)
  ON CONFLICT (user_id, badge_name) DO NOTHING;

  GET DIAGNOSTICS _inserted = ROW_COUNT;
  IF _inserted = 0 THEN
    RETURN NULL;  -- already owned → not newly awarded
  END IF;

  -- Bundled XP, granted exactly once via the badge dedupe key.
  IF _def.xp_reward > 0 THEN
    PERFORM public.grant_xp(_def.xp_reward, 'badge:' || _def.key, 'badge:' || _def.key);
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (p_user_id, _def.name, _def.description, 'achievement');

  RETURN _def;
END;
$$;

REVOKE ALL ON FUNCTION public._grant_badge(UUID, TEXT) FROM PUBLIC;

-- ── 5. award_badge() — client entrypoint for EVENT badges ─────────────────────
-- Returns the def if newly awarded, NULL otherwise. State badges (metric set)
-- are refused here — they must flow through evaluate_badges(), which verifies
-- the threshold server-side, so a client cannot forge them.

CREATE OR REPLACE FUNCTION public.award_badge(p_key TEXT)
RETURNS public.badge_definitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id UUID := auth.uid();
  _def     public.badge_definitions;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO _def FROM public.badge_definitions WHERE key = p_key;
  IF _def.key IS NULL OR _def.metric IS NOT NULL THEN
    RETURN NULL;  -- unknown, or a state badge that must be earned via evaluate_badges()
  END IF;

  RETURN public._grant_badge(_user_id, p_key);
END;
$$;

REVOKE ALL ON FUNCTION public.award_badge(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_badge(TEXT) TO authenticated;

-- ── 6. evaluate_badges() — server-side sweep of STATE badges ──────────────────
-- Derives every metric from durable tables and awards each newly-qualified
-- badge. Returns the newly-awarded defs so the client can show popups.

CREATE OR REPLACE FUNCTION public.evaluate_badges()
RETURNS SETOF public.badge_definitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id UUID := auth.uid();
  _m       RECORD;
  _def     public.badge_definitions;
  _val     BIGINT;
  _awarded public.badge_definitions;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT
    (EXISTS (SELECT 1 FROM public.lecture_visits WHERE user_id = _user_id))::int          AS first_slide,
    (SELECT COUNT(*) FROM public.student_progress
       WHERE user_id = _user_id AND completed_at IS NOT NULL)                             AS lectures_completed,
    COALESCE((SELECT SUM(correct_answers) FROM public.student_progress
       WHERE user_id = _user_id), 0)                                                      AS correct_answers,
    (SELECT COUNT(*) FROM public.student_progress
       WHERE user_id = _user_id AND quiz_score = 100)                                     AS perfect_scores,
    -- Courses where EVERY lecture has a completed progress row for this user.
    (SELECT COUNT(*) FROM (
        SELECT l.course_id
        FROM public.lectures l
        LEFT JOIN public.student_progress sp
          ON sp.lecture_id = l.id
         AND sp.user_id = _user_id
         AND sp.completed_at IS NOT NULL
        WHERE l.course_id IS NOT NULL
        GROUP BY l.course_id
        HAVING COUNT(*) = COUNT(sp.id)
     ) cc)                                                                                AS courses_completed,
    (SELECT current_level FROM public.profiles WHERE user_id = _user_id)                  AS level,
    (SELECT best_streak FROM public.profiles WHERE user_id = _user_id)                    AS best_streak,
    (SELECT institution_verified FROM public.profiles WHERE user_id = _user_id)::int      AS email_verified,
    (SELECT (avatar_url IS NOT NULL AND COALESCE(full_name, '') <> '')
       FROM public.profiles WHERE user_id = _user_id)::int                                AS profile_complete,
    (SELECT COUNT(*) FROM public.learning_events
       WHERE user_id = _user_id AND event_type = 'ai_tutor_query')                        AS ai_tutor_queries,
    (SELECT COUNT(*) FROM public.learning_events
       WHERE user_id = _user_id AND event_type = 'micro_quiz_attempt')                    AS comprehension_checks
  INTO _m;

  FOR _def IN
    SELECT bd.* FROM public.badge_definitions bd
    WHERE bd.metric IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.achievements a
        WHERE a.user_id = _user_id AND a.badge_name = bd.key)
    ORDER BY bd.sort_order
  LOOP
    _val := CASE _def.metric
      WHEN 'first_slide'          THEN _m.first_slide
      WHEN 'lectures_completed'   THEN _m.lectures_completed
      WHEN 'correct_answers'      THEN _m.correct_answers
      WHEN 'perfect_scores'       THEN _m.perfect_scores
      WHEN 'courses_completed'    THEN _m.courses_completed
      WHEN 'level'                THEN _m.level
      WHEN 'best_streak'          THEN _m.best_streak
      WHEN 'email_verified'       THEN _m.email_verified
      WHEN 'profile_complete'     THEN _m.profile_complete
      WHEN 'ai_tutor_queries'     THEN _m.ai_tutor_queries
      WHEN 'comprehension_checks' THEN _m.comprehension_checks
      ELSE 0
    END;

    IF _val >= _def.threshold THEN
      _awarded := public._grant_badge(_user_id, _def.key);
      IF _awarded.key IS NOT NULL THEN
        RETURN NEXT _awarded;
      END IF;
    END IF;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_badges() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_badges() TO authenticated;
