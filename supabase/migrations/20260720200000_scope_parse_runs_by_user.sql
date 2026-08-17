-- A byte-identical document can be uploaded by different students.  Parse
-- progress, ownership, batch state, and private lecture attachments must never
-- be shared or overwritten across those users. Drop the prior two-column
-- uniqueness rule by shape, rather than assuming its generated name: some
-- existing databases may have used a hand-named equivalent constraint.
DO $$
DECLARE
  previous_constraint TEXT;
BEGIN
  FOR previous_constraint IN
    SELECT constraint_row.conname
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS schema ON schema.oid = relation.relnamespace
    JOIN unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, position)
      ON TRUE
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = relation.oid AND attribute.attnum = key_column.attnum
    WHERE schema.nspname = 'public'
      AND relation.relname = 'parse_runs'
      AND constraint_row.contype = 'u'
    GROUP BY constraint_row.conname, constraint_row.oid
    HAVING array_agg(attribute.attname::TEXT ORDER BY key_column.position)
      = ARRAY['pdf_hash', 'pipeline_version']
  LOOP
    EXECUTE format(
      'ALTER TABLE public.parse_runs DROP CONSTRAINT %I',
      previous_constraint
    );
  END LOOP;
END $$;

ALTER TABLE public.parse_runs
  ADD CONSTRAINT parse_runs_pdf_hash_pipeline_version_user_id_key
  UNIQUE (pdf_hash, pipeline_version, user_id);
