-- Avatar unlock guard: the database refuses gear the student hasn't earned.
--
-- Until now unlocks were only checked in the browser (sanitizeLoadout), so a
-- direct PATCH to profiles.luna_loadout could equip e.g. the Legend halo, and
-- everyone else would see it via get_luna_loadouts. This makes the rule
-- server-authoritative:
--
-- 1. public.avatar_items: the catalog (id, slot, unlock), generated from
--    src/features/avatar/catalog.ts. A frontend test fails if the two drift.
-- 2. A BEFORE INSERT/UPDATE trigger on profiles validates every slot in
--    luna_loadout: the item must exist, sit in that slot, and be unlocked by
--    the row's own XP / level / best streak / earned badges. Rank thresholds
--    mirror src/lib/rank.ts (RANK_TIERS).
--
-- Trusted roles (service_role, postgres) are exempt so support can repair a
-- profile. Legit clients never hit the error: they sanitize before saving.
-- Versioned ...000400: 20261012000000 is taken by parse_receipts on another
-- branch.

CREATE TABLE IF NOT EXISTS public.avatar_items (
  id           text PRIMARY KEY,
  slot         text NOT NULL,
  unlock_kind  text NOT NULL CHECK (unlock_kind IN ('free', 'rank', 'level', 'streak', 'badge')),
  unlock_value text
);

ALTER TABLE public.avatar_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "avatar items are readable" ON public.avatar_items;
CREATE POLICY "avatar items are readable" ON public.avatar_items FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.avatar_items FROM anon;
GRANT SELECT ON public.avatar_items TO authenticated;

INSERT INTO public.avatar_items (id, slot, unlock_kind, unlock_value) VALUES
  ('outfit-none', 'outfit', 'free', NULL),
  ('outfit-gulf', 'outfit', 'badge', 'First Steps'),
  ('outfit-levant', 'outfit', 'badge', 'First Steps'),
  ('outfit-turkiye', 'outfit', 'badge', 'First Steps'),
  ('outfit-texas', 'outfit', 'badge', 'First Steps'),
  ('outfit-lederhosen', 'outfit', 'badge', 'First Steps'),
  ('outfit-dirndl', 'outfit', 'badge', 'First Steps'),
  ('outfit-scotland', 'outfit', 'badge', 'First Steps'),
  ('outfit-japan', 'outfit', 'badge', 'First Steps'),
  ('outfit-india', 'outfit', 'badge', 'First Steps'),
  ('outfit-westafrica', 'outfit', 'badge', 'First Steps'),
  ('outfit-cosy', 'outfit', 'free', NULL),
  ('outfit-reader', 'outfit', 'badge', 'Bookworm'),
  ('outfit-football', 'outfit', 'badge', 'On Fire'),
  ('outfit-basketball', 'outfit', 'badge', 'Sharpshooter'),
  ('outfit-gym', 'outfit', 'streak', '7'),
  ('outfit-gamer', 'outfit', 'level', '10'),
  ('outfit-graduation', 'outfit', 'badge', 'Course Conqueror'),
  ('suit-moonlight', 'suit', 'free', NULL),
  ('suit-lavender', 'suit', 'free', NULL),
  ('suit-mint', 'suit', 'free', NULL),
  ('suit-blush', 'suit', 'free', NULL),
  ('suit-tide', 'suit', 'free', NULL),
  ('suit-coral', 'suit', 'level', '3'),
  ('suit-midnight', 'suit', 'rank', 'Learner'),
  ('suit-solar', 'suit', 'streak', '7'),
  ('suit-nebula', 'suit', 'rank', 'Expert'),
  ('suit-aurora', 'suit', 'rank', 'Legend'),
  ('suit-gilded', 'suit', 'rank', 'Immortal'),
  ('visor-teal', 'visor', 'free', NULL),
  ('visor-violet', 'visor', 'free', NULL),
  ('visor-rose', 'visor', 'free', NULL),
  ('visor-amber', 'visor', 'free', NULL),
  ('visor-mauve', 'visor', 'free', NULL),
  ('visor-tide', 'visor', 'free', NULL),
  ('visor-cyan', 'visor', 'level', '5'),
  ('visor-gold', 'visor', 'rank', 'Scholar'),
  ('visor-prism', 'visor', 'badge', 'Perfect Score'),
  ('gear-none', 'gear', 'free', NULL),
  ('gear-antenna', 'gear', 'free', NULL),
  ('gear-bulb', 'gear', 'badge', 'Quick Thinker'),
  ('gear-headphones', 'gear', 'badge', 'Bookworm'),
  ('gear-mortarboard', 'gear', 'badge', 'Graduate'),
  ('gear-flame', 'gear', 'streak', '7'),
  ('gear-laurel', 'gear', 'rank', 'Master'),
  ('gear-halo', 'gear', 'rank', 'Legend'),
  ('gear-starcrown', 'gear', 'rank', 'Immortal'),
  ('patch-star', 'patch', 'free', NULL),
  ('patch-moon', 'patch', 'free', NULL),
  ('patch-book', 'patch', 'badge', 'First Steps'),
  ('patch-flame', 'patch', 'streak', '3'),
  ('patch-bolt', 'patch', 'badge', 'On Fire'),
  ('patch-check', 'patch', 'badge', 'Perfect Score'),
  ('patch-question', 'patch', 'badge', 'Inquisitive'),
  ('patch-heart', 'patch', 'badge', 'Voice Heard'),
  ('patch-target', 'patch', 'badge', 'Sharpshooter'),
  ('patch-trophy', 'patch', 'badge', 'Course Conqueror'),
  ('companion-none', 'companion', 'free', NULL),
  ('companion-comet', 'companion', 'streak', '3'),
  ('companion-byte', 'companion', 'badge', 'First Quiz Completed'),
  ('companion-spark', 'companion', 'badge', 'Unstoppable'),
  ('companion-minimoon', 'companion', 'level', '10'),
  ('companion-owl', 'companion', 'badge', 'Scholar'),
  ('aura-none', 'aura', 'free', NULL),
  ('aura-stardust', 'aura', 'rank', 'Learner'),
  ('aura-rings', 'aura', 'rank', 'Expert'),
  ('aura-ember', 'aura', 'streak', '30'),
  ('aura-nebula', 'aura', 'rank', 'Master'),
  ('aura-supernova', 'aura', 'rank', 'Immortal'),
  ('backdrop-deepspace', 'backdrop', 'free', NULL),
  ('backdrop-lunar', 'backdrop', 'free', NULL),
  ('backdrop-aurora', 'backdrop', 'streak', '7'),
  ('backdrop-observatory', 'backdrop', 'level', '10'),
  ('backdrop-galaxy', 'backdrop', 'rank', 'Legend')
