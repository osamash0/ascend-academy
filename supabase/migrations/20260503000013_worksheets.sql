-- Worksheets: supporting files (PDF/doc) attached to a lecture.
--
-- Each worksheet is a single uploaded file in a private storage bucket
-- (`worksheets`). The DB row carries metadata only — title, the storage
-- path (file_url), MIME type, size, uploader. The owning professor of
-- the parent lecture is the only writer; students who can see the
-- lecture via an assignment enrollment can read.

CREATE TABLE IF NOT EXISTS public.worksheets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lecture_id UUID REFERENCES public.lectures(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    file_url TEXT NOT NULL,             -- storage path inside the `worksheets` bucket
    file_type TEXT,                     -- MIME type, e.g. "application/pdf"
    size_bytes BIGINT,
    uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.worksheets ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS worksheets_lecture_idx
    ON public.worksheets(lecture_id);

-- Owning professor manages worksheets on their own lectures.
DROP POLICY IF EXISTS "Professors manage worksheets on their lectures" ON public.worksheets;
CREATE POLICY "Professors manage worksheets on their lectures"
ON public.worksheets FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.lectures l
        WHERE l.id = worksheets.lecture_id
          AND l.professor_id = auth.uid()
    )
    AND public.has_role(auth.uid(), 'professor')
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.lectures l
        WHERE l.id = worksheets.lecture_id
          AND l.professor_id = auth.uid()
    )
    AND public.has_role(auth.uid(), 'professor')
);

-- Students enrolled (via an assignment) in a lecture can SELECT its worksheets.
DROP POLICY IF EXISTS "Enrolled students view worksheets" ON public.worksheets;
CREATE POLICY "Enrolled students view worksheets"
ON public.worksheets FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.assignment_lectures al
        JOIN public.assignment_enrollments ae ON ae.assignment_id = al.assignment_id
        WHERE al.lecture_id = worksheets.lecture_id
          AND ae.user_id = auth.uid()
    )
);


-- ── Storage bucket + policies ───────────────────────────────────────────────
-- Private bucket, mirroring the `lecture-pdfs` setup. Path convention is
-- `worksheets/{lectureId}/{worksheetId}_{filename}` so RLS can extract the
-- lecture id from path segment 2 just like lecture-pdfs does.

INSERT INTO storage.buckets (id, name, public)
VALUES ('worksheets', 'worksheets', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Authenticated users can read worksheets" ON storage.objects;
CREATE POLICY "Authenticated users can read worksheets"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'worksheets'
    AND (
        EXISTS (
            SELECT 1 FROM public.lectures l
            WHERE l.id = (string_to_array(name, '/'))[2]::uuid
              AND l.professor_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1
            FROM public.assignment_lectures al
            JOIN public.assignment_enrollments ae ON ae.assignment_id = al.assignment_id
            WHERE al.lecture_id = (string_to_array(name, '/'))[2]::uuid
              AND ae.user_id = auth.uid()
        )
    )
);

DROP POLICY IF EXISTS "Professors can upload worksheets for owned lectures" ON storage.objects;
CREATE POLICY "Professors can upload worksheets for owned lectures"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'worksheets'
    AND public.has_role(auth.uid(), 'professor')
    AND EXISTS (
        SELECT 1 FROM public.lectures l
        WHERE l.id = (string_to_array(name, '/'))[2]::uuid
          AND l.professor_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Professors can update worksheets for owned lectures" ON storage.objects;
CREATE POLICY "Professors can update worksheets for owned lectures"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'worksheets'
    AND public.has_role(auth.uid(), 'professor')
    AND EXISTS (
        SELECT 1 FROM public.lectures l
        WHERE l.id = (string_to_array(name, '/'))[2]::uuid
          AND l.professor_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Professors can delete worksheets for owned lectures" ON storage.objects;
CREATE POLICY "Professors can delete worksheets for owned lectures"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'worksheets'
    AND public.has_role(auth.uid(), 'professor')
    AND EXISTS (
        SELECT 1 FROM public.lectures l
        WHERE l.id = (string_to_array(name, '/'))[2]::uuid
          AND l.professor_id = auth.uid()
    )
);
