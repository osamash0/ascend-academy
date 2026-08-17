-- One material source can legitimately yield several lectures (for example a
-- combined PDF containing weeks 1 and 2).  Keep the source immutable while
-- allowing multiple editable blueprint items to point at it with distinct
-- source ranges.
ALTER TABLE public.course_blueprint_items
  DROP CONSTRAINT IF EXISTS course_blueprint_items_blueprint_id_material_source_id_key;

CREATE INDEX IF NOT EXISTS idx_blueprint_items_source
  ON public.course_blueprint_items(blueprint_id, material_source_id);
