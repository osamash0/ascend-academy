-- Personalized weekly study plan (Task #35)
--
-- Tiny event log: a student marks one item of their generated study plan
-- "done". The endpoint regenerates the plan from scratch on every request,
-- so a completion is just a per-(user, plan_date, lecture_id) row that
-- removes the item from today's view and informs the next day's regen.

CREATE TABLE IF NOT EXISTS public.schedule_item_completions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    plan_date DATE NOT NULL,
    lecture_id UUID REFERENCES public.lectures(id) ON DELETE CASCADE NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, plan_date, lecture_id)
);

ALTER TABLE public.schedule_item_completions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS schedule_item_completions_user_date_idx
    ON public.schedule_item_completions(user_id, plan_date);

DROP POLICY IF EXISTS "Users insert own schedule completions"
    ON public.schedule_item_completions;
CREATE POLICY "Users insert own schedule completions"
    ON public.schedule_item_completions FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own schedule completions"
    ON public.schedule_item_completions;
CREATE POLICY "Users read own schedule completions"
    ON public.schedule_item_completions FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own schedule completions"
    ON public.schedule_item_completions;
CREATE POLICY "Users delete own schedule completions"
    ON public.schedule_item_completions FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);
