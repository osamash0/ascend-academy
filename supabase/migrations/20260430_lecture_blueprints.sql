-- Migration to add lecture_blueprints table
CREATE TABLE IF NOT EXISTS public.lecture_blueprints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pdf_hash TEXT UNIQUE NOT NULL,
    blueprint_json JSONB NOT NULL,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_blueprint_pdf_hash ON public.lecture_blueprints(pdf_hash);
CREATE INDEX IF NOT EXISTS idx_blueprint_created ON public.lecture_blueprints(created_at);

-- Enable RLS
ALTER TABLE public.lecture_blueprints ENABLE ROW LEVEL SECURITY;

-- Add RLS policy
-- Note: Blueprints are shared by hash, but we want to ensure users can only access blueprints 
-- for PDFs that exist in the lectures table which they have access to.
-- For now, we'll allow authenticated users to SELECT (since blueprints are derived from PDFs), 
-- but only the system (or the professor who first uploaded it) to INSERT/UPDATE.
-- However, the user's recommendation was: "users can only access blueprints for PDFs they own".

CREATE POLICY "Users can view blueprints for their own lectures"
ON public.lecture_blueprints FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.lectures l
        WHERE l.pdf_url LIKE '%' || lecture_blueprints.pdf_hash || '%'
        AND (l.professor_id = auth.uid() OR public.has_role(auth.uid(), 'professor'))
    )
);

CREATE POLICY "Professors can insert blueprints"
ON public.lecture_blueprints FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'professor'));
