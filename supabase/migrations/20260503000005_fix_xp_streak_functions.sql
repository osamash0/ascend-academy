-- XP and streak RPCs: remove the caller-controlled p_user_id parameter and use
-- auth.uid() internally. Also revoke public execute and grant only to authenticated.
-- Previously: any authenticated user could supply any UUID and tamper with another
-- user's XP/streak because the functions are SECURITY DEFINER.

-- ── add_xp_to_user ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_xp_to_user(p_xp INTEGER)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id    UUID := auth.uid();
    new_total_xp INTEGER;
    new_level    INTEGER;
BEGIN
    IF _user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    UPDATE public.profiles
    SET total_xp = total_xp + p_xp
    WHERE user_id = _user_id
    RETURNING total_xp INTO new_total_xp;

    -- Calculate new level (level up every 100 XP)
    new_level := FLOOR(new_total_xp / 100) + 1;

    UPDATE public.profiles
    SET current_level = new_level
    WHERE user_id = _user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_xp_to_user(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_xp_to_user(INTEGER) TO authenticated;

-- ── update_user_streak ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_user_streak(p_correct BOOLEAN)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id          UUID := auth.uid();
    current_streak_val INTEGER;
    best_streak_val    INTEGER;
BEGIN
    IF _user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF p_correct THEN
        UPDATE public.profiles
        SET current_streak = current_streak + 1
        WHERE user_id = _user_id
        RETURNING current_streak, best_streak INTO current_streak_val, best_streak_val;

        IF current_streak_val > best_streak_val THEN
            UPDATE public.profiles
            SET best_streak = current_streak_val
            WHERE user_id = _user_id;
        END IF;
    ELSE
        UPDATE public.profiles
        SET current_streak = 0
        WHERE user_id = _user_id;
        current_streak_val := 0;
    END IF;

    RETURN current_streak_val;
END;
$$;

REVOKE ALL ON FUNCTION public.update_user_streak(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_user_streak(BOOLEAN) TO authenticated;

-- Revoke execute on the old overloaded signatures that accepted p_user_id,
-- in case they still exist from the original migration.
DO $$
BEGIN
    -- Attempt to revoke the old two-argument form if it still exists
    EXECUTE 'REVOKE ALL ON FUNCTION public.add_xp_to_user(UUID, INTEGER) FROM PUBLIC'
    ;
EXCEPTION WHEN undefined_function THEN NULL;
END;
$$;

DO $$
BEGIN
    EXECUTE 'REVOKE ALL ON FUNCTION public.update_user_streak(UUID, BOOLEAN) FROM PUBLIC';
EXCEPTION WHEN undefined_function THEN NULL;
END;
$$;
