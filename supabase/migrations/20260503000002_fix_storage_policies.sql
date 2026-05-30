-- lecture-pdfs bucket: make private and scope write access to owning professor.
-- Previously: public bucket (anyone with URL can read), any professor can write anywhere.
-- Fix: private bucket (authenticated read only), write restricted to owning professor.

-- Make bucket private
UPDATE storage.buckets
SET public = false
WHERE id = 'lecture-pdfs';

-- Drop all existing storage policies for this bucket
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Professors can upload PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Professors can update PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Professors can delete PDFs" ON storage.objects;

-- Allow authenticated users to read PDFs (lectures are accessible to all logged-in users)
CREATE POLICY "Authenticated users can read lecture PDFs"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'lecture-pdfs');

-- Allow professors to upload PDFs only for lectures they own.
-- Path format: lectures/{lectureId}/{filename}
-- We extract the lectureId segment and verify ownership in the lectures table.
CREATE POLICY "Professors can upload PDFs for owned lectures"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'lecture-pdfs'
    AND public.has_role(auth.uid(), 'professor')
    AND EXISTS (
        SELECT 1 FROM public.lectures
        WHERE id = (string_to_array(name, '/'))[2]::uuid
          AND professor_id = auth.uid()
    )
);

-- Allow professors to update PDFs only for lectures they own.
CREATE POLICY "Professors can update PDFs for owned lectures"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'lecture-pdfs'
    AND public.has_role(auth.uid(), 'professor')
    AND EXISTS (
        SELECT 1 FROM public.lectures
        WHERE id = (string_to_array(name, '/'))[2]::uuid
          AND professor_id = auth.uid()
    )
);

-- Allow professors to delete PDFs only for lectures they own.
CREATE POLICY "Professors can delete PDFs for owned lectures"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'lecture-pdfs'
    AND public.has_role(auth.uid(), 'professor')
    AND EXISTS (
        SELECT 1 FROM public.lectures
        WHERE id = (string_to_array(name, '/'))[2]::uuid
          AND professor_id = auth.uid()
    )
);
