-- Atomic upsert for course_visits: bump last_visited_at + increment visit_count.
-- Called from the client via supabase.rpc('upsert_course_visit', {...}).
-- Falls back silently if the course_visits table does not yet exist.

CREATE OR REPLACE FUNCTION public.upsert_course_visit(
    p_user_id   UUID,
    p_course_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.course_visits (user_id, course_id, last_visited_at, visit_count)
    VALUES (p_user_id, p_course_id, now(), 1)
    ON CONFLICT (user_id, course_id)
    DO UPDATE SET
        last_visited_at = now(),
        visit_count     = course_visits.visit_count + 1;
END;
$$;

-- Only the authenticated user may call this for themselves.
REVOKE ALL ON FUNCTION public.upsert_course_visit(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_course_visit(UUID, UUID) TO authenticated;
