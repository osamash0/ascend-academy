-- ============================================================================
-- Academic Fingerprint — structured catalog + student linkage
--   * universities / faculties / degree_programs / catalog_courses
--       (institution catalog — DELIBERATELY separate from public.courses, which
--        are professor-authored CONTENT containers)
--   * student_catalog_courses (user × catalog_course × status)
--   * profiles linkage columns (university_id / faculty_id / degree_program_id /
--       current_semester / institution_verified) — free-text profiles.institution
--       is kept as the manual fallback + current social/leaderboard read source.
--   * SECURITY DEFINER RPCs for catalog reads, the onboarding pre-population
--       query, academic-profile writes, and email-domain verification.
-- Idempotent: safe to re-run.
-- ============================================================================

-- Functions reference tables defined later in this same migration; defer body
-- validation so creation order doesn't matter (everything exists at runtime).
SET check_function_bodies = off;

-- ── Catalog tables ────────────────────────────────────────────────────────────
-- Every catalog table carries provenance (source / external_ref) + freshness
-- (last_scraped_at). UNIQUE(source, external_ref) makes scraper upserts idempotent.

CREATE TABLE IF NOT EXISTS public.universities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  country         TEXT,
  city            TEXT,
  email_domains   TEXT[] NOT NULL DEFAULT '{}',  -- drives verification + onboarding default
  source          TEXT NOT NULL DEFAULT 'manual',
  external_ref    TEXT,
  last_scraped_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT universities_source_ref_uniq UNIQUE (source, external_ref)
);
CREATE INDEX IF NOT EXISTS idx_universities_domains
  ON public.universities USING GIN (email_domains);

