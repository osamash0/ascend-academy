-- Drop cached `professor_overview` rows whenever lectures, slides, or
-- quiz_questions change for a course.
--
-- Why this exists: the professor course overview is cached for 5 minutes
-- under the COURSE id (column `analytics_cache.lecture_id` reused as the
-- key slot, with `view_name='professor_overview'`). Many lecture/slide/
-- quiz mutations are still performed directly from the browser via
-- supabase-js (e.g. `lectureService.deleteLecture`,
-- `updateSlideContent`, `deleteSlideWithQuestions`,
-- `updateQuizQuestion`), bypassing the FastAPI backend. Without these
-- triggers the overview would stay stale until the TTL expires.
--
-- The triggers resolve the affected course id from the row that was
-- mutated (or from the parent slide → lecture → course chain for quiz
-- rows) and DELETE only the matching `professor_overview` cache rows.
-- They're scoped to that one view name on purpose so they never nuke
-- per-lecture aggregates that share the slot.

CREATE OR REPLACE FUNCTION public._invalidate_course_overview(cid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF cid IS NOT NULL THEN
        DELETE FROM public.analytics_cache
         WHERE lecture_id = cid
           AND view_name = 'professor_overview';
    END IF;
END;
$$;


-- ── lectures ────────────────────────────────────────────────────────────────
-- Insert/Delete invalidate the affected course; an UPDATE that moves the
-- lecture between courses invalidates BOTH the source and destination
-- course overviews.
CREATE OR REPLACE FUNCTION public.invalidate_course_overview_on_lecture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM public._invalidate_course_overview(NEW.course_id);
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM public._invalidate_course_overview(OLD.course_id);
    ELSE  -- UPDATE
        PERFORM public._invalidate_course_overview(NEW.course_id);
        IF OLD.course_id IS DISTINCT FROM NEW.course_id THEN
            PERFORM public._invalidate_course_overview(OLD.course_id);
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_invalidate_course_overview_lectures ON public.lectures;
CREATE TRIGGER trg_invalidate_course_overview_lectures
AFTER INSERT OR UPDATE OR DELETE ON public.lectures
FOR EACH ROW
EXECUTE FUNCTION public.invalidate_course_overview_on_lecture();


-- ── slides ──────────────────────────────────────────────────────────────────
-- Slide content edits feed the overview's "weakest slides" tile and
-- shift the parent lecture's per-slide aggregate. Resolve the parent
-- course via lectures → invalidate.
CREATE OR REPLACE FUNCTION public.invalidate_course_overview_on_slide()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    cid uuid;
    cid2 uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT course_id INTO cid FROM public.lectures WHERE id = OLD.lecture_id;
        PERFORM public._invalidate_course_overview(cid);
    ELSE
        SELECT course_id INTO cid FROM public.lectures WHERE id = NEW.lecture_id;
        PERFORM public._invalidate_course_overview(cid);
        IF TG_OP = 'UPDATE' AND OLD.lecture_id IS DISTINCT FROM NEW.lecture_id THEN
            SELECT course_id INTO cid2 FROM public.lectures WHERE id = OLD.lecture_id;
            PERFORM public._invalidate_course_overview(cid2);
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_invalidate_course_overview_slides ON public.slides;
CREATE TRIGGER trg_invalidate_course_overview_slides
AFTER INSERT OR UPDATE OR DELETE ON public.slides
FOR EACH ROW
EXECUTE FUNCTION public.invalidate_course_overview_on_slide();


-- ── quiz_questions ──────────────────────────────────────────────────────────
-- quiz_questions only carries slide_id, so chase slide → lecture → course.
CREATE OR REPLACE FUNCTION public.invalidate_course_overview_on_quiz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    cid uuid;
    cid2 uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT l.course_id INTO cid
          FROM public.slides s
          JOIN public.lectures l ON l.id = s.lecture_id
         WHERE s.id = OLD.slide_id;
        PERFORM public._invalidate_course_overview(cid);
    ELSE
        SELECT l.course_id INTO cid
          FROM public.slides s
          JOIN public.lectures l ON l.id = s.lecture_id
         WHERE s.id = NEW.slide_id;
        PERFORM public._invalidate_course_overview(cid);
        IF TG_OP = 'UPDATE' AND OLD.slide_id IS DISTINCT FROM NEW.slide_id THEN
            SELECT l.course_id INTO cid2
              FROM public.slides s
              JOIN public.lectures l ON l.id = s.lecture_id
             WHERE s.id = OLD.slide_id;
            PERFORM public._invalidate_course_overview(cid2);
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_invalidate_course_overview_quiz ON public.quiz_questions;
CREATE TRIGGER trg_invalidate_course_overview_quiz
AFTER INSERT OR UPDATE OR DELETE ON public.quiz_questions
FOR EACH ROW
EXECUTE FUNCTION public.invalidate_course_overview_on_quiz();
