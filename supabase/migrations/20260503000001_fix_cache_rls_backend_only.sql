-- Cache tables (pdf_parse_cache, slide_embeddings, slide_parse_cache, lecture_blueprints)
-- are backend-only. Only the service role (backend) should be able to read or write them.
-- Public/anon access was previously allowed, which let any browser client poison the cache.
-- Fix: drop all permissive public policies and replace with service_role-only access.

-- ── pdf_parse_cache ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public select on pdf_parse_cache" ON pdf_parse_cache;
DROP POLICY IF EXISTS "Allow public insert on pdf_parse_cache" ON pdf_parse_cache;
DROP POLICY IF EXISTS "Allow public update on pdf_parse_cache" ON pdf_parse_cache;
DROP POLICY IF EXISTS "Allow public upsert on pdf_parse_cache" ON pdf_parse_cache;

CREATE POLICY "Service role select on pdf_parse_cache"
  ON pdf_parse_cache FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role insert on pdf_parse_cache"
  ON pdf_parse_cache FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role update on pdf_parse_cache"
  ON pdf_parse_cache FOR UPDATE
  TO service_role
  USING (true) WITH CHECK (true);

-- ── slide_embeddings ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public select on slide_embeddings" ON slide_embeddings;
DROP POLICY IF EXISTS "Allow public insert on slide_embeddings" ON slide_embeddings;

CREATE POLICY "Service role select on slide_embeddings"
  ON slide_embeddings FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role insert on slide_embeddings"
  ON slide_embeddings FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ── slide_parse_cache ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public select on slide_parse_cache" ON slide_parse_cache;
DROP POLICY IF EXISTS "Allow public insert on slide_parse_cache" ON slide_parse_cache;
DROP POLICY IF EXISTS "Allow public update on slide_parse_cache" ON slide_parse_cache;

CREATE POLICY "Service role select on slide_parse_cache"
  ON slide_parse_cache FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role insert on slide_parse_cache"
  ON slide_parse_cache FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role update on slide_parse_cache"
  ON slide_parse_cache FOR UPDATE
  TO service_role
  USING (true) WITH CHECK (true);

-- ── lecture_blueprints ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow authenticated select on lecture_blueprints" ON public.lecture_blueprints;
DROP POLICY IF EXISTS "Allow insert on lecture_blueprints" ON public.lecture_blueprints;
DROP POLICY IF EXISTS "Allow update on lecture_blueprints" ON public.lecture_blueprints;
DROP POLICY IF EXISTS "Users can view blueprints for their own lectures" ON public.lecture_blueprints;
DROP POLICY IF EXISTS "Professors can insert blueprints" ON public.lecture_blueprints;

CREATE POLICY "Service role select on lecture_blueprints"
  ON public.lecture_blueprints FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role insert on lecture_blueprints"
  ON public.lecture_blueprints FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role update on lecture_blueprints"
  ON public.lecture_blueprints FOR UPDATE
  TO service_role
  USING (true) WITH CHECK (true);
