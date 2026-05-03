-- Practice Sheets tables
-- practice_sheets: one per lecture (kind=auto) or many (kind=manual)
CREATE TABLE IF NOT EXISTS practice_sheets (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lecture_id  uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    kind        text NOT NULL CHECK (kind IN ('auto', 'manual')),
    title       text NOT NULL,
    status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    created_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS practice_sheets_lecture_id_idx ON practice_sheets(lecture_id);
CREATE INDEX IF NOT EXISTS practice_sheets_created_by_idx ON practice_sheets(created_by);
-- Enforce at most one auto sheet per lecture
CREATE UNIQUE INDEX IF NOT EXISTS practice_sheets_auto_per_lecture
    ON practice_sheets(lecture_id) WHERE kind = 'auto';

-- practice_sheet_questions: ordered questions within a sheet
CREATE TABLE IF NOT EXISTS practice_sheet_questions (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sheet_id                uuid NOT NULL REFERENCES practice_sheets(id) ON DELETE CASCADE,
    order_index             integer NOT NULL DEFAULT 0,
    type                    text NOT NULL CHECK (type IN ('multiple_choice', 'short_answer', 'free_form')),
    prompt                  text NOT NULL,
    choices                 jsonb,           -- array of strings, only for multiple_choice
    correct_answer          text,            -- option text or short answer model; null for free_form
    explanation             text,
    source_quiz_question_id uuid REFERENCES quiz_questions(id) ON DELETE SET NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS practice_sheet_questions_sheet_id_idx
    ON practice_sheet_questions(sheet_id, order_index);

-- practice_attempts: one row per submission
CREATE TABLE IF NOT EXISTS practice_attempts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sheet_id    uuid NOT NULL REFERENCES practice_sheets(id) ON DELETE CASCADE,
    student_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    answers     jsonb NOT NULL DEFAULT '{}',   -- {question_id: answer_text}
    score       real,                          -- null until graded; 0-100
    is_preview  boolean NOT NULL DEFAULT false,
    submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS practice_attempts_sheet_student_idx
    ON practice_attempts(sheet_id, student_id);

-- updated_at triggers
CREATE OR REPLACE FUNCTION _touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'practice_sheets_updated_at'
  ) THEN
    CREATE TRIGGER practice_sheets_updated_at
      BEFORE UPDATE ON practice_sheets
      FOR EACH ROW EXECUTE FUNCTION _touch_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'practice_sheet_questions_updated_at'
  ) THEN
    CREATE TRIGGER practice_sheet_questions_updated_at
      BEFORE UPDATE ON practice_sheet_questions
      FOR EACH ROW EXECUTE FUNCTION _touch_updated_at();
  END IF;
END $$;

-- RLS
ALTER TABLE practice_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_sheet_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_attempts ENABLE ROW LEVEL SECURITY;

-- Professors see their own sheets; students see published sheets on lectures they can access
CREATE POLICY "practice_sheets_professor_all" ON practice_sheets
    FOR ALL USING (
        created_by = auth.uid()
    );

CREATE POLICY "practice_sheets_student_published" ON practice_sheets
    FOR SELECT USING (
        status = 'published' AND EXISTS (
            SELECT 1 FROM assignment_lectures al
            JOIN assignment_enrollments ae ON ae.assignment_id = al.assignment_id
            WHERE al.lecture_id = practice_sheets.lecture_id
              AND ae.user_id = auth.uid()
        )
    );

-- Questions: students (enrolled + published) may only SELECT; only the owning professor may mutate
CREATE POLICY "practice_sheet_questions_select" ON practice_sheet_questions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM practice_sheets ps
            WHERE ps.id = practice_sheet_questions.sheet_id
              AND (
                  ps.created_by = auth.uid()
                  OR (
                      ps.status = 'published' AND EXISTS (
                          SELECT 1 FROM assignment_lectures al
                          JOIN assignment_enrollments ae ON ae.assignment_id = al.assignment_id
                          WHERE al.lecture_id = ps.lecture_id
                            AND ae.user_id = auth.uid()
                      )
                  )
              )
        )
    );

CREATE POLICY "practice_sheet_questions_professor_mutate" ON practice_sheet_questions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM practice_sheets ps
            WHERE ps.id = practice_sheet_questions.sheet_id
              AND ps.created_by = auth.uid()
        )
    );

-- Attempts: own rows only
CREATE POLICY "practice_attempts_own" ON practice_attempts
    FOR ALL USING (student_id = auth.uid());
