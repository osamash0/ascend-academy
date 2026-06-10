-- ============================================================================
-- Make real users discoverable in Friends.
-- The social RPCs key off profiles.display_name (and the client falls back to
-- "Learner" when it's null). Onboarding only ever set full_name, so every
-- existing user showed as "Learner" and was unsearchable by name.
-- Backfill display_name from full_name wherever it's missing. Onboarding is
-- updated to set display_name on new signups going forward.
-- Idempotent.
-- ============================================================================

UPDATE public.profiles
   SET display_name = btrim(full_name)
 WHERE (display_name IS NULL OR btrim(display_name) = '')
   AND full_name IS NOT NULL AND btrim(full_name) <> '';
