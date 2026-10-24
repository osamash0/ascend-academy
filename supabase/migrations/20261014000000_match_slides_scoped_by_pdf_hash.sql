-- ─────────────────────────────────────────────────────────────────────────────
-- Course-scoped slide search finds slides by the PDF they came from.
--
-- match_slides_scoped (20260710030000) joined slide_embeddings to lectures on
-- se.lecture_id. But embeddings are content-addressed: the parser and
-- backfill_slide_embeddings.py store them by (pdf_hash, slide_index,
-- pipeline_version) and usually leave lecture_id NULL — on 2026-10-11, 40 of
-- Softwaretechnik's 68 rows had none, and the rest named duplicate lectures
-- in archived courses. So the course tutor and global search saw almost
-- nothing: "Why do teams use version control?" found zero slides in a course
-- with a whole lecture on it, and the tutor answered "this doesn't appear in
-- your course materials".
--
-- Now an embedding belongs to an in-scope lecture if it carries that
-- lecture's pdf_hash OR its id (rows stored either way exist), live lectures
-- in the given courses only, and each slide is returned once — its best row,
-- should several pipeline versions or two in-scope uploads of one PDF exist.
-- Signature and result columns are unchanged; lecture_id is now always the
-- in-scope lecture the slide was found through.
-- ─────────────────────────────────────────────────────────────────────────────

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
LANGUAGE sql
STABLE
AS $$
  WITH scoped AS (
    SELECT l.id, l.course_id, l.pdf_hash, l.created_at
    FROM lectures l
    WHERE l.course_id = ANY(scoped_course_ids)
      AND NOT COALESCE(l.is_archived, false)
  ),
  per_slide AS (
    SELECT DISTINCT ON (COALESCE(se.pdf_hash, se.lecture_id::text), se.slide_index)
      se.id,
      s.id AS lecture_id,
      s.course_id,
      se.slide_index,
      se.metadata,
      se.content_hash,
      1 - (se.embedding <=> query_embedding) AS similarity
    FROM slide_embeddings se
    JOIN scoped s ON se.pdf_hash = s.pdf_hash OR se.lecture_id = s.id
    ORDER BY COALESCE(se.pdf_hash, se.lecture_id::text), se.slide_index,
             se.embedding <=> query_embedding, s.created_at
  )
  SELECT id, lecture_id, course_id, slide_index, metadata, content_hash, similarity
  FROM per_slide
  WHERE similarity > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
