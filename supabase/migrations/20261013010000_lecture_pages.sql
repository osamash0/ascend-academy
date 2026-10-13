-- Studio pages (docs/superpowers/specs/2026-10-11-real-pages-pipeline-design.md §4).
--
-- One row per page of a lecture: its picture, its text blocks with positions
-- (Studio's SourceBlock[]), and the calm summary paragraphs with the block ids
-- each one condenses. Written only by the parse worker (service role). A page
-- is readable exactly when its lecture is: the policy defers to lectures' own
-- RLS through an EXISTS subquery, so private uploads stay private and course
-- lectures follow enrollment, with no second copy of those rules to drift.

CREATE TABLE IF NOT EXISTS public.lecture_pages (
    lecture_id  uuid        NOT NULL REFERENCES public.lectures(id) ON DELETE CASCADE,
    page        int         NOT NULL CHECK (page >= 1),
    width       real        NOT NULL,
    height      real        NOT NULL,
    image_path  text        NOT NULL,
    geometry    text        NOT NULL CHECK (geometry IN ('block', 'page')),
    blocks      jsonb       NOT NULL DEFAULT '[]'::jsonb,
    summary     jsonb       NOT NULL DEFAULT '[]'::jsonb,
    status      text        NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'needs_review')),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (lecture_id, page)
);

COMMENT ON COLUMN public.lecture_pages.blocks IS
    'SourceBlock[] (src/features/spaces/studio/types.ts); ids p{page}-b{n}; [] when geometry = page';
COMMENT ON COLUMN public.lecture_pages.summary IS
    'Calm summary paragraphs: [{"markdown": "...**term**...", "covers": ["p1-b2", ...]}]; first is the gist; [] if the summary step failed';

ALTER TABLE public.lecture_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read pages of lectures you can read" ON public.lecture_pages;
CREATE POLICY "Read pages of lectures you can read"
ON public.lecture_pages FOR SELECT
TO authenticated
USING (EXISTS (SELECT 1 FROM public.lectures l WHERE l.id = lecture_pages.lecture_id));

-- Supabase grants table privileges to anon/authenticated directly; REVOKE
-- FROM PUBLIC would not remove them (2026-10-11 anon-grants lesson).
REVOKE ALL ON public.lecture_pages FROM anon;
REVOKE ALL ON public.lecture_pages FROM authenticated;
GRANT SELECT ON public.lecture_pages TO authenticated;

-- Page pictures. Private, and deliberately without storage.objects policies:
-- the backend signs every URL with the service role, so no client ever reads
-- or writes this bucket directly.
INSERT INTO storage.buckets (id, name, public)
VALUES ('lecture-pages', 'lecture-pages', false)
ON CONFLICT (id) DO UPDATE SET public = false;
