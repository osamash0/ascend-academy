-- Roadmap Phase 1.1: SRS review engine ("Daily Ascent"), behind FEATURE_REVIEW_ENGINE.
-- Cards are generated server-side from existing quiz_questions + concepts; a
-- per-user schedule tracks due dates (SM-2); a log records every grade.

CREATE TABLE IF NOT EXISTS public.review_cards (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lecture_id  UUID NOT NULL REFERENCES public.lectures(id) ON DELETE CASCADE,
    concept_id  UUID REFERENCES public.concepts(id) ON DELETE SET NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('quiz_question', 'concept_qa', 'concept_cloze')),
    source_id   UUID,
    front       JSONB NOT NULL,
    back        JSONB NOT NULL,
    content_hash TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (lecture_id, content_hash)
);

CREATE INDEX IF NOT EXISTS review_cards_lecture_idx ON public.review_cards(lecture_id);

CREATE TABLE IF NOT EXISTS public.review_schedule (
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    card_id      UUID NOT NULL REFERENCES public.review_cards(id) ON DELETE CASCADE,
    due_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    stability    REAL NOT NULL DEFAULT 0,
    difficulty   REAL NOT NULL DEFAULT 0,
    reps         INTEGER NOT NULL DEFAULT 0,
    lapses       INTEGER NOT NULL DEFAULT 0,
    state        TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'learning', 'review', 'relearning')),
    last_reviewed TIMESTAMPTZ,
    suspended    BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (user_id, card_id)
);

CREATE INDEX IF NOT EXISTS review_schedule_due_idx
    ON public.review_schedule(user_id, due_at) WHERE NOT suspended;

CREATE TABLE IF NOT EXISTS public.review_log (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    card_id     UUID NOT NULL REFERENCES public.review_cards(id) ON DELETE CASCADE,
    rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 4),
    elapsed_ms  INTEGER,
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_log_user_idx ON public.review_log(user_id, reviewed_at DESC);

ALTER TABLE public.review_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_log ENABLE ROW LEVEL SECURITY;

-- Cards: readable by students enrolled in the lecture's course (same
-- enrollment-join shape as practice_sheets' student policy).
CREATE POLICY "review_cards_student_enrolled" ON public.review_cards
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.assignment_lectures al
            JOIN public.assignment_enrollments ae ON ae.assignment_id = al.assignment_id
            WHERE al.lecture_id = review_cards.lecture_id
              AND ae.user_id = auth.uid()
        )
    );

-- Schedule/log: own rows only (read + write) — same shape as
-- practice_attempts_own. The FastAPI review endpoints write these via the
-- service-role connection; this policy is the defense-in-depth layer against
-- any direct client-side write attempt.
CREATE POLICY "review_schedule_own" ON public.review_schedule
    FOR ALL USING (user_id = auth.uid());

CREATE POLICY "review_log_own" ON public.review_log
    FOR ALL USING (user_id = auth.uid());
