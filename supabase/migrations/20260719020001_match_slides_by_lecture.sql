-- match_slides_by_lecture: SQL-scoped retrieval for the single-lecture tutor
-- (Roadmap Foundation 10x, Phase 1 P1-4).
--
-- Before this migration, backend/services/ai/retrieval.py's
-- retrieve_relevant_slides() called the UNSCOPED `match_slides` RPC with a
-- generous candidate window (limit = k*4) and then filtered to the target
-- lecture_id/pdf_hash IN PYTHON. That is a global ANN scan over every
-- slide_embeddings row in the database — the exact failure mode already
-- fixed for the course-wide tutor path via `match_slides_scoped`
-- (20260710030000_global_search.sql, whose own comment explains why: "a
-- Python post-filter over an unbounded ANN scan would silently drop
-- enrolled-course hits whenever the candidate window fills up with other
-- courses' slides"). At 10x corpus size the same thing happens here: the
-- global top-(k*4) fills with other lectures' slides and the target
-- lecture's relevant slides silently stop appearing, even though they'd
-- easily clear the similarity threshold within their own lecture.
--
-- This mirrors match_slides_scoped's shape but scopes by lecture_id OR
-- pdf_hash (retrieval.py supports being called with either, depending on
-- whether the lecture has been persisted yet) instead of course_ids.

CREATE OR REPLACE FUNCTION match_slides_by_lecture (
  query_embedding vector(768),
  p_lecture_id uuid,
  p_pdf_hash text,
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id uuid,
  lecture_id uuid,
  pdf_hash text,
  slide_index int,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    se.id,
    se.lecture_id,
    se.pdf_hash,
    se.slide_index,
    1 - (se.embedding <=> query_embedding) AS similarity
  FROM slide_embeddings se
  WHERE (
          (p_lecture_id IS NOT NULL AND se.lecture_id = p_lecture_id)
       OR (p_pdf_hash IS NOT NULL AND se.pdf_hash = p_pdf_hash)
        )
    AND 1 - (se.embedding <=> query_embedding) > match_threshold
  ORDER BY se.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

REVOKE ALL ON FUNCTION match_slides_by_lecture(vector, uuid, text, float, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_slides_by_lecture(vector, uuid, text, float, int) TO service_role;
