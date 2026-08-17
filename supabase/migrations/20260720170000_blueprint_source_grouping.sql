-- Keep source files immutable while allowing the editable blueprint to express
-- a many-source-to-one-lecture proposal. `lecture_group_id` is an editable
-- draft grouping key; each source keeps its own row and original parse output.
ALTER TABLE public.course_blueprint_items
  ADD COLUMN IF NOT EXISTS lecture_group_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS split_from_item_id UUID REFERENCES public.course_blueprint_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_blueprint_items_group
  ON public.course_blueprint_items(blueprint_id, lecture_group_id, position);

-- Existing one-file-per-lecture blueprints receive an independent group for
-- every item via the DEFAULT. Future edits can put several rows in one group
-- or create split rows that retain a source-range provenance link.
