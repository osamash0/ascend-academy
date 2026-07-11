-- Roadmap Phase 1.2: Exam Mode (mock exams per course), behind FEATURE_EXAM_MODE.
-- Attempts are pure own-row: professors never get row-level access, only
-- aggregates via a service-role analytics endpoint (Python-enforced, n<5
-- suppressed). Course access ("is this student allowed to generate an exam
-- for this course?") is enforced in the FastAPI layer at generate-time —
-- this table's RLS is defense-in-depth for direct client access only, same
-- convention as review_schedule/review_log in 20260710010000_review_engine.sql.

CREATE TABLE IF NOT EXISTS public.exam_attempts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    course_id      UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    question_ids   UUID[] NOT NULL,
    answers        JSONB NOT NULL DEFAULT '{}',
    time_limit_s   INTEGER NOT NULL,
    seed           BIGINT NOT NULL,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at   TIMESTAMPTZ,
    expired        BOOLEAN NOT NULL DEFAULT false,
    score          REAL,
    concept_report JSONB
);

CREATE INDEX IF NOT EXISTS exam_attempts_user_idx ON public.exam_attempts(user_id);
CREATE INDEX IF NOT EXISTS exam_attempts_course_idx ON public.exam_attempts(course_id);

ALTER TABLE public.exam_attempts ENABLE ROW LEVEL SECURITY;

-- Own-row only, both directions. No professor policy is defined at all —
-- professors read exam_attempts only via a service-role connection in the
-- exam-aggregate analytics endpoint, never through the anon/authenticated
-- client roles this policy governs.
CREATE POLICY "exam_attempts_own" ON public.exam_attempts
    FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── Badge: exam-ready ─────────────────────────────────────────────────────────
-- Event badge (metric IS NULL), awarded client-side via award_badge('Exam
-- Ready') after a first mock-exam score >= 80%. Key follows the catalog's
-- existing Title Case convention (see 20260616000000_gamification_engine.sql)
-- rather than inventing a kebab-case style — a prior attempt to add
-- 'review-streak-7'/'review-streak-30'/'centurion' as kebab-case keys was
-- never actually seeded into this table, so those awardBadge() calls
-- silently no-op today. Don't repeat that mistake here.
INSERT INTO public.badge_definitions
  (key, name, description, icon, category, xp_reward, metric, threshold, sort_order)
VALUES
  ('Exam Ready', 'Exam Ready', 'Scored 80% or higher on a mock exam.', '🎓', 'exam', 50, NULL, NULL, 100)
ON CONFLICT (key) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  icon        = EXCLUDED.icon,
  category    = EXCLUDED.category,
  xp_reward   = EXCLUDED.xp_reward,
  metric      = EXCLUDED.metric,
  threshold   = EXCLUDED.threshold,
  sort_order  = EXCLUDED.sort_order;
