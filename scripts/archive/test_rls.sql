BEGIN;
-- Simulate user session
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "e40387b1-c1d3-47d8-ac33-bf195c9cc383", "role": "authenticated"}';

-- Query what the UI queries
SELECT id, title, course_id FROM public.lectures WHERE is_archived = false;

SELECT count(*) FROM public.course_enrollments WHERE user_id = 'e40387b1-c1d3-47d8-ac33-bf195c9cc383';
ROLLBACK;
