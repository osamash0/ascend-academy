-- Analytics tables: scope professor access to their own lectures only.
-- Previously: any professor could read ALL students' events, progress, and achievements.
-- Fix: professors can only see analytics for students enrolled in their own lectures.

-- ── learning_events ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Professors can view all events" ON public.learning_events;

-- Professors can view events that reference a lecture they own.
-- Events store lectureId inside the event_data JSONB field.
CREATE POLICY "Professors can view events for their lectures"
ON public.learning_events FOR SELECT
TO authenticated
USING (
    public.has_role(auth.uid(), 'professor')
    AND EXISTS (
        SELECT 1 FROM public.lectures
        WHERE professor_id = auth.uid()
          AND id::text = (event_data->>'lectureId')
    )
);

-- ── student_progress ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Professors can view all progress" ON public.student_progress;

-- Professors can only view progress records for lectures they own.
CREATE POLICY "Professors can view progress for their lectures"
ON public.student_progress FOR SELECT
TO authenticated
USING (
    public.has_role(auth.uid(), 'professor')
    AND EXISTS (
        SELECT 1 FROM public.lectures
        WHERE id = student_progress.lecture_id
          AND professor_id = auth.uid()
    )
);

-- ── achievements ─────────────────────────────────────────────────────────────
-- Achievements are not tied to a specific lecture, so professors should not
-- have cross-tenant visibility. Remove the overbroad professor read policy.
-- Professors who need achievement stats should query through their own lecture
-- analytics views rather than reading raw achievement rows of all students.
DROP POLICY IF EXISTS "Professors can view all achievements" ON public.achievements;
