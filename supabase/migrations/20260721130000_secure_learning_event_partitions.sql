-- Partition children are ordinary tables for RLS purposes. The parent table
-- is already protected, but every existing and future child must also enable
-- row security so a direct REST/table query cannot bypass the parent policy.

DO $$
DECLARE
  partition_name TEXT;
BEGIN
  FOR partition_name IN
    SELECT child.relname
    FROM pg_inherits inheritance
    JOIN pg_class parent ON parent.oid = inheritance.inhparent
    JOIN pg_namespace parent_schema ON parent_schema.oid = parent.relnamespace
    JOIN pg_class child ON child.oid = inheritance.inhrelid
    WHERE parent_schema.nspname = 'public'
      AND parent.relname = 'learning_events'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', partition_name);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_learning_events_partition_for_month(target_month date)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    month_start date := date_trunc('month', target_month)::date;
    month_end   date := (date_trunc('month', target_month) + interval '1 month')::date;
    part_name   text := format('learning_events_y%s_m%s',
                                to_char(month_start, 'YYYY'),
                                to_char(month_start, 'MM'));
BEGIN
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.learning_events
             FOR VALUES FROM (%L) TO (%L)',
        part_name, month_start, month_end
    );
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', part_name);
    RETURN part_name;
END;
$$;

COMMENT ON FUNCTION public.create_learning_events_partition_for_month(date) IS
  'Idempotently creates an RLS-protected monthly learning_events partition.';
