-- Restrict browser task mutations to ordinary editable fields. Assignment identity and state,
-- request ownership, completion timestamps, hierarchy and ordering move through checked RPCs.

ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS sort_order bigint NOT NULL DEFAULT 0;

WITH ranked AS (
    SELECT id, row_number() OVER (
        PARTITION BY parent_task_id ORDER BY created_at, id
    ) - 1 AS position
    FROM public.tasks
    WHERE parent_task_id IS NOT NULL
)
UPDATE public.tasks t
SET sort_order = ranked.position
FROM ranked
WHERE ranked.id = t.id;

CREATE INDEX IF NOT EXISTS tasks_parent_sort_order_idx
    ON public.tasks (parent_task_id, sort_order, id)
    WHERE parent_task_id IS NOT NULL;

-- Absence of a profile must deny access. The previous NOT EXISTS form treated any valid
-- authenticated JWT with no public.users row as a live organisation member.
CREATE OR REPLACE FUNCTION public.is_live_user()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid()
          AND u.is_active
          AND u.deleted_at IS NULL
          AND u.onboarding_completed
          AND u.role IN ('super_admin', 'admin', 'manager', 'team_leader', 'team_member')
    );
$$;

REVOKE ALL ON FUNCTION public.is_live_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_live_user() TO authenticated;

CREATE OR REPLACE FUNCTION public.can_edit_task(p_task_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
    SELECT public.is_live_user() AND EXISTS (
        SELECT 1
        FROM public.tasks t
        WHERE t.id = p_task_id
          AND (
              public.is_org_admin()
              OR t.requester_id = auth.uid()
              OR t.assignee_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.task_teams tt
                  WHERE tt.task_id = t.id AND public.leads_team(tt.team_id)
              )
          )
    );
$$;

