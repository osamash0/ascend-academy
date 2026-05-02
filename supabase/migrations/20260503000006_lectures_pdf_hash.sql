-- Add pdf_hash linkage column to lectures so backend authorization can
-- verify a chat/attach request's pdf_hash actually belongs to the
-- claimed lecture.  The grounded RAG tutor uses this to prevent
-- cross-tenant data exposure.
ALTER TABLE public.lectures
    ADD COLUMN IF NOT EXISTS pdf_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_lectures_pdf_hash
    ON public.lectures(pdf_hash);