ON CONFLICT (id) DO UPDATE
  SET slot = EXCLUDED.slot, unlock_kind = EXCLUDED.unlock_kind, unlock_value = EXCLUDED.unlock_value;

-- Rank tier -> minimum XP (mirrors RANK_TIERS in src/lib/rank.ts).
CREATE OR REPLACE FUNCTION public.avatar_rank_min_xp(p_tier text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_tier
    WHEN 'Newcomer' THEN 0
    WHEN 'Learner'  THEN 500
    WHEN 'Scholar'  THEN 1500
    WHEN 'Expert'   THEN 3500
    WHEN 'Master'   THEN 7000
    WHEN 'Legend'   THEN 13000
    WHEN 'Immortal' THEN 25000
  END;
$$;

REVOKE ALL ON FUNCTION public.avatar_rank_min_xp(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avatar_rank_min_xp(text) TO authenticated;

-- SECURITY INVOKER on purpose: inside a SECURITY DEFINER function
-- current_user is the function's owner (postgres on Supabase), which would
-- make the trusted-role check below true for everyone and switch the guard
-- off. As invoker, current_user is the real caller; students can already
-- read their own achievements (RLS) and the catalog (granted above).
CREATE OR REPLACE FUNCTION public.enforce_luna_loadout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _slot  text;
  _value text;
  _item  public.avatar_items%ROWTYPE;
  _ok    boolean;
BEGIN
  -- Non-objects are the shape constraint's job (profiles_luna_loadout_shape).
  IF NEW.luna_loadout IS NULL OR jsonb_typeof(NEW.luna_loadout) <> 'object' OR NEW.luna_loadout = '{}'::jsonb THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.luna_loadout IS NOT DISTINCT FROM OLD.luna_loadout THEN
    RETURN NEW;
  END IF;
  -- Trusted callers may set anything: the service key (support tooling) and
  -- real superusers (migrations, psql). Checked by attribute, not by name.
  IF current_user = 'service_role'
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RETURN NEW;
  END IF;

  FOR _slot, _value IN SELECT key, value FROM jsonb_each_text(NEW.luna_loadout) LOOP
    SELECT * INTO _item FROM public.avatar_items WHERE id = _value;
    IF NOT FOUND OR _item.slot <> _slot THEN
      RAISE EXCEPTION 'unknown avatar item % for slot %', _value, _slot USING ERRCODE = '22023';
    END IF;

    _ok := CASE _item.unlock_kind
      WHEN 'free'   THEN true
      WHEN 'rank'   THEN coalesce(NEW.total_xp, 0) >= public.avatar_rank_min_xp(_item.unlock_value)
      WHEN 'level'  THEN coalesce(NEW.current_level, 1) >= _item.unlock_value::int
      WHEN 'streak' THEN greatest(coalesce(NEW.best_streak, 0), coalesce(NEW.current_streak, 0)) >= _item.unlock_value::int
      WHEN 'badge'  THEN EXISTS (
        SELECT 1 FROM public.achievements a WHERE a.user_id = NEW.user_id AND a.badge_name = _item.unlock_value
      )
      ELSE false
    END;

    IF NOT _ok THEN
      RAISE EXCEPTION 'avatar item % is not unlocked yet', _value USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Trigger functions are invoked by the trigger, never called directly.
REVOKE ALL ON FUNCTION public.enforce_luna_loadout() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS enforce_luna_loadout ON public.profiles;
CREATE TRIGGER enforce_luna_loadout
  BEFORE INSERT OR UPDATE OF luna_loadout ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_luna_loadout();
