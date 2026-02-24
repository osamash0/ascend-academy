-- Ensure the storage bucket exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('lecture-pdfs', 'lecture-pdfs', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Allow public access to read PDFs
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'lecture-pdfs');

-- Allow authenticated users (professors) to upload PDFs
CREATE POLICY "Professors can upload PDFs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'lecture-pdfs' AND
    (SELECT public.has_role(auth.uid(), 'professor'))
);

-- Allow professors to update their own PDFs (by checking the path starts with lectures/lectureId/ where they are the owner)
-- For simplicity, we allow all professors to update/delete in this bucket for now, 
-- but a stricter check would involve matching the professor_id in the lectures table.
CREATE POLICY "Professors can update PDFs"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'lecture-pdfs' AND
    (SELECT public.has_role(auth.uid(), 'professor'))
);

CREATE POLICY "Professors can delete PDFs"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'lecture-pdfs' AND
    (SELECT public.has_role(auth.uid(), 'professor'))
);
