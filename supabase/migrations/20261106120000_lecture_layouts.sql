-- Layout face (docs/superpowers/specs/2026-11-06-layout-face-design.md).
-- One row per page: the page re-set as blocks at their own places, with a verdict.
-- Written only by the parse worker (service role); readable exactly when the lecture is.
CREATE TABLE IF NOT EXISTS public.lecture_layouts (
    lecture_id  uuid        NOT NULL REFERENCES public.lectures(id) ON DELETE CASCADE,
    page        int         NOT NULL CHECK (page >= 1),
    layout      jsonb       NOT NULL,
    version     int         NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (lecture_id, page)
);
ALTER TABLE public.lecture_layouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read layouts of lectures you can read" ON public.lecture_layouts;
CREATE POLICY "Read layouts of lectures you can read"
ON public.lecture_layouts FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.lectures l WHERE l.id = lecture_layouts.lecture_id));
REVOKE ALL ON public.lecture_layouts FROM anon;
REVOKE ALL ON public.lecture_layouts FROM authenticated;
GRANT SELECT ON public.lecture_layouts TO authenticated;
