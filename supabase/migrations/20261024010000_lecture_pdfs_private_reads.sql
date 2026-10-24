-- lecture-pdfs: private bucket, reads follow lesson visibility.
--
-- Prod drifted: 20260503000002 (which did exactly this) was never applied
-- there. Found 2026-10-24 by a pg_catalog probe: the bucket was still
-- `public = true` and a "Public Access" SELECT policy for role `public` let
-- anyone — signed in or not — list the bucket with the anon key and download
-- every lecture PDF, including private student uploads. On a fresh database
-- this migration is a no-op re-assertion.
--
-- Safe to apply before any frontend deploy: every client path reads PDFs
-- through createSignedUrl (lectureService.resolvePdfUrl) and the backend uses
-- the service role; legacy `/object/public/...` values in lectures.pdf_url
-- are re-signed by extractStoragePath. Signing needs a SELECT policy for the
-- caller, which "Read lecture PDFs respecting lecture visibility"
-- (20261024000000) provides for every lesson the caller can see.
--
-- Prod's migration ledger is unreliable: apply by hand, verify in pg_catalog.

UPDATE storage.buckets SET public = false WHERE id = 'lecture-pdfs';

-- Drop "Public Access" only if it is the lecture-pdfs policy (policy names
-- are per table; never remove a same-named policy guarding another bucket).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Public Access'
          AND coalesce(qual, '') ILIKE '%lecture-pdfs%'
    ) THEN
        DROP POLICY "Public Access" ON storage.objects;
    END IF;
END $$;

-- The scoped read policy from 20261024000000, re-asserted so this file is
-- complete on its own if applied out of order.
DROP POLICY IF EXISTS "Read lecture PDFs respecting lecture visibility" ON storage.objects;
CREATE POLICY "Read lecture PDFs respecting lecture visibility"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'lecture-pdfs'
    AND (
        CASE
            WHEN (string_to_array(name, '/'))[1] = 'lectures'
             AND (string_to_array(name, '/'))[2] ~ '^[0-9a-fA-F-]{36}$'
            THEN public.lecture_visible_to_caller(((string_to_array(name, '/'))[2])::uuid)
            ELSE true
        END
    )
);