CREATE TABLE IF NOT EXISTS public.faculties (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id   UUID NOT NULL REFERENCES public.universities(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'manual',
  external_ref    TEXT,
  last_scraped_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT faculties_source_ref_uniq UNIQUE (source, external_ref)
);
CREATE INDEX IF NOT EXISTS idx_faculties_university ON public.faculties (university_id);

CREATE TABLE IF NOT EXISTS public.degree_programs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_id      UUID NOT NULL REFERENCES public.faculties(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,                 -- "Computer Science (B.Sc.)"
  degree_level    TEXT,                          -- 'bachelor' | 'master' | ...
  total_semesters INTEGER,
  source          TEXT NOT NULL DEFAULT 'manual',
  external_ref    TEXT,
  last_scraped_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT degree_programs_source_ref_uniq UNIQUE (source, external_ref)
);
CREATE INDEX IF NOT EXISTS idx_degree_programs_faculty ON public.degree_programs (faculty_id);

-- NOTE: separate from public.courses (professor content containers) by design.
CREATE TABLE IF NOT EXISTS public.catalog_courses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  degree_program_id UUID NOT NULL REFERENCES public.degree_programs(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,               -- "Linear Algebra I"
  course_code       TEXT,                        -- "CS-LA1"
  typical_semester  INTEGER,                     -- 1..N (NULL = elective / unscheduled)
  credits           NUMERIC(4,1),                -- ECTS
  language          TEXT,                        -- 'de' | 'en'
  is_mandatory      BOOLEAN NOT NULL DEFAULT TRUE,
  source            TEXT NOT NULL DEFAULT 'manual',
  external_ref      TEXT,
  last_scraped_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT catalog_courses_source_ref_uniq UNIQUE (source, external_ref)
);
CREATE INDEX IF NOT EXISTS idx_catalog_courses_program_sem
  ON public.catalog_courses (degree_program_id, typical_semester);

-- ── Student academic linkage ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_catalog_courses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  catalog_course_id UUID NOT NULL REFERENCES public.catalog_courses(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'planned'
                      CHECK (status IN ('completed','in_progress','planned')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, catalog_course_id)
);
CREATE INDEX IF NOT EXISTS idx_student_catalog_user   ON public.student_catalog_courses (user_id, status);
CREATE INDEX IF NOT EXISTS idx_student_catalog_course ON public.student_catalog_courses (catalog_course_id);

-- ── Profile linkage columns ─────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS university_id        UUID REFERENCES public.universities(id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS faculty_id           UUID REFERENCES public.faculties(id)       ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS degree_program_id    UUID REFERENCES public.degree_programs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_semester     INTEGER,
  ADD COLUMN IF NOT EXISTS institution_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_university ON public.profiles (university_id);
CREATE INDEX IF NOT EXISTS idx_profiles_program    ON public.profiles (degree_program_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Catalog tables: reference data, public read for any authenticated user.
-- Writes are admin-only; the scraper runs with the service-role key (bypasses RLS).
ALTER TABLE public.universities            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculties               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.degree_programs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_courses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_catalog_courses ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['universities','faculties','degree_programs','catalog_courses'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "catalog read" ON public.%I', t);
    EXECUTE format('CREATE POLICY "catalog read" ON public.%I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('DROP POLICY IF EXISTS "catalog admin write" ON public.%I', t);
    EXECUTE format($f$CREATE POLICY "catalog admin write" ON public.%I FOR ALL TO authenticated
                     USING (public.has_role(auth.uid(), 'admin'))
                     WITH CHECK (public.has_role(auth.uid(), 'admin'))$f$, t);
  END LOOP;
END $$;

-- student_catalog_courses: own rows only (same posture as course_enrollments).
DROP POLICY IF EXISTS "own catalog select" ON public.student_catalog_courses;
CREATE POLICY "own catalog select"
  ON public.student_catalog_courses FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "own catalog write" ON public.student_catalog_courses;
CREATE POLICY "own catalog write"
  ON public.student_catalog_courses FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.has_role(auth.uid(), 'student'));

-- ── Catalog read RPCs ─────────────────────────────────────────────────────────

-- Universities, with email_domains (for the onboarding smart-default) and a flag
-- for whether a usable catalog (>=1 faculty) exists.
CREATE OR REPLACE FUNCTION public.get_universities()
RETURNS TABLE (id UUID, name TEXT, city TEXT, country TEXT, email_domains TEXT[], has_catalog BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT u.id, u.name, u.city, u.country, u.email_domains,
         EXISTS (SELECT 1 FROM public.faculties f WHERE f.university_id = u.id)
  FROM public.universities u
  ORDER BY u.name;
$$;
REVOKE ALL ON FUNCTION public.get_universities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_universities() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_faculties(p_university_id UUID)
RETURNS TABLE (id UUID, name TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT f.id, f.name
  FROM public.faculties f
  WHERE f.university_id = p_university_id
  ORDER BY f.name;
$$;
REVOKE ALL ON FUNCTION public.get_faculties(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_faculties(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_degree_programs(p_faculty_id UUID)
RETURNS TABLE (id UUID, name TEXT, degree_level TEXT, total_semesters INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT dp.id, dp.name, dp.degree_level, dp.total_semesters
  FROM public.degree_programs dp
  WHERE dp.faculty_id = p_faculty_id
  ORDER BY dp.name;
$$;
REVOKE ALL ON FUNCTION public.get_degree_programs(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_degree_programs(UUID) TO authenticated;

-- Core onboarding pre-population query. Returns ALL courses for the program with
-- a derived suggested_status + pre_checked flag (the UI groups + pre-ticks).
--   typical_semester < current  → 'completed'  (pre-checked)
--   typical_semester = current  → 'in_progress'(pre-checked)
--   typical_semester > current  → 'planned'    (not pre-checked)
--   typical_semester IS NULL    → 'planned'    (elective, not pre-checked)
CREATE OR REPLACE FUNCTION public.get_suggested_courses(
  p_program_id       UUID,
  p_current_semester INTEGER
)
RETURNS TABLE (
  id               UUID,
  title            TEXT,
  course_code      TEXT,
  typical_semester INTEGER,
  credits          NUMERIC,
  language         TEXT,
  is_mandatory     BOOLEAN,
  suggested_status TEXT,
  pre_checked      BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    c.id, c.title, c.course_code, c.typical_semester, c.credits, c.language, c.is_mandatory,
    CASE
      WHEN c.typical_semester IS NULL                       THEN 'planned'
      WHEN c.typical_semester <  p_current_semester         THEN 'completed'
      WHEN c.typical_semester =  p_current_semester         THEN 'in_progress'
      ELSE 'planned'
    END AS suggested_status,
    (c.typical_semester IS NOT NULL AND c.typical_semester <= p_current_semester) AS pre_checked
  FROM public.catalog_courses c
  WHERE c.degree_program_id = p_program_id
  ORDER BY c.typical_semester NULLS LAST, c.title;
$$;
REVOKE ALL ON FUNCTION public.get_suggested_courses(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_suggested_courses(UUID, INTEGER) TO authenticated;

-- The signed-in user's confirmed academic courses (for dashboard / profile).
CREATE OR REPLACE FUNCTION public.get_my_catalog_courses()
RETURNS TABLE (
  catalog_course_id UUID,
  title             TEXT,
  course_code       TEXT,
  typical_semester  INTEGER,
  status            TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.id, c.title, c.course_code, c.typical_semester, scc.status
  FROM public.student_catalog_courses scc
  JOIN public.catalog_courses c ON c.id = scc.catalog_course_id
  WHERE scc.user_id = auth.uid()
  ORDER BY c.typical_semester NULLS LAST, c.title;
$$;
REVOKE ALL ON FUNCTION public.get_my_catalog_courses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_catalog_courses() TO authenticated;

-- ── Academic-profile writes ─────────────────────────────────────────────────

-- Set the caller's structured academic profile + mirror institution to the
-- free-text column so existing social/leaderboard reads stay consistent.
CREATE OR REPLACE FUNCTION public.set_academic_profile(
  p_university_id UUID,
  p_faculty_id    UUID,
  p_program_id    UUID,
  p_current_semester INTEGER
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _me        UUID := auth.uid();
  _uni_name  TEXT;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Validate the hierarchy: faculty belongs to university, program to faculty.
  IF p_university_id IS NOT NULL THEN
    SELECT name INTO _uni_name FROM public.universities WHERE id = p_university_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown university'; END IF;
  END IF;
  IF p_faculty_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.faculties f
       WHERE f.id = p_faculty_id AND f.university_id = p_university_id) THEN
    RAISE EXCEPTION 'Faculty does not belong to university';
  END IF;
  IF p_program_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.degree_programs dp
       WHERE dp.id = p_program_id AND dp.faculty_id = p_faculty_id) THEN
    RAISE EXCEPTION 'Program does not belong to faculty';
  END IF;

  UPDATE public.profiles
     SET university_id     = p_university_id,
         faculty_id        = p_faculty_id,
         degree_program_id = p_program_id,
         current_semester  = p_current_semester,
         institution       = COALESCE(_uni_name, institution)
   WHERE user_id = _me;
END;
$$;
REVOKE ALL ON FUNCTION public.set_academic_profile(UUID, UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_academic_profile(UUID, UUID, UUID, INTEGER) TO authenticated;

-- Bulk upsert the caller's catalog-course statuses.
-- p_items: [{ "catalog_course_id": "<uuid>", "status": "completed|in_progress|planned" }, ...]
CREATE OR REPLACE FUNCTION public.confirm_catalog_courses(p_items JSONB)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _me    UUID := auth.uid();
  _count INTEGER := 0;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RETURN 0; END IF;

  INSERT INTO public.student_catalog_courses (user_id, catalog_course_id, status)
  SELECT _me,
         (item->>'catalog_course_id')::UUID,
         COALESCE(NULLIF(item->>'status',''), 'planned')
  FROM jsonb_array_elements(p_items) AS item
  WHERE (item->>'catalog_course_id') IS NOT NULL
    AND COALESCE(NULLIF(item->>'status',''), 'planned') IN ('completed','in_progress','planned')
  ON CONFLICT (user_id, catalog_course_id)
  DO UPDATE SET status = EXCLUDED.status, updated_at = now();

  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_catalog_courses(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_catalog_courses(JSONB) TO authenticated;

-- ── Institution email verification ──────────────────────────────────────────
-- Match the caller's CONFIRMED email domain against universities.email_domains.
-- Gated on auth.users.email_confirmed_at so an unconfirmed signup can't claim it.
CREATE OR REPLACE FUNCTION public.verify_my_institution()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _me           UUID := auth.uid();
  _email        TEXT;
  _confirmed_at TIMESTAMPTZ;
  _domain       TEXT;
  _uni_id       UUID;
  _profile_uni  UUID;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT email, email_confirmed_at INTO _email, _confirmed_at
  FROM auth.users WHERE id = _me;

  IF _email IS NULL OR _confirmed_at IS NULL OR _email NOT LIKE '%@%' THEN
    RETURN FALSE;  -- unconfirmed or malformed email — cannot verify
  END IF;

  _domain := lower(substring(_email from '@(.*)$'));

  SELECT id INTO _uni_id
  FROM public.universities
  WHERE _domain = ANY (email_domains)
  LIMIT 1;

  IF _uni_id IS NULL THEN RETURN FALSE; END IF;

  -- Only verify when the matched university agrees with the chosen profile
  -- (or set it if the profile hasn't chosen one yet).
  SELECT university_id INTO _profile_uni FROM public.profiles WHERE user_id = _me;
  IF _profile_uni IS NOT NULL AND _profile_uni <> _uni_id THEN
    RETURN FALSE;
  END IF;

  UPDATE public.profiles
     SET institution_verified = TRUE,
         university_id = COALESCE(university_id, _uni_id)
   WHERE user_id = _me;

  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.verify_my_institution() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_my_institution() TO authenticated;

-- ── Backfill: where a profile already resolves to a structured university,
-- keep the free-text institution string consistent with the canonical name. ──
UPDATE public.profiles p
   SET institution = u.name
  FROM public.universities u
 WHERE p.university_id = u.id
   AND (p.institution IS DISTINCT FROM u.name);
