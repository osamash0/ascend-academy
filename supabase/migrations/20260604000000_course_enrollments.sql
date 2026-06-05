-- Migration: 20260604000000_course_enrollments.sql
-- Description: Adds a course_enrollments table for students to explicitly join courses during onboarding.

CREATE TABLE IF NOT EXISTS public.course_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(user_id, course_id)
);

ALTER TABLE public.course_enrollments ENABLE ROW LEVEL SECURITY;

-- Students can view their own enrollments
CREATE POLICY "Students can view own enrollments"
ON public.course_enrollments FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Students can insert their own enrollments (e.g. during onboarding)
CREATE POLICY "Students can insert own enrollments"
ON public.course_enrollments FOR INSERT
TO authenticated
WITH CHECK (
    user_id = auth.uid() 
    AND public.has_role(auth.uid(), 'student')
);

-- Professors can view enrollments for their courses
CREATE POLICY "Professors view enrollments for their courses"
ON public.course_enrollments FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.courses c
        WHERE c.id = course_enrollments.course_id
        AND c.professor_id = auth.uid()
    )
);

-- Update courses policy so students can view courses they are explicitly enrolled in
CREATE POLICY "Students view explicitly enrolled courses"
ON public.courses FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.course_enrollments ce
        WHERE ce.course_id = courses.id
          AND ce.user_id = auth.uid()
    )
);

-- Update lectures policy so students can view lectures belonging to explicitly enrolled courses
-- (Assuming they get access to all lectures in a course if they enroll in the course)
CREATE POLICY "Students view lectures for enrolled courses"
ON public.lectures FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.course_enrollments ce
        WHERE ce.course_id = lectures.course_id
          AND ce.user_id = auth.uid()
    )
);
