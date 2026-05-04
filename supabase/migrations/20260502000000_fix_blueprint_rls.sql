-- lecture_blueprints is a backend-only cache keyed by pdf_hash.
-- The backend writes via the service role key, but if only the anon key is
-- available the restrictive INSERT policy blocks writes. Add permissive
-- policies that mirror the pattern used for pdf_parse_cache.

-- Allow any authenticated or service-role caller to read blueprints.
DROP POLICY IF EXISTS "Users can view blueprints for their own lectures" ON public.lecture_blueprints;
CREATE POLICY "Allow authenticated select on lecture_blueprints"
  ON public.lecture_blueprints FOR SELECT
  TO authenticated
  USING (true);

-- Allow backend (any role) to insert new blueprints.
DROP POLICY IF EXISTS "Professors can insert blueprints" ON public.lecture_blueprints;
CREATE POLICY "Allow insert on lecture_blueprints"
  ON public.lecture_blueprints FOR INSERT
  WITH CHECK (true);

-- Allow backend to update existing blueprints (upsert requires UPDATE permission).
DROP POLICY IF EXISTS "Allow update on lecture_blueprints" ON public.lecture_blueprints;
CREATE POLICY "Allow update on lecture_blueprints"
  ON public.lecture_blueprints FOR UPDATE
  USING (true) WITH CHECK (true);

-- Ensure pdf_parse_cache also has an UPDATE policy so upsert works end-to-end.
-- (The previous migration only added SELECT and INSERT.)
DROP POLICY IF EXISTS "Allow public upsert on pdf_parse_cache" ON pdf_parse_cache;
CREATE POLICY "Allow public upsert on pdf_parse_cache"
  ON pdf_parse_cache FOR UPDATE
  USING (true) WITH CHECK (true);
