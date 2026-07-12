-- Roadmap Phase 5.1 (trust & lifecycle): persist per-slide trust signals that
-- today only ever live in-flight (SSE stream / frontend state, never the DB).
--
-- vision_routed: this slide had near-empty extractable text and was routed to
--   the vision model instead of text synthesis (Roadmap Phase 2.2). Was
--   computed since Phase 2.2 but never written to the slides row.
-- needs_review: cheap, deterministic heuristic (no new LLM call) computed at
--   synthesis time — true when the slide's synthesis raised an exception,
--   needed vision rescue, or came back with empty title+summary.
-- review_reason: one of 'synthesis_failed' | 'vision_rescue' | 'empty_content'
--   | NULL, explaining why needs_review is true.
--
-- Roadmap Phase 5.2 (regenerate with feedback):
-- regen_instruction: free-text professor instruction persisted so a later
--   regenerate (or re-parse) can honor it again.
-- previous_version: JSONB snapshot of {title, content_text, summary} taken
--   right before a regenerate overwrites them, enabling a single-level undo.

ALTER TABLE public.slides
ADD COLUMN IF NOT EXISTS vision_routed BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS review_reason TEXT,
ADD COLUMN IF NOT EXISTS regen_instruction TEXT,
ADD COLUMN IF NOT EXISTS previous_version JSONB;

CREATE INDEX IF NOT EXISTS idx_slides_needs_review
  ON public.slides (lecture_id)
  WHERE needs_review = TRUE;
