-- Task #58: On-demand AI parsing mode for PDF upload.
--
-- Add columns so slides know which parsing path produced them and whether
-- their AI-generated derivatives (titles, summaries, quizzes) have been
-- created. Existing rows default to ai_enhanced=true so nothing in the
-- current AI default flow surfaces an "AI not yet run" affordance.

ALTER TABLE public.slides
    ADD COLUMN IF NOT EXISTS ai_enhanced BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS parser_engine TEXT;

COMMENT ON COLUMN public.slides.ai_enhanced IS
    'False when the slide was produced by the deterministic (no-LLM) PDF '
    'parsing path. Flipped to true once any per-slide AI enhancement '
    '(title rewrite / content rewrite / quiz generation) has run.';

COMMENT ON COLUMN public.slides.parser_engine IS
    'Identifier of the extractor that produced this slide row, e.g. '
    'heuristic-v1 for the deterministic PyMuPDF + layout heuristics path. '
    'NULL for legacy rows produced by the AI pipeline.';
