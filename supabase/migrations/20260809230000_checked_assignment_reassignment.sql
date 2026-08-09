-- Require the manager's assignment view to still match the locked row. This makes an
-- employee response racing a reassignment an optimistic-concurrency conflict instead of two
-- successful, contradictory transitions.
CREATE OR REPLACE FUNCTION public.assign_task_checked(
    p_task_id uuid,
    p_user_id uuid,
    p_auto_accept boolean,
    p_expected_assignment_id uuid,
    p_expected_status text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_current_id uuid;
    v_current_status text;
BEGIN
    IF NOT public.can_assign_work() THEN
        RAISE EXCEPTION 'Only an admin, manager or team leader can assign work.';
    END IF;

    SELECT a.id, a.status INTO v_current_id, v_current_status
    FROM public.assignments a
    WHERE a.task_id = p_task_id AND a.status IN ('pending', 'accepted')
    FOR UPDATE;

    IF v_current_id IS DISTINCT FROM p_expected_assignment_id
       OR v_current_status IS DISTINCT FROM p_expected_status THEN
        RAISE EXCEPTION 'This assignment changed while you were viewing it. Refresh and try again.';
    END IF;

    RETURN public.assign_task(p_task_id, p_user_id, p_auto_accept);
END;
$$;

REVOKE ALL ON FUNCTION public.assign_task_checked(uuid, uuid, boolean, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_task_checked(uuid, uuid, boolean, uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_task(uuid, uuid, boolean) FROM authenticated;
