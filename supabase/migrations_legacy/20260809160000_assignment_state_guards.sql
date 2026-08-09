-- Serialize assignment answers and reassignments at the row boundary.
--
-- Workflow functions check that an offer is pending before updating it, but the check and
-- update are separate statements. Two requests can both observe `pending`; after one commits,
-- the other UPDATE targets the latest tuple and used to overwrite it. This trigger validates
-- the tuple version PostgreSQL is actually about to write, so a stale action aborts atomically
-- before its surrounding function can update the task or append duplicate activity.

CREATE OR REPLACE FUNCTION public.enforce_assignment_status_transition()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
AS $$
BEGIN
    IF NEW.status = OLD.status THEN
        RAISE EXCEPTION 'This assignment has already been answered.';
    END IF;

    IF OLD.status = 'pending' AND NEW.status IN ('accepted', 'rejected', 'reassigned') THEN
        RETURN NEW;
    END IF;

    IF OLD.status = 'accepted' AND NEW.status = 'reassigned' THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Invalid assignment status transition: % to %.', OLD.status, NEW.status;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_assignment_status_transition() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_assignment_status_transition ON public.assignments;
CREATE TRIGGER trg_enforce_assignment_status_transition
    BEFORE UPDATE OF status ON public.assignments
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_assignment_status_transition();
