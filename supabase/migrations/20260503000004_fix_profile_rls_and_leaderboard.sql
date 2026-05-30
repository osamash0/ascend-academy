-- Profiles: restrict SELECT to own profile only and expose a safe leaderboard function.
-- Previously: any authenticated user could SELECT all profile rows including emails.
-- Fix: users can only read their own profile row. A security-definer function exposes
-- only the non-sensitive public fields needed for the leaderboard.

-- Drop the overbroad "view all" policy
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

-- Users can only read their own profile row
CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- ── Public leaderboard function ───────────────────────────────────────────────
-- Returns only the non-sensitive public fields needed for the leaderboard:
-- display_name, avatar_url, total_xp, current_level.
-- Emails, full_name, streaks, and user_id are intentionally excluded.
CREATE OR REPLACE FUNCTION public.get_public_leaderboard(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
    profile_id   UUID,
    display_name TEXT,
    avatar_url   TEXT,
    total_xp     INTEGER,
    current_level INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        p.id          AS profile_id,
        p.display_name,
        p.avatar_url,
        p.total_xp,
        p.current_level
    FROM public.profiles p
    INNER JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'student'
    ORDER BY p.total_xp DESC
    LIMIT LEAST(p_limit, 100);
$$;

-- Revoke direct execute from public, then grant only to authenticated users
REVOKE ALL ON FUNCTION public.get_public_leaderboard(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_leaderboard(INTEGER) TO authenticated;
