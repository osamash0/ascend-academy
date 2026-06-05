-- Add missing foreign key indexes from base schema
-- This prevents sequential scans on joins and cascading deletes.
-- Based on Supabase PostgreSQL Best Practices (query-missing-indexes)

CREATE INDEX IF NOT EXISTS idx_lectures_professor_id ON public.lectures(professor_id);

CREATE INDEX IF NOT EXISTS idx_slides_lecture_id ON public.slides(lecture_id);

CREATE INDEX IF NOT EXISTS idx_quiz_questions_slide_id ON public.quiz_questions(slide_id);

CREATE INDEX IF NOT EXISTS idx_learning_events_user_id ON public.learning_events(user_id);

CREATE INDEX IF NOT EXISTS idx_student_progress_lecture_id ON public.student_progress(lecture_id);

CREATE INDEX IF NOT EXISTS idx_achievements_user_id ON public.achievements(user_id);
