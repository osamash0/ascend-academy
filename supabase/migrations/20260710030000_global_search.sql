-- Migration: 20260710030000_global_search.sql
-- Description: Course-scoped semantic + keyword retrieval for feature 2.2
-- "Global semantic search + course-wide tutor". The existing `match_slides`
-- RPC has no course/enrollment filter — it is a global ANN scan that the
-- Python layer post-filters by a single lecture_id/pdf_hash. Un-scoping
-- retrieval to "any lecture in these course_ids" needs the filter pushed
-- into SQL (a Python post-filter over an unbounded ANN scan would silently
-- drop enrolled-course hits whenever the candidate window fills up with
-- other courses' slides).

-- 1. Course-scoped vector similarity search.
CREATE OR REPLACE FUNCTION match_slides_scoped (
  query_embedding vector(768),
  scoped_course_ids uuid[],
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id uuid,
  lecture_id uuid,
  course_id uuid,
  slide_index int,
  metadata jsonb,
  content_hash text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    se.id,
    se.lecture_id,
    l.course_id,
    se.slide_index,
    se.metadata,
    se.content_hash,
    1 - (se.embedding <=> query_embedding) AS similarity
  FROM slide_embeddings se
  JOIN lectures l ON l.id = se.lecture_id
  WHERE l.course_id = ANY(scoped_course_ids)
    AND l.is_archived = false
    AND 1 - (se.embedding <=> query_embedding) > match_threshold
  ORDER BY se.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 2. Full-text keyword fallback over slide title/content, same scope.
CREATE INDEX IF NOT EXISTS slides_fts_idx
  ON public.slides USING gin (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content_text, ''))
  );

CREATE OR REPLACE FUNCTION search_slides_keyword (
  search_query text,
  scoped_course_ids uuid[],
  match_count int
)
RETURNS TABLE (
  id uuid,
  lecture_id uuid,
  course_id uuid,
  slide_index int,
  title text,
  content_text text,
  rank float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.lecture_id,
    l.course_id,
    s.slide_number - 1 AS slide_index,
    s.title,
    s.content_text,
    ts_rank(
      to_tsvector('english', coalesce(s.title, '') || ' ' || coalesce(s.content_text, '')),
      websearch_to_tsquery('english', search_query)
    )::double precision AS rank
  FROM public.slides s
  JOIN public.lectures l ON l.id = s.lecture_id
  WHERE l.course_id = ANY(scoped_course_ids)
    AND l.is_archived = false
    AND to_tsvector('english', coalesce(s.title, '') || ' ' || coalesce(s.content_text, ''))
        @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC
  LIMIT match_count;
END;
$$;

-- 3. Keyword search over lecture titles, scoped to course.
CREATE OR REPLACE FUNCTION search_lectures_keyword (
  search_query text,
  scoped_course_ids uuid[],
  match_count int
)
RETURNS TABLE (
  id uuid,
  course_id uuid,
  title text,
  description text
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT l.id, l.course_id, l.title, l.description
  FROM public.lectures l
  WHERE l.course_id = ANY(scoped_course_ids)
    AND l.is_archived = false
    AND (l.title ILIKE '%' || search_query || '%' OR l.description ILIKE '%' || search_query || '%')
  ORDER BY l.title
  LIMIT match_count;
END;
$$;

-- 4. Keyword search over canonical concepts touching an in-scope lecture.
CREATE OR REPLACE FUNCTION search_concepts_keyword (
  search_query text,
  scoped_course_ids uuid[],
  match_count int
)
RETURNS TABLE (
  id uuid,
  canonical_name text,
  lecture_id uuid,
  course_id uuid
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT c.id, c.canonical_name, cl.lecture_id, l.course_id
  FROM public.concepts c
  JOIN public.concept_lectures cl ON cl.concept_id = c.id
  JOIN public.lectures l ON l.id = cl.lecture_id
  WHERE l.course_id = ANY(scoped_course_ids)
    AND l.is_archived = false
    AND c.canonical_name ILIKE '%' || search_query || '%'
  ORDER BY c.canonical_name
  LIMIT match_count;
END;
$$;

-- 5. Keyword search over published worksheets (practice sheets), scoped to course.
CREATE OR REPLACE FUNCTION search_worksheets_keyword (
  search_query text,
  scoped_course_ids uuid[],
  match_count int
)
RETURNS TABLE (
  id uuid,
  title text,
  lecture_id uuid,
  course_id uuid
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT ps.id, ps.title, ps.lecture_id, l.course_id
  FROM public.practice_sheets ps
  JOIN public.lectures l ON l.id = ps.lecture_id
  WHERE l.course_id = ANY(scoped_course_ids)
    AND l.is_archived = false
    AND ps.status = 'published'
    AND ps.title ILIKE '%' || search_query || '%'
  ORDER BY ps.title
  LIMIT match_count;
END;
$$;
