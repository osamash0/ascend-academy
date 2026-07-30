-- Preferred-language study content.
--
-- Canonical (source-language) data remains in lectures/slides/quiz_questions.
-- Each completed locale variant is an immutable JSON document keyed by the
-- source revision, so a reader never observes a mix of old and new strings.

ALTER TABLE public.lectures
  ADD COLUMN IF NOT EXISTS source_language TEXT NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS content_revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.lectures
  DROP CONSTRAINT IF EXISTS lectures_source_language_check;

ALTER TABLE public.lectures
  ADD CONSTRAINT lectures_source_language_check
  CHECK (source_language IN ('en', 'de'));

ALTER TABLE public.lectures
  ADD CONSTRAINT lectures_content_revision_positive
  CHECK (content_revision > 0);

CREATE TABLE IF NOT EXISTS public.lecture_localizations (
  lecture_id UUID NOT NULL REFERENCES public.lectures(id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (locale IN ('en', 'de')),
  source_revision INTEGER NOT NULL CHECK (source_revision > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lecture_id, locale)
);

CREATE INDEX IF NOT EXISTS lecture_localizations_ready_lookup_idx
  ON public.lecture_localizations (lecture_id, locale, source_revision)
  WHERE status = 'ready';

ALTER TABLE public.lecture_localizations ENABLE ROW LEVEL SECURITY;

-- Reuse the lecture visibility helper so a localization can never broaden
-- access beyond the source lecture. Writes are server-authoritative.
CREATE POLICY "Read localizations respecting lecture visibility"
ON public.lecture_localizations FOR SELECT TO authenticated
USING (public.lecture_visible_to_caller(lecture_id));

-- Course metadata has a smaller independent localized shape. Course bodies
-- are editable source text; variants are rebuilt by the content worker.
CREATE TABLE IF NOT EXISTS public.course_localizations (
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (locale IN ('en', 'de')),
  source_revision INTEGER NOT NULL DEFAULT 1 CHECK (source_revision > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, locale)
);

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS content_revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.courses
  ADD CONSTRAINT courses_content_revision_positive CHECK (content_revision > 0);

CREATE INDEX IF NOT EXISTS course_localizations_ready_lookup_idx
  ON public.course_localizations (course_id, locale, source_revision)
  WHERE status = 'ready';

ALTER TABLE public.course_localizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read localizations for visible courses"
ON public.course_localizations FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.id = course_id
      AND (
        c.professor_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.course_enrollments ce
          WHERE ce.course_id = c.id AND ce.user_id = auth.uid()
        )
      )
  )
);

-- Canonical edits invalidate every previously-published variant. The worker
-- rebuilds both variants after the write; the read API only accepts a snapshot
-- with the same revision, so stale strings cannot leak in the meantime.
CREATE OR REPLACE FUNCTION public.bump_lecture_content_revision()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'lectures' THEN
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description THEN
      NEW.content_revision := OLD.content_revision + 1;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'slides' THEN
    UPDATE public.lectures SET content_revision = content_revision + 1
    WHERE id = COALESCE(NEW.lecture_id, OLD.lecture_id);
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  UPDATE public.lectures SET content_revision = content_revision + 1
  WHERE id = (
    SELECT lecture_id FROM public.slides WHERE id = COALESCE(NEW.slide_id, OLD.slide_id)
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lecture_content_revision ON public.lectures;
CREATE TRIGGER trg_lecture_content_revision
BEFORE UPDATE OF title, description ON public.lectures
FOR EACH ROW EXECUTE FUNCTION public.bump_lecture_content_revision();

DROP TRIGGER IF EXISTS trg_slide_content_revision ON public.slides;
CREATE TRIGGER trg_slide_content_revision
AFTER INSERT OR UPDATE OF title, content_text, summary OR DELETE ON public.slides
FOR EACH ROW EXECUTE FUNCTION public.bump_lecture_content_revision();

DROP TRIGGER IF EXISTS trg_quiz_content_revision ON public.quiz_questions;
CREATE TRIGGER trg_quiz_content_revision
AFTER INSERT OR UPDATE OF question_text, options, correct_answer, metadata OR DELETE ON public.quiz_questions
FOR EACH ROW EXECUTE FUNCTION public.bump_lecture_content_revision();

CREATE OR REPLACE FUNCTION public.bump_course_content_revision()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description THEN
    NEW.content_revision := OLD.content_revision + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_course_content_revision ON public.courses;
CREATE TRIGGER trg_course_content_revision
BEFORE UPDATE OF title, description ON public.courses
FOR EACH ROW EXECUTE FUNCTION public.bump_course_content_revision();
