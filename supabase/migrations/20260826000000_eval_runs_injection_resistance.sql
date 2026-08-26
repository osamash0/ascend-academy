-- eval_runs: add the injection_resistance column (5th profiling dimension)
--
-- backend/eval's Scorecard/EvalPipeline gained a 5th dimension measuring
-- whether the course tutor resists prompt-injection payloads planted in
-- slide content or the student message (see backend/eval/golden_sets.py's
-- PROMPT_INJECTION_GOLDEN_SET). This column persists it alongside the four
-- existing metrics so it is plottable over time the same way they are.
--
-- Nullable, unlike the four existing NOT NULL metric columns: this is a new
-- discovery-mode dimension with no established baseline yet (see scorer.py's
-- DEFAULT_BANDS comment), and older/pre-migration rows have no value for it.

ALTER TABLE public.eval_runs
    ADD COLUMN IF NOT EXISTS injection_resistance NUMERIC(5, 4);
