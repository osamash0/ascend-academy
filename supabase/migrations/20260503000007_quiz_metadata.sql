-- Add a free-form metadata jsonb column to quiz_questions for the
-- concept-testing fields produced by the upgraded slide and deck quiz
-- prompts (explanation, concept, cognitive_level, linked_slides, ...).
--
-- Storing them in a single jsonb column instead of separate typed columns
-- keeps the schema flexible while we iterate on the prompt — analytics
-- and the player UI both already treat these fields as optional.

ALTER TABLE quiz_questions
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill any pre-existing rows so the JSONB column is never NULL even
-- under older client tooling that ignored the column default.
UPDATE quiz_questions
   SET metadata = '{}'::jsonb
 WHERE metadata IS NULL;
