-- Migration: add schema_version to lecture_mind_maps so the API can mark
-- old cached payloads stale without dropping them. Existing rows default
-- to version 1; the API regards anything below CURRENT_SCHEMA_VERSION (2)
-- as not-yet-generated, prompting a regenerate against the new normaliser.

alter table lecture_mind_maps
  add column if not exists schema_version integer not null default 1;
