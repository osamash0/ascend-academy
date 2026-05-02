-- Per-feature free-text feedback collected from any signed-in user.
-- Feature is the dotted key of the surface that emitted it (e.g. "lecture_view.quiz",
-- "lecture_edit.save", "global"). Message is required; route + user_agent are
-- captured for triage. RLS: a user may insert/select their own rows; service-role
-- (admin) sees everything for the dashboard.

CREATE TABLE IF NOT EXISTS public.user_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    feature TEXT NOT NULL,
    message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
    route TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_feedback_user_idx ON public.user_feedback (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_feedback_feature_idx ON public.user_feedback (feature, created_at DESC);

ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_feedback_insert_own" ON public.user_feedback;
CREATE POLICY "user_feedback_insert_own"
    ON public.user_feedback FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_feedback_select_own" ON public.user_feedback;
CREATE POLICY "user_feedback_select_own"
    ON public.user_feedback FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);
