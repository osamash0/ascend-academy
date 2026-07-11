-- Roadmap Phase 4.1: professor visibility/control over review_cards (SRS
-- "Daily Ascent"). Cards currently go live to students the instant the
-- card-factory Arq job runs, with zero professor review surface.
--
-- Soft-hide, not delete: review_schedule/review_log both have
-- ON DELETE CASCADE on card_id (20260710010000_review_engine.sql), so a hard
-- DELETE of a bad card would silently destroy every student's SM-2 progress
-- and grade history for it. hidden_at additive column instead — a hidden
-- card stops being served (new activation + existing student queues) but its
-- row and every student's history survive, restorable by un-hiding.

ALTER TABLE public.review_cards
    ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS review_cards_hidden_idx
    ON public.review_cards(lecture_id) WHERE hidden_at IS NULL;

-- Defense-in-depth: even a direct client read should not surface a hidden
-- card, matching the backend query filter added in review.py.
DROP POLICY IF EXISTS "review_cards_student_enrolled" ON public.review_cards;
CREATE POLICY "review_cards_student_enrolled" ON public.review_cards
    FOR SELECT USING (
        hidden_at IS NULL
        AND EXISTS (
            SELECT 1 FROM public.assignment_lectures al
            JOIN public.assignment_enrollments ae ON ae.assignment_id = al.assignment_id
            WHERE al.lecture_id = review_cards.lecture_id
              AND ae.user_id = auth.uid()
        )
    );

-- Professors manage (read/hide/unhide) cards for lectures they own. Writes
-- from the FastAPI layer go through the service-role connection (bypasses
-- RLS); this is the defense-in-depth layer for any direct client access.
DROP POLICY IF EXISTS "review_cards_professor_owns_lecture" ON public.review_cards;
CREATE POLICY "review_cards_professor_owns_lecture" ON public.review_cards
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.lectures l
            WHERE l.id = review_cards.lecture_id
              AND l.professor_id = auth.uid()
        )
    );
