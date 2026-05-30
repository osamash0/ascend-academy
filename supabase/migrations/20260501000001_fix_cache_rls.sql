-- pdf_parse_cache and slide_embeddings are backend-only cache tables.
-- The backend uses the anon key (no service role key configured), so we need
-- permissive policies to allow the backend to read and write these tables.

-- pdf_parse_cache
ALTER TABLE IF EXISTS pdf_parse_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public select on pdf_parse_cache" ON pdf_parse_cache;
DROP POLICY IF EXISTS "Allow public insert on pdf_parse_cache" ON pdf_parse_cache;
DROP POLICY IF EXISTS "Allow public update on pdf_parse_cache" ON pdf_parse_cache;

CREATE POLICY "Allow public select on pdf_parse_cache"
  ON pdf_parse_cache FOR SELECT USING (true);

CREATE POLICY "Allow public insert on pdf_parse_cache"
  ON pdf_parse_cache FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update on pdf_parse_cache"
  ON pdf_parse_cache FOR UPDATE USING (true) WITH CHECK (true);

-- slide_embeddings
ALTER TABLE IF EXISTS slide_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public select on slide_embeddings" ON slide_embeddings;
DROP POLICY IF EXISTS "Allow public insert on slide_embeddings" ON slide_embeddings;

CREATE POLICY "Allow public select on slide_embeddings"
  ON slide_embeddings FOR SELECT USING (true);

CREATE POLICY "Allow public insert on slide_embeddings"
  ON slide_embeddings FOR INSERT WITH CHECK (true);
