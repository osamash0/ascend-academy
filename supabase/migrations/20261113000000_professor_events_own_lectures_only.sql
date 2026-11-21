-- A professor reads raw learning events only about their own lectures.
--
-- Until now "Professors view events for their enrolled students"
-- (20260621000000, recreated on the partitioned table by 20260721010000) let
-- an account with the professor role SELECT every learning_events row, user
-- id included, of every person enrolled in ANY course that professor owns:
-- what they read in other people's lectures, their logins, their searches,
-- their exams. The same rule sat on the retention rollup and on the
-- pre-partitioning backup table.
--
-- Why narrowed, not dropped: the v4 owner's view reads through the backend's
-- service connection and checks ownership in code
-- (backend/services/insights/sources/space.py, domain/authorization.py), so it
-- never needs this policy. But the older professor screens
-- (/professor/analytics/:lectureId and /advanced, still routed for the
-- professor role in src/App.tsx) call /api/analytics/* and Ask, and those read
-- learning_events with the professor's own JWT through
-- backend/services/analytics_service.get_auth_client, so RLS decides what they
-- see. Every one of those reads filters on event_data->>'lectureId' of the
-- professor's lecture (analytics_service, insights/bundle.py,
-- insights/evidence.py), or keeps only events whose slide belongs to the
-- professor's lectures (ai/ask_professor.py), and every event type those
-- reads use carries lectureId (backend/schemas/learning_events.py). So adding
-- "the event is about a lecture you own" to the existing condition leaves
-- every figure those screens show unchanged and removes everything else.
--
-- The new policy is 20261027000000's (which itself is 20260621000000's plus
-- "no v4 reader questions") with one more condition: the event's lectureId is
-- a lecture this professor owns.
--
-- Prod's migration ledger is unreliable: apply by hand
-- (docs/runbooks/apply-a-migration-by-hand.md), verify in pg_catalog. One
-- transaction, so a failure leaves the old policy in place, never none.

BEGIN;

-- ── learning_events: the enrolled-people rule AND the lecture is yours ──────
DROP POLICY IF EXISTS "Professors view events for their enrolled students" ON public.learning_events;
-- Created by 20260503000003; not live in prod (2026-07 catalog audit), dropped
-- here so no environment keeps a second professor path.
DROP POLICY IF EXISTS "Professors can view events for their lectures" ON public.learning_events;

CREATE POLICY "Professors view events about their own lectures"
ON public.learning_events FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'professor')
  AND EXISTS (
    SELECT 1
    FROM public.lectures l
    WHERE l.professor_id = auth.uid()
      AND l.id::text = learning_events.event_data->>'lectureId'
  )
  AND EXISTS (
    SELECT 1
    FROM public.course_enrollments ce
    JOIN public.courses c ON c.id = ce.course_id
    WHERE c.professor_id = auth.uid()
      AND ce.user_id = learning_events.user_id
  )
  -- Kept from 20261027000000: v4 reader questions never reach a professor raw.
  AND NOT (
    learning_events.event_type = 'ai_tutor_query'
    AND COALESCE(learning_events.event_data->>'source', '') = 'v4_reader'
  )
);

COMMENT ON POLICY "Professors view events about their own lectures" ON public.learning_events IS
  'Only for the older /professor/analytics screens, which read with the professor''s JWT. '
  'Events about a lecture the professor owns, from people enrolled in one of their courses. '
  'The v4 owner''s view reads through the service connection and does not use this.';

-- ── learning_events_daily_rollup: no reader needs it ────────────────────────
-- Read only by the retention script, the export and erasure, all through the
-- service connection. Professors keep no path into it.
DO $$
BEGIN
  IF to_regclass('public.learning_events_daily_rollup') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Professors view rollups for their enrolled students" ON public.learning_events_daily_rollup';
  END IF;
END
$$;

-- ── learning_events_legacy_20260721: a backup nobody reads with a JWT ───────
-- The rename in 20260721010000 kept the table's old policies and grants. No
-- code touches it (account_service lists it as an export exclusion). Drop the
-- professor policies on it and take it away from anon/authenticated
-- altogether; the service role and the owner keep it for rollback.
DO $$
BEGIN
  IF to_regclass('public.learning_events_legacy_20260721') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Professors view events for their enrolled students" ON public.learning_events_legacy_20260721';
    EXECUTE 'DROP POLICY IF EXISTS "Professors can view events for their lectures" ON public.learning_events_legacy_20260721';
    EXECUTE 'REVOKE ALL ON TABLE public.learning_events_legacy_20260721 FROM PUBLIC, anon, authenticated';
  END IF;
END
$$;

COMMIT;
