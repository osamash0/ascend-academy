-- ─────────────────────────────────────────────────────────────────────────────
-- Daily nudge engine (Task #34)
--
-- `nudge_dismissals` records when a user dismissed (or was emitted) a nudge of
-- a given rule_key, optionally scoped to a specific subject (e.g. an
-- assignment id or a concept id). The engine reads from this table to honour
-- per-rule "quiet periods" so the same nudge is not re-emitted every day.
--
-- The same row is re-used for both "this nudge was emitted on day X" and
-- "the user explicitly dismissed it" — `dismissed` distinguishes the two.
-- A subsequent emit upserts the same (user, rule, subject) row and pushes
-- the `quiet_until` forward.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.nudge_dismissals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    rule_key        TEXT NOT NULL,
    subject_key     TEXT NOT NULL DEFAULT '',  -- '' = "no subject" (e.g. global streak)
    notification_id UUID NULL REFERENCES public.notifications(id) ON DELETE SET NULL,
    dismissed       BOOLEAN NOT NULL DEFAULT false,
    quiet_until     TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, rule_key, subject_key)
);

CREATE INDEX IF NOT EXISTS nudge_dismissals_user_idx
    ON public.nudge_dismissals(user_id);

CREATE INDEX IF NOT EXISTS nudge_dismissals_quiet_until_idx
    ON public.nudge_dismissals(quiet_until);

ALTER TABLE public.nudge_dismissals ENABLE ROW LEVEL SECURITY;

-- Users can read & dismiss their own rows; the backend uses the service
-- role for inserts/updates from the daily runner.
DROP POLICY IF EXISTS "Users read own nudge_dismissals" ON public.nudge_dismissals;
CREATE POLICY "Users read own nudge_dismissals"
    ON public.nudge_dismissals FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own nudge_dismissals" ON public.nudge_dismissals;
CREATE POLICY "Users update own nudge_dismissals"
    ON public.nudge_dismissals FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
