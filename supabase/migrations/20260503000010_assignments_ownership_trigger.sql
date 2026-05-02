-- ─────────────────────────────────────────────────────────────────────────────
-- Defense-in-depth: enforce that every assignment_lectures row links a lecture
-- owned by the same professor as the parent assignment. The API already
-- validates this, but a SECURITY DEFINER trigger guarantees the invariant
-- even when a professor goes around the API and writes directly to the table
-- under their own RLS allowance (the assignment_lectures INSERT policy only
-- checks parent assignment ownership, not lecture ownership).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_assignment_lecture_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    assignment_owner uuid;
    lecture_owner    uuid;
BEGIN
    SELECT professor_id INTO assignment_owner
      FROM public.assignments
     WHERE id = NEW.assignment_id;
    IF assignment_owner IS NULL THEN
        RAISE EXCEPTION 'assignment % does not exist', NEW.assignment_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    SELECT professor_id INTO lecture_owner
      FROM public.lectures
     WHERE id = NEW.lecture_id;
    IF lecture_owner IS NULL THEN
        RAISE EXCEPTION 'lecture % does not exist', NEW.lecture_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF assignment_owner <> lecture_owner THEN
        RAISE EXCEPTION
            'assignment_lectures: lecture % is owned by % but assignment % is owned by %',
            NEW.lecture_id, lecture_owner, NEW.assignment_id, assignment_owner
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assignment_lecture_ownership
    ON public.assignment_lectures;
CREATE TRIGGER trg_assignment_lecture_ownership
    BEFORE INSERT OR UPDATE ON public.assignment_lectures
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_assignment_lecture_ownership();
