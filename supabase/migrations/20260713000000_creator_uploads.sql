-- Creator uploads: let any authenticated user (student or professor) create
-- a course and upload PDF/PPTX lectures into it, not just users with the
-- `professor` role. Ownership already works purely through uid columns
-- (courses.professor_id, lectures.professor_id) — the only real blocker was
-- RLS policies additionally requiring has_role(uid, 'professor'). Drop that
-- extra role check everywhere; keep every ownership check as-is.
--
-- Also adds courses.status (draft/published) so a creator can build privately
-- before making a course visible to others. Existing courses are backfilled
-- to 'published' since they're already live/visible in production — only
-- newly created courses default to 'draft'.

-- ── 1. courses.status ────────────────────────────────────────────────────────

ALTER TABLE public.courses
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published'));

-- Backfill: every course that existed before this migration was already
-- created by a professor and is in active use — treat it as published so
-- nothing already-live disappears from students' view.
UPDATE public.courses SET status = 'published' WHERE status = 'draft';

-- ── 2. courses RLS: drop the professor-role requirement ─────────────────────

DROP POLICY IF EXISTS "Professors manage their own courses" ON public.courses;
CREATE POLICY "Owners manage their own courses"
ON public.courses FOR ALL
TO authenticated
USING (professor_id = auth.uid())
WITH CHECK (professor_id = auth.uid());

-- ── 3. lectures RLS: drop the professor-role requirement ────────────────────

DROP POLICY IF EXISTS "Professors can create lectures" ON public.lectures;
CREATE POLICY "Owners can create lectures"
ON public.lectures FOR INSERT
TO authenticated
WITH CHECK (professor_id = auth.uid());

DROP POLICY IF EXISTS "Professors can update their own lectures" ON public.lectures;
CREATE POLICY "Owners can update their own lectures"
ON public.lectures FOR UPDATE
TO authenticated
USING (professor_id = auth.uid());

DROP POLICY IF EXISTS "Professors can delete their own lectures" ON public.lectures;
CREATE POLICY "Owners can delete their own lectures"
ON public.lectures FOR DELETE
TO authenticated
USING (professor_id = auth.uid());

DROP POLICY IF EXISTS "Professors view own lectures" ON public.lectures;
CREATE POLICY "Owners view own lectures"
ON public.lectures FOR SELECT
TO authenticated
USING (professor_id = auth.uid());

-- ── 4. lecture-pdfs storage policies: drop the professor-role requirement ───

DROP POLICY IF EXISTS "Professors can upload PDFs for owned lectures" ON storage.objects;
CREATE POLICY "Owners can upload PDFs for owned lectures"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'lecture-pdfs'
    AND EXISTS (
        SELECT 1 FROM public.lectures
        WHERE id = (string_to_array(name, '/'))[2]::uuid
          AND professor_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Professors can update PDFs for owned lectures" ON storage.objects;
CREATE POLICY "Owners can update PDFs for owned lectures"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'lecture-pdfs'
    AND EXISTS (
        SELECT 1 FROM public.lectures
        WHERE id = (string_to_array(name, '/'))[2]::uuid
          AND professor_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Professors can delete PDFs for owned lectures" ON storage.objects;
CREATE POLICY "Owners can delete PDFs for owned lectures"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'lecture-pdfs'
    AND EXISTS (
        SELECT 1 FROM public.lectures
        WHERE id = (string_to_array(name, '/'))[2]::uuid
          AND professor_id = auth.uid()
    )
);
