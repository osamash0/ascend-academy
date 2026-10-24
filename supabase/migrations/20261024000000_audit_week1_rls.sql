-- 2026-10 codebase audit, week 1 (docs/audit/04-quality.md Part C F-2, F-7,
-- F-8; Part A §3). Four small tightenings, all defense-in-depth for direct
-- client access with the anon/authenticated key:
--
--   1. storage.objects SELECT on `lecture-pdfs` was bucket-wide: any signed-in
--      user could list and download every lecture PDF, and the frontend mints
--      signed URLs client-side. Now follows public.lecture_visible_to_caller()
--      for the `lectures/{lectureId}/...` key layout the INSERT policy already
--      assumes; keys that do not carry a lecture uuid keep the old behaviour.
--   2. lecture_mind_maps SELECT was `auth.uid() IS NOT NULL` — every signed-in
--      user could read every map. Same rule as the lecture itself now.
--   3. achievements kept a client INSERT policy ("System can insert
--      achievements", WITH CHECK auth.uid() = user_id), so a user could mint
--      any badge for themselves. Badges are granted by the SECURITY DEFINER
--      functions award_badge/evaluate_badges/_grant_badge (owner bypasses RLS);
--      the only client-side insert (studentService.awardAchievement) has no
--      callers.
--   4. add_xp_to_user(integer) is a self-award of up to any amount, has no
--      callers (grant_xp with its 500-cap and reason is the live path), and
--      was still executable by `authenticated`.
--
-- Prod's migration ledger is unreliable (see docs/audit/00-summary.md): apply
-- by hand and verify against pg_catalog, never with `supabase db push`.

-- ── 1. lecture-pdfs: SELECT respects lecture visibility ──────────────────────
DROP POLICY IF EXISTS "Authenticated users can read lecture PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Read lecture PDFs respecting lecture visibility" ON storage.objects;
CREATE POLICY "Read lecture PDFs respecting lecture visibility"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'lecture-pdfs'
    AND (
        -- `lectures/{lectureId}/{filename}`: ask the lecture.
        CASE
            WHEN (string_to_array(name, '/'))[1] = 'lectures'
             AND (string_to_array(name, '/'))[2] ~ '^[0-9a-fA-F-]{36}$'
            THEN public.lecture_visible_to_caller(((string_to_array(name, '/'))[2])::uuid)
            ELSE true
        END
    )
);

-- ── 2. lecture_mind_maps: SELECT respects lecture visibility ─────────────────
DROP POLICY IF EXISTS "students can view maps" ON public.lecture_mind_maps;
DROP POLICY IF EXISTS "View mind maps respecting lecture visibility" ON public.lecture_mind_maps;
CREATE POLICY "View mind maps respecting lecture visibility"
ON public.lecture_mind_maps FOR SELECT
TO authenticated
USING (public.lecture_visible_to_caller(lecture_id));

-- ── 3. achievements: no client-side minting ──────────────────────────────────
DROP POLICY IF EXISTS "System can insert achievements" ON public.achievements;

-- ── 4. add_xp_to_user(integer): not callable by clients ──────────────────────
DO $$
BEGIN
    IF to_regprocedure('public.add_xp_to_user(integer)') IS NOT NULL THEN
        REVOKE EXECUTE ON FUNCTION public.add_xp_to_user(integer) FROM PUBLIC, anon, authenticated;
    END IF;
END $$;
