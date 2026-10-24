-- lecture-pdfs: only a lesson's owner may write its PDF.
--
-- Prod still carried the 2026-02 policies "Professors can upload/update/delete
-- PDFs": ANY professor could overwrite or delete ANY lecture PDF. They are
-- replaced by owner-scoped policies that also cover student owners of
-- private uploads (professor_id OR student_owner_id = auth.uid()).
--
-- ORDER MATTERS on prod: apply only AFTER the frontend that inserts the
-- lecture row before uploading its PDF (useLectureSubmit) is deployed. The
-- older client uploaded first, which only the broad policy allowed.
--
-- A non-uuid second path segment makes the predicate false instead of
-- raising a cast error.
--
-- Prod's migration ledger is unreliable: apply by hand, verify in pg_catalog.

DO $$
DECLARE
    p text;
BEGIN
    FOREACH p IN ARRAY ARRAY[
        'Professors can upload PDFs', 'Professors can update PDFs', 'Professors can delete PDFs'
    ] LOOP
        IF EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = p
              AND (coalesce(qual, '') || coalesce(with_check, '')) ILIKE '%lecture-pdfs%'
        ) THEN
            EXECUTE format('DROP POLICY %I ON storage.objects', p);
        END IF;
    END LOOP;
END $$;

-- Previous owner-scoped variants, under both names they have had (repo:
-- "Professors can ... for owned lectures", prod: "Owners can ... for owned lectures").
DROP POLICY IF EXISTS "Professors can upload PDFs for owned lectures" ON storage.objects;
DROP POLICY IF EXISTS "Professors can update PDFs for owned lectures" ON storage.objects;
DROP POLICY IF EXISTS "Professors can delete PDFs for owned lectures" ON storage.objects;
DROP POLICY IF EXISTS "Owners can upload PDFs for owned lectures" ON storage.objects;
DROP POLICY IF EXISTS "Owners can update PDFs for owned lectures" ON storage.objects;
DROP POLICY IF EXISTS "Owners can delete PDFs for owned lectures" ON storage.objects;

DROP POLICY IF EXISTS "Lesson owners upload their PDFs" ON storage.objects;
CREATE POLICY "Lesson owners upload their PDFs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'lecture-pdfs'
    AND (string_to_array(name, '/'))[1] = 'lectures'
    AND (string_to_array(name, '/'))[2] ~ '^[0-9a-fA-F-]{36}$'
    AND EXISTS (
        SELECT 1 FROM public.lectures l
        WHERE l.id = ((string_to_array(name, '/'))[2])::uuid
          AND (l.professor_id = auth.uid() OR l.student_owner_id = auth.uid())
    )
);

DROP POLICY IF EXISTS "Lesson owners update their PDFs" ON storage.objects;
CREATE POLICY "Lesson owners update their PDFs"
ON storage.objects FOR UPDATE TO authenticated
USING (
    bucket_id = 'lecture-pdfs'
    AND (string_to_array(name, '/'))[1] = 'lectures'
    AND (string_to_array(name, '/'))[2] ~ '^[0-9a-fA-F-]{36}$'
    AND EXISTS (
        SELECT 1 FROM public.lectures l
        WHERE l.id = ((string_to_array(name, '/'))[2])::uuid
          AND (l.professor_id = auth.uid() OR l.student_owner_id = auth.uid())
    )
);

DROP POLICY IF EXISTS "Lesson owners delete their PDFs" ON storage.objects;
CREATE POLICY "Lesson owners delete their PDFs"
ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'lecture-pdfs'
    AND (string_to_array(name, '/'))[1] = 'lectures'
    AND (string_to_array(name, '/'))[2] ~ '^[0-9a-fA-F-]{36}$'
    AND EXISTS (
        SELECT 1 FROM public.lectures l
        WHERE l.id = ((string_to_array(name, '/'))[2])::uuid
          AND (l.professor_id = auth.uid() OR l.student_owner_id = auth.uid())
    )
);
