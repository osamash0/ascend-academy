-- ============================================================================
-- Course recommendations — catalog ↔ platform course mapping (hybrid).
--   * catalog_course_links: OPTIONAL curated mapping (admin-populated). Boosts
--       precision but is not required — recommendations work with zero rows.
--   * get_recommended_courses(): blends (a) curated links, (b) title similarity
--       (pg_trgm) between platform courses and the student's catalog courses,
--       and (c) cohort collaborative-filtering (what same-degree-program peers
--       enrolled in). Returns only platform courses with a real signal +
--       excludes ones the student already joined.
-- Idempotent.
-- ============================================================================

SET check_function_bodies = off;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.catalog_course_links (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_course_id UUID NOT NULL REFERENCES public.catalog_courses(id) ON DELETE CASCADE,
  course_id         UUID NOT NULL REFERENCES public.courses(id)         ON DELETE CASCADE,
  confidence        NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  source            TEXT NOT NULL DEFAULT 'manual',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (catalog_course_id, course_id)
);
CREATE INDEX IF NOT EXISTS idx_ccl_catalog ON public.catalog_course_links (catalog_course_id);
CREATE INDEX IF NOT EXISTS idx_ccl_course  ON public.catalog_course_links (course_id);
CREATE INDEX IF NOT EXISTS idx_courses_title_trgm ON public.courses USING GIN (title gin_trgm_ops);

ALTER TABLE public.catalog_course_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "links read" ON public.catalog_course_links;
CREATE POLICY "links read" ON public.catalog_course_links FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "links admin write" ON public.catalog_course_links;
CREATE POLICY "links admin write" ON public.catalog_course_links FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Recommend platform courses for the signed-in student based on their academic
-- fingerprint. Empty when there's no signal (the full catalog is browsed
-- separately), so we never recommend random content.
CREATE OR REPLACE FUNCTION public.get_recommended_courses(p_limit INTEGER DEFAULT 8)
RETURNS TABLE (
  id             UUID,
  title          TEXT,
  description    TEXT,
  color          TEXT,
  icon           TEXT,
  lecture_count  INTEGER,
  reason         TEXT,
  matched_course TEXT,
  score          REAL
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH me AS (
    SELECT degree_program_id FROM public.profiles WHERE user_id = auth.uid()
  ),
  my_catalog AS (
    SELECT DISTINCT cc.title
    FROM public.student_catalog_courses scc
    JOIN public.catalog_courses cc ON cc.id = scc.catalog_course_id
    WHERE scc.user_id = auth.uid()
  ),
  cand AS (
    SELECT c.id, c.title, c.description, c.color, c.icon
    FROM public.courses c
    WHERE COALESCE(c.is_archived, FALSE) = FALSE
      AND NOT EXISTS (SELECT 1 FROM public.course_enrollments e
                      WHERE e.user_id = auth.uid() AND e.course_id = c.id)
  ),
  scored AS (
    SELECT
      c.id, c.title, c.description, c.color, c.icon,
      (SELECT mc.title FROM my_catalog mc
        ORDER BY similarity(c.title, mc.title) DESC NULLS LAST LIMIT 1) AS best_title,
      COALESCE((SELECT MAX(similarity(c.title, mc.title)) FROM my_catalog mc), 0) AS content_sim,
      EXISTS (SELECT 1 FROM public.catalog_course_links l
              JOIN public.student_catalog_courses s
                ON s.catalog_course_id = l.catalog_course_id AND s.user_id = auth.uid()
              WHERE l.course_id = c.id) AS linked,
      (SELECT COUNT(*)::INT FROM public.course_enrollments e
         JOIN public.profiles p2 ON p2.user_id = e.user_id
         CROSS JOIN me
        WHERE e.course_id = c.id
          AND e.user_id <> auth.uid()
          AND me.degree_program_id IS NOT NULL
          AND p2.degree_program_id IS NOT DISTINCT FROM me.degree_program_id) AS cohort_cnt
    FROM cand c
  )
  SELECT
    s.id, s.title, s.description, s.color, s.icon,
    (SELECT COUNT(*)::INT FROM public.lectures lx WHERE lx.course_id = s.id),
    CASE
      WHEN s.linked OR s.content_sim >= 0.3 THEN 'Matches ' || COALESCE(s.best_title, 'your courses')
      WHEN s.cohort_cnt > 0                  THEN 'Popular in your program'
      ELSE 'Recommended for you'
    END,
    s.best_title,
    ((CASE WHEN s.linked THEN 2 ELSE 0 END) + s.content_sim * 1.5 + LEAST(s.cohort_cnt, 5) * 0.3)::REAL
  FROM scored s
  WHERE s.linked OR s.content_sim >= 0.15 OR s.cohort_cnt > 0
  ORDER BY
    ((CASE WHEN s.linked THEN 2 ELSE 0 END) + s.content_sim * 1.5 + LEAST(s.cohort_cnt, 5) * 0.3) DESC,
    s.title
  LIMIT LEAST(p_limit, 50);
$$;
REVOKE ALL ON FUNCTION public.get_recommended_courses(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recommended_courses(INTEGER) TO authenticated;