REVOKE ALL ON FUNCTION public.can_edit_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_task(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_task_insert_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
    -- Service/cron work has no end-user identity and is governed by its own function grants.
    IF auth.uid() IS NULL THEN RETURN NEW; END IF;

    NEW.requester_id := auth.uid();
    NEW.assignee_id := NULL;
    NEW.assigned_by_id := NULL;
    NEW.assigned_date := NULL;
    NEW.accepted_date := NULL;
    NEW.completed_date := NULL;
    NEW.status := 'new_request';

    IF NEW.parent_task_id IS NULL THEN
        NEW.is_subtask := false;
        NEW.sort_order := 0;
    ELSIF NOT public.can_edit_task(NEW.parent_task_id) THEN
        RAISE EXCEPTION 'You cannot add a subtask to that task.';
    ELSE
        NEW.is_subtask := true;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_task_insert_identity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_task_insert_identity ON public.tasks;
CREATE TRIGGER trg_enforce_task_insert_identity
    BEFORE INSERT ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.enforce_task_insert_identity();

DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks
    FOR UPDATE TO authenticated
    USING (public.can_edit_task(id))
    WITH CHECK (public.can_edit_task(id));

-- Column grants are the hard boundary for handcrafted Data API requests. SECURITY DEFINER
-- workflow functions remain able to update the protected columns as the table owner.
REVOKE UPDATE ON TABLE public.tasks FROM authenticated;
GRANT UPDATE (
    title,
    description,
    category_id,
    client_id,
    department,
    priority,
    estimated_hours,
    actual_hours,
    due_date,
    proposed_start_date,
    proposed_end_date,
    checklist,
    tags,
    region_id,
    custom_fields
) ON TABLE public.tasks TO authenticated;

CREATE OR REPLACE FUNCTION public.set_task_status(p_task_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_old_status text;
    v_allowed constant text[] := ARRAY[
        'new_request', 'awaiting_assignment', 'scheduled', 'manager_review_required',
        'in_progress', 'changes_requested', 'in_review', 'on_hold', 'blocked',
        'waiting_for_information', 'waiting_for_approval', 'completed', 'cancelled'
    ];
BEGIN
    IF NOT public.can_edit_task(p_task_id) THEN
        RAISE EXCEPTION 'You cannot edit this task.';
    END IF;
    IF NOT p_status = ANY(v_allowed) THEN
        RAISE EXCEPTION 'That status is controlled by the assignment workflow.';
    END IF;

    SELECT status INTO v_old_status FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Task not found.'; END IF;
    IF v_old_status = 'awaiting_employee_approval' THEN
        RAISE EXCEPTION 'The pending assignee must accept or reject this task first.';
    END IF;

    UPDATE public.tasks
    SET status = p_status,
        completed_date = CASE
            WHEN p_status = 'completed' THEN COALESCE(completed_date, timezone('utc', now()))
            ELSE NULL
        END
    WHERE id = p_task_id;

    INSERT INTO public.task_activity (task_id, actor_id, type, detail)
    VALUES (p_task_id, auth.uid(), 'status_changed', jsonb_build_object(
        'from', v_old_status, 'to', p_status
    ));

    RETURN jsonb_build_object('ok', true, 'status', p_status);
END;
$$;

REVOKE ALL ON FUNCTION public.set_task_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_task_status(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_subtask(p_parent_task_id uuid, p_title text DEFAULT '')
RETURNS public.tasks
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_parent public.tasks%ROWTYPE;
    v_created public.tasks%ROWTYPE;
    v_depth integer;
    v_position bigint;
BEGIN
    IF NOT public.can_edit_task(p_parent_task_id) THEN
        RAISE EXCEPTION 'You cannot edit this task.';
    END IF;

    SELECT * INTO v_parent FROM public.tasks WHERE id = p_parent_task_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Parent task not found.'; END IF;

    WITH RECURSIVE ancestors AS (
        SELECT t.id, t.parent_task_id, 1 AS depth
        FROM public.tasks t WHERE t.id = p_parent_task_id
        UNION ALL
        SELECT t.id, t.parent_task_id, a.depth + 1
        FROM public.tasks t JOIN ancestors a ON t.id = a.parent_task_id
        WHERE a.depth < 10
    )
    SELECT max(depth) INTO v_depth FROM ancestors;
    IF COALESCE(v_depth, 1) >= 4 THEN
        RAISE EXCEPTION 'Subtasks cannot be nested more than four levels.';
    END IF;

    SELECT COALESCE(max(sort_order), -1) + 1 INTO v_position
    FROM public.tasks WHERE parent_task_id = p_parent_task_id;

    INSERT INTO public.tasks (
        title, description, category_id, client_id, department, requester_id, priority,
        status, estimated_hours, due_date, proposed_start_date, proposed_end_date,
        parent_task_id, is_subtask, checklist, region_id, custom_fields, sort_order
    ) VALUES (
        COALESCE(p_title, ''), '', v_parent.category_id, v_parent.client_id,
        v_parent.department, auth.uid(), v_parent.priority, 'new_request', 0,
        v_parent.due_date, v_parent.proposed_start_date, v_parent.proposed_end_date,
        p_parent_task_id, true, '[]'::jsonb, v_parent.region_id, '{}'::jsonb, v_position
    ) RETURNING * INTO v_created;

    INSERT INTO public.task_teams (task_id, team_id)
    SELECT v_created.id, tt.team_id FROM public.task_teams tt
    WHERE tt.task_id = p_parent_task_id
    ON CONFLICT DO NOTHING;

    RETURN v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.create_subtask(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_subtask(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reorder_subtasks(p_parent_task_id uuid, p_ordered_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_child_count integer;
BEGIN
    IF p_ordered_ids IS NULL OR NOT public.can_edit_task(p_parent_task_id) THEN
        RAISE EXCEPTION 'You cannot edit this task.';
    END IF;

    -- A row lock serializes simultaneous reorder requests for this parent.
    PERFORM 1 FROM public.tasks WHERE id = p_parent_task_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Parent task not found.'; END IF;

    SELECT count(*) INTO v_child_count
    FROM public.tasks WHERE parent_task_id = p_parent_task_id;

    IF cardinality(p_ordered_ids) <> v_child_count
       OR cardinality(p_ordered_ids) <> (
           SELECT count(DISTINCT id) FROM unnest(p_ordered_ids) AS ids(id)
       )
       OR EXISTS (
           SELECT 1 FROM unnest(p_ordered_ids) AS ids(id)
           WHERE NOT EXISTS (
               SELECT 1 FROM public.tasks t
               WHERE t.id = ids.id AND t.parent_task_id = p_parent_task_id
           )
       ) THEN
        RAISE EXCEPTION 'The submitted order must contain every subtask exactly once.';
    END IF;

    UPDATE public.tasks t
    SET sort_order = ordered.position - 1
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS ordered(id, position)
    WHERE t.id = ordered.id AND t.parent_task_id = p_parent_task_id;

    RETURN jsonb_build_object('ok', true, 'count', v_child_count);
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_subtasks(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_subtasks(uuid, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.detach_subtask(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
    IF NOT public.can_edit_task(p_task_id) THEN
        RAISE EXCEPTION 'You cannot edit this task.';
    END IF;
    UPDATE public.tasks
    SET parent_task_id = NULL, is_subtask = false, sort_order = 0
    WHERE id = p_task_id AND parent_task_id IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Subtask not found.'; END IF;
    RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.detach_subtask(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detach_subtask(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.duplicate_subtask(p_task_id uuid)
RETURNS public.tasks
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_source public.tasks%ROWTYPE;
    v_created public.tasks%ROWTYPE;
BEGIN
    SELECT * INTO v_source FROM public.tasks WHERE id = p_task_id AND parent_task_id IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Subtask not found.'; END IF;
    IF NOT public.can_edit_task(v_source.parent_task_id) THEN
        RAISE EXCEPTION 'You cannot edit this task.';
    END IF;

    UPDATE public.tasks
    SET sort_order = sort_order + 1
    WHERE parent_task_id = v_source.parent_task_id AND sort_order > v_source.sort_order;

    INSERT INTO public.tasks (
        title, description, category_id, client_id, department, requester_id, priority,
        status, estimated_hours, actual_hours, due_date, proposed_start_date,
        proposed_end_date, parent_task_id, is_subtask, checklist, region_id,
        custom_fields, sort_order
    ) VALUES (
        v_source.title || ' (copy)', v_source.description, v_source.category_id,
        v_source.client_id, v_source.department, auth.uid(), v_source.priority,
        'new_request', v_source.estimated_hours, 0, v_source.due_date,
        v_source.proposed_start_date, v_source.proposed_end_date, v_source.parent_task_id,
        true, v_source.checklist, v_source.region_id, v_source.custom_fields,
        v_source.sort_order + 1
    ) RETURNING * INTO v_created;

    INSERT INTO public.task_teams (task_id, team_id)
    SELECT v_created.id, tt.team_id FROM public.task_teams tt WHERE tt.task_id = p_task_id
    ON CONFLICT DO NOTHING;
    INSERT INTO public.task_tags (task_id, tag_id)
    SELECT v_created.id, tt.tag_id FROM public.task_tags tt WHERE tt.task_id = p_task_id
    ON CONFLICT DO NOTHING;

    RETURN v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.duplicate_subtask(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_subtask(uuid) TO authenticated;
