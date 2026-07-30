-- backend/services/parser/repos.py's get_or_create_run has targeted
-- ON CONFLICT (pdf_hash, pipeline_version, user_id) since commit 93b88e2
-- ("update parse_runs UPSERT conflict target to include user_id"). That
-- commit's message claims this matches "the underlying PostgreSQL unique
-- constraint parse_runs_pdf_hash_pipeline_version_user_id_key which was
-- updated in a previous migration" — no such migration actually exists.
-- The base schema (20260503000008_parser_v3_schema.sql) only ever created
-- UNIQUE (pdf_hash, pipeline_version), and nothing since replaced it. Every
-- INSERT through get_or_create_run has been failing with "there is no
-- unique or exclusion constraint matching the ON CONFLICT specification"
-- since that commit landed — this is the migration it assumed already
-- existed.
--
-- Scoping the constraint by user_id also completes the "known v1 sharp
-- edge" get_or_create_run's own docstring called out: two different users
-- uploading byte-identical PDF content previously shared one parse_runs
-- row (the docstring called this "accepted for now, a candidate to scope
-- by user_id in a fast-follow" — this is that fast-follow).
--
-- user_id is nullable (20260618000000_fast_upload_parse_runs_owner.sql
-- added it without backfilling existing rows), so legacy NULL-user_id rows
-- are not mutually constrained by this — standard SQL NULL-is-distinct
-- semantics, consistent with that migration's own "fine to leave existing
-- rows with NULL" note.
ALTER TABLE public.parse_runs
    DROP CONSTRAINT IF EXISTS parse_runs_pdf_hash_pipeline_version_key;

ALTER TABLE public.parse_runs
    ADD CONSTRAINT parse_runs_pdf_hash_pipeline_version_user_id_key
    UNIQUE (pdf_hash, pipeline_version, user_id);
