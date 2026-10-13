-- ─────────────────────────────────────────────────────────────────────────────
-- Arc 7 — run context on public.llm_calls.
--
-- Every LLM completion is already one llm_calls row (backend/services/ai/
-- cost.py log_llm_call), but nothing tied a row to the parse that caused it.
-- Three nullable columns, filled only for calls made inside a parse (the
-- context comes from backend/services/ai/call_context.py):
--   run_id        public.parse_runs.run_id of the parse. Deliberately NOT a
--                 foreign key: llm_calls is an append-only cost ledger and
--                 log_llm_call swallows insert errors, so an FK violation
--                 (run row deleted, or never committed) would silently drop a
--                 billed call. A dangling run_id is harmless; a lost cost row
--                 is not.
--   slide_indices 0-based slides the call synthesized. An array, not one int:
--                 one batch call covers up to 8 slides. NULL for deck-level
--                 calls (lecture meta, deck quiz, localization, ...).
--   prompt_name   backend/services/ai/prompts.py PROMPT_VERSIONS key.
--   prompt_version the version of that prompt in force when the call was made
--                 (recorded at call time, so a later bump never rewrites
--                 history). NULL for a free-form name that is not registered.
-- A forced re-parse reuses its run_id, so rows of several attempts can share
-- one run_id; the parse receipt is built per attempt in memory instead.
--
-- Grants: 20260719010000 relied on RLS (service-role-only policies) while
-- Supabase's default privileges still grant anon and authenticated full table
-- privileges directly. Revoke them from the named roles and grant service_role
-- back, as 20261012000000_parse_receipts does. The backend reads and writes
-- through asyncpg as the table owner, which these grants do not affect.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.llm_calls
    ADD COLUMN IF NOT EXISTS run_id        UUID,
    ADD COLUMN IF NOT EXISTS slide_indices INTEGER[],
    ADD COLUMN IF NOT EXISTS prompt_name   TEXT,
    ADD COLUMN IF NOT EXISTS prompt_version TEXT;

CREATE INDEX IF NOT EXISTS idx_llm_calls_run_id
    ON public.llm_calls (run_id)
    WHERE run_id IS NOT NULL;

REVOKE ALL ON TABLE public.llm_calls FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.llm_calls TO service_role;
