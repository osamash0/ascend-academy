-- eval_runs: persisted AI-eval scorecards (Roadmap Foundation 10x, Phase 1 P1-3)
--
-- Before this table, AI output quality was measured nowhere — the only
-- "eval" (test_course_tutor_grounding.py) never persists a score. One row
-- per `python -m backend.eval.run_eval` invocation (nightly), so quiz-key
-- accuracy / tutor faithfulness / retrieval precision@k / synthesis
-- quality are plottable over time, not just pass/fail on the day they ran.
--
-- RLS: service-role only, mirroring public.backend_cache /
-- public.llm_calls — no direct client access; this is backend/CI-internal.

CREATE TABLE IF NOT EXISTS public.eval_runs (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    quiz_key_accuracy           NUMERIC(5, 4) NOT NULL,
    tutor_faithfulness          NUMERIC(5, 4) NOT NULL,
    retrieval_precision_at_k    NUMERIC(5, 4) NOT NULL,
    synthesis_quality           NUMERIC(5, 4) NOT NULL,
    passed                      BOOLEAN     NOT NULL,
    failing_metrics             TEXT[]      NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_eval_runs_run_at ON public.eval_runs (run_at);

ALTER TABLE public.eval_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role select on eval_runs"
    ON public.eval_runs FOR SELECT
    USING (auth.role() = 'service_role');

CREATE POLICY "Service role insert on eval_runs"
    ON public.eval_runs FOR INSERT
    WITH CHECK (auth.role() = 'service_role');
