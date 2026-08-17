-- Course blueprints sit between immutable parse results and the editable course
-- a student studies. This keeps original uploads stable while allowing the
-- proposed learning structure to evolve safely.

CREATE TABLE IF NOT EXISTS public.material_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL,
  parse_run_id UUID UNIQUE REFERENCES public.parse_runs(run_id) ON DELETE SET NULL,
  original_filename TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'pdf',
  content_hash TEXT,
  processing_state TEXT NOT NULL DEFAULT 'queued'
    CHECK (processing_state IN ('queued', 'processing', 'ready', 'needs_attention', 'failed')),
  classification TEXT NOT NULL DEFAULT 'lecture'
    CHECK (classification IN ('lecture', 'reading', 'worksheet', 'assignment', 'exam', 'supporting')),
  extracted_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  duplicate_of UUID REFERENCES public.material_sources(id) ON DELETE SET NULL,
  replaces_source_id UUID REFERENCES public.material_sources(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_sources_owner_batch
  ON public.material_sources(owner_id, batch_id, created_at);

CREATE TABLE IF NOT EXISTS public.course_blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL,
  course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  study_goal TEXT CHECK (study_goal IN ('weekly_study', 'exam', 'assignment', 'understanding')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'created')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_id, batch_id)
);

CREATE TABLE IF NOT EXISTS public.course_blueprint_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id UUID NOT NULL REFERENCES public.course_blueprints(id) ON DELETE CASCADE,
  material_source_id UUID NOT NULL REFERENCES public.material_sources(id) ON DELETE RESTRICT,
  lecture_id UUID REFERENCES public.lectures(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  classification TEXT NOT NULL DEFAULT 'lecture'
    CHECK (classification IN ('lecture', 'reading', 'worksheet', 'assignment', 'exam', 'supporting')),
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.60 CHECK (confidence >= 0 AND confidence <= 1),
  include_in_course BOOLEAN NOT NULL DEFAULT TRUE,
  source_range JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(blueprint_id, material_source_id),
  UNIQUE(blueprint_id, position)
);

CREATE INDEX IF NOT EXISTS idx_blueprint_items_blueprint
  ON public.course_blueprint_items(blueprint_id, position);

-- These rows are served by owner-checked backend APIs. Keep source text and
-- inferred structure off the direct client surface.
ALTER TABLE public.material_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_blueprint_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages material sources" ON public.material_sources;
CREATE POLICY "Service role manages material sources"
ON public.material_sources FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role manages course blueprints" ON public.course_blueprints;
CREATE POLICY "Service role manages course blueprints"
ON public.course_blueprints FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role manages course blueprint items" ON public.course_blueprint_items;
CREATE POLICY "Service role manages course blueprint items"
ON public.course_blueprint_items FOR ALL TO service_role USING (true) WITH CHECK (true);
