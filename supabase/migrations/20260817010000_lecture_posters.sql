-- Egress fix: serve a small poster image for the console hero key art instead
-- of downloading the whole source PDF.
--
-- Before this migration, src/components/console/LectureBackdrop.tsx rendered
-- page 1 of the lecture PDF through react-pdf just to paint the hero backdrop.
-- pdf.js auto-fetches the remainder of a document, so focusing a lecture in the
-- library pulled the entire PDF (1.6 MB average, up to 7 MB) purely as
-- decoration. Combined with a freshly-minted signed URL per mount -- which is a
-- guaranteed CDN cache miss -- that was the dominant source of the Supabase
-- egress overage (2.96 GB uncached vs 0.06 GB cached, at only 15 MAU).
--
-- A poster is a ~80 KB WebP render of page 1, generated once at ingest from the
-- PDF bytes the parser already holds in memory, so it costs no extra egress to
-- produce.

-- The bucket mirrors lecture-pdfs: private, read by any authenticated user,
-- written only by the owning professor. Posters are written server-side with the
-- service-role client (which bypasses RLS), but the write policies are declared
-- anyway so a future client-side upload path cannot silently become a hole.
INSERT INTO storage.buckets (id, name, public)
VALUES ('lecture-posters', 'lecture-posters', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Authenticated users can read lecture posters" ON storage.objects;
CREATE POLICY "Authenticated users can read lecture posters"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'lecture-posters');

-- Path format matches lecture-pdfs: lectures/{lectureId}/poster.webp, so the
-- lectureId is segment 2 and ownership resolves the same way.
DROP POLICY IF EXISTS "Professors can upload posters for owned lectures" ON storage.objects;
CREATE POLICY "Professors can upload posters for owned lectures"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'lecture-posters'
    AND public.has_role(auth.uid(), 'professor')
    AND EXISTS (
        SELECT 1 FROM public.lectures
        WHERE id = (string_to_array(name, '/'))[2]::uuid
          AND professor_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Professors can update posters for owned lectures" ON storage.objects;
CREATE POLICY "Professors can update posters for owned lectures"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'lecture-posters'
    AND public.has_role(auth.uid(), 'professor')
    AND EXISTS (
        SELECT 1 FROM public.lectures
        WHERE id = (string_to_array(name, '/'))[2]::uuid
          AND professor_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Professors can delete posters for owned lectures" ON storage.objects;
CREATE POLICY "Professors can delete posters for owned lectures"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'lecture-posters'
    AND public.has_role(auth.uid(), 'professor')
    AND EXISTS (
        SELECT 1 FROM public.lectures
        WHERE id = (string_to_array(name, '/'))[2]::uuid
          AND professor_id = auth.uid()
    )
);

-- NULL until a poster has been rendered. The frontend only requests a poster
-- when this is set, so lectures without one degrade to the ambient gradient
-- rather than firing a 404 at storage.
ALTER TABLE public.lectures ADD COLUMN IF NOT EXISTS poster_url text;

COMMENT ON COLUMN public.lectures.poster_url IS
    'Storage path in the lecture-posters bucket (lectures/{id}/poster.webp) for '
    'the console hero key art. NULL means no poster yet -- render the ambient '
    'gradient instead of fetching the source PDF.';
