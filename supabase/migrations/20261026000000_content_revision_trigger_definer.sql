-- LS-112: an account that owns lessons could not be deleted.
--
-- Supabase Auth deletes a user as `supabase_auth_admin`. The FK cascade from
-- auth.users runs as each table's owner, but the AFTER triggers it queues
-- fire under the role that issued the DELETE. `bump_lecture_content_revision`
-- (AFTER DELETE on slides and quiz_questions) was the one trigger in that
-- chain without SECURITY DEFINER; it UPDATEs public.lectures, which
-- supabase_auth_admin may not touch, so Auth answered "Database error
-- deleting user" for anyone who owned slides. Its siblings
-- (invalidate_course_overview_on_*) are already SECURITY DEFINER.
--
-- Trigger functions cannot be called directly, so running as the owner adds
-- no new entry point; the grants are closed anyway, like its siblings.

ALTER FUNCTION public.bump_lecture_content_revision() SECURITY DEFINER;
ALTER FUNCTION public.bump_lecture_content_revision() SET search_path = public;
REVOKE ALL ON FUNCTION public.bump_lecture_content_revision() FROM PUBLIC, anon, authenticated;
