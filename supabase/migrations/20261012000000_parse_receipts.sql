-- ─────────────────────────────────────────────────────────────────────────────
-- Arc 5 — parse receipts.
--
-- Every unified (v5) PDF parse leaves one receipt a professor can inspect:
--   deck_skeleton    — deck_plan.skeleton_receipt(): boilerplate lines, a role
--                      and section per slide, and the section list (no slide
--                      text; that already lives in public.slides).
--   slide_provenance — one entry per slide: synthesis route (batch /
--                      per_slide / vision / heuristic), prompt name+version,
--                      input_text (stripped / raw), requested model,
--                      synthesis_failed, needs_review, and served_by: the
--                      provider/model/tokens/cost of each metered LLM call
--                      that carried the slide (a batch call is shared by its
--                      slides; cost_usd is the slide's even share). Vision
--                      calls are not metered (ai/vision.py reports no usage).
--   llm_usage        — run totals over the metered calls made before the
--                      receipt was written (calls, tokens, cost, by prompt,
--                      by provider, dropped_calls). Later calls of the run
--                      (localization) are in public.llm_calls by run_id.
--                      Per-slide cost shares need not sum to
--                      llm_usage.cost_usd (rounding; run-level calls;
--                      out-of-range indices) -- the totals are authoritative.
--   quiz_grounding   — synthesis.ground_deck_quiz's summary
--                      (proposed/kept/repaired/dropped/drop_reasons/flagged/
--                      flag_reasons).
--
-- Keyed by run_id: a forced re-parse reuses its parse_runs row, so the
-- worker upserts and the newest receipt replaces the old one.
--
-- Access: only the lecture's owner (course professor, or the student owner
-- of a private upload) may read. Enrolled students get nothing — this is a
-- QA artifact, not study content. Writes are service-role only (the parse
-- worker; asyncpg/service role bypass RLS).
--
-- Supabase's default privileges grant SELECT/INSERT/UPDATE/DELETE on every
-- new public table DIRECTLY to anon and authenticated, so REVOKE ... FROM
-- PUBLIC alone would leave both grants in place (the trap behind
-- 20261011000000_revoke_anon_security_definer_execute). Revoke from the
-- named roles explicitly, then grant back only what is needed.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.parse_receipts (
    run_id           UUID        PRIMARY KEY
                                 REFERENCES public.parse_runs(run_id) ON DELETE CASCADE,
    lecture_id       UUID        NOT NULL
                                 REFERENCES public.lectures(id) ON DELETE CASCADE,
    deck_skeleton    JSONB,
    slide_provenance JSONB       NOT NULL DEFAULT '[]'::jsonb,
    quiz_grounding   JSONB,
    llm_usage        JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- An earlier version of this file (PR head 8673a94) created the table without
-- llm_usage; CREATE TABLE IF NOT EXISTS would skip it, so add it idempotently.
ALTER TABLE public.parse_receipts ADD COLUMN IF NOT EXISTS llm_usage JSONB;

CREATE INDEX IF NOT EXISTS idx_parse_receipts_lecture_created
    ON public.parse_receipts (lecture_id, created_at DESC);

ALTER TABLE public.parse_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.parse_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.parse_receipts TO authenticated;
GRANT ALL ON TABLE public.parse_receipts TO service_role;

DROP POLICY IF EXISTS "Lecture owners read parse receipts" ON public.parse_receipts;
CREATE POLICY "Lecture owners read parse receipts"
    ON public.parse_receipts FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.lectures l
            WHERE l.id = parse_receipts.lecture_id
              AND (l.professor_id = auth.uid() OR l.student_owner_id = auth.uid())
        )
    );
