-- Work is offered, not imposed.
--
-- Assigning a task used to be one column write: tasks.assignee_id, straight from the browser,
-- and the person on the other end found out by noticing. There was an assignments table for
-- exactly this -- task, person, pending/accepted/rejected, the dates and hours they agreed to
-- -- but nothing had ever written a row to it, so 20260802170000_lock_down_data_api.sql left
-- it SELECT-only and called it legacy.
--
-- It stops being legacy here. Assigning creates a pending offer; the assignee sees a
-- notification, confirms or changes the deadline and the hours, and only then does the task
-- become theirs. Turning it down sends it back to the pool with a reason attached.
--
-- Every write goes through a definer function and the table stays closed to the client. The
-- rules below -- who may assign, who may answer, what may follow what -- are only rules if the
-- browser cannot go around them, and a GRANT INSERT would let it: any signed-in person could
-- write an accepted assignment for somebody else, or accept on their behalf. The three
-- functions here are the only way in.

-- ---------------------------------------------------------------------------------------
-- 1. The table it should have been.
--
-- Empty today, which is what makes the NOT NULLs free. If it somehow is not, the migration
-- says so rather than deleting the evidence.
-- ---------------------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.assignments WHERE task_id IS NULL OR user_id IS NULL) THEN
        RAISE EXCEPTION 'public.assignments holds rows with a null task_id or user_id; resolve those before this migration can constrain the columns.';
    END IF;
END
$$;

UPDATE public.assignments SET status = 'pending' WHERE status IS NULL;
UPDATE public.assignments
   SET assigned_date = COALESCE(created_at, timezone('utc', now()))
 WHERE assigned_date IS NULL;

ALTER TABLE public.assignments
    ALTER COLUMN status        SET DEFAULT 'pending',
    ALTER COLUMN assigned_date SET DEFAULT timezone('utc', now()),
    ALTER COLUMN task_id       SET NOT NULL,
    ALTER COLUMN user_id       SET NOT NULL,
    ALTER COLUMN status        SET NOT NULL,
    ALTER COLUMN assigned_date SET NOT NULL;

ALTER TABLE public.assignments DROP CONSTRAINT IF EXISTS assignments_status_check;
ALTER TABLE public.assignments
    ADD CONSTRAINT assignments_status_check
    CHECK (status IN ('pending', 'accepted', 'rejected', 'reassigned'));

-- One open offer per task. Everything answered stays as history -- a task that was turned
-- down twice before it stuck should be able to say so -- so the uniqueness is partial.
CREATE UNIQUE INDEX IF NOT EXISTS assignments_one_pending_per_task
    ON public.assignments (task_id) WHERE status = 'pending';

-- The two queries this table exists to answer: what is waiting for me, and what happened to
-- this task. Neither had an index; there were no indexes on it at all beyond the primary key.
CREATE INDEX IF NOT EXISTS assignments_user_status_idx ON public.assignments (user_id, status);
CREATE INDEX IF NOT EXISTS assignments_task_id_idx     ON public.assignments (task_id);

-- The bell reads exactly this, thirty rows at a time, on every page load.
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
    ON public.notifications (user_id, created_at DESC);

-- ---------------------------------------------------------------------------------------
-- 2. Who may hand out work.
--
-- is_team_manager() is close but not this: it covers admin, super_admin and team_leader, and
-- 'manager' is a role in this schema that it deliberately leaves out. Four policies already
-- depend on that function meaning what it means, so this is a new one rather than a widening.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_assign_work()
    RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid()
          AND u.role IN ('super_admin', 'admin', 'manager', 'team_leader')
          AND u.is_active
          AND u.deleted_at IS NULL
    );
$$;

REVOKE ALL ON FUNCTION public.can_assign_work() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_assign_work() TO authenticated;

-- ---------------------------------------------------------------------------------------
-- 3. Who may read an offer.
--
-- It was every signed-in person, for every row -- which now matters in a way it did not when
-- the table was empty, because rejection_reason is somebody explaining why they did not want
-- a piece of work. Their own offers, and the people whose job it is to place work.
--
-- No INSERT and no UPDATE grant, on purpose. See the header.
-- ---------------------------------------------------------------------------------------

DROP POLICY IF EXISTS assignments_select ON public.assignments;
CREATE POLICY assignments_select ON public.assignments
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR public.can_assign_work());

-- ---------------------------------------------------------------------------------------
-- 4. What the task has been through.
--
-- The activity tab renders three events today, and all three are inferred from columns on the
-- task: it was submitted, it was converted, it was assigned. Nothing that has happened *to* a
-- task is written down anywhere, so anything the columns cannot imply is simply lost -- and
-- the figures a task is delivered against are exactly that. The requester asks for eight hours
-- by Friday, the assignee accepts four hours by Wednesday, and the task now reads as though
-- four by Wednesday is what was always wanted.
--
-- So the originals go on the record, next to what replaced them and who did it.
--
-- Readable by anyone who can read the task -- the same bar tasks_select draws -- because the
-- point of it is that the requester and the assigner can see what changed. Writable by nobody:
-- there is no INSERT grant, and the definer functions below are the only things that add to
-- it, which is what stops a history from being edited by the people it is about.
-- ---------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.task_activity (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    type text NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.task_activity ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.task_activity FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.task_activity TO authenticated;

DROP POLICY IF EXISTS task_activity_select ON public.task_activity;
CREATE POLICY task_activity_select ON public.task_activity
    FOR SELECT TO authenticated
    USING (public.is_live_user());

-- The panel reads one task's history, newest last.
CREATE INDEX IF NOT EXISTS task_activity_task_created_idx
    ON public.task_activity (task_id, created_at);

-- ---------------------------------------------------------------------------------------
-- 5. Telling them.
--
-- The link carries the task, not the page. The bell already turns /tasks/<uuid> into
-- /tasks?task=<uuid> and opens that task's panel, where the accept banner is -- see
-- resolveNotificationLink in DashboardLayout. A link to /approval would arrive saying
-- "something is waiting" and leave the reader to work out which of their tasks it meant.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_on_assignment()
    RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    v_title text;
BEGIN
    SELECT t.title INTO v_title FROM public.tasks t WHERE t.id = NEW.task_id;

    INSERT INTO public.notifications (user_id, type, title, message, is_read, link)
    VALUES (
        NEW.user_id,
        'task_assignment',
        'New task assignment',
        COALESCE(v_title, 'A task') || ' has been assigned to you. Confirm the deadline and hours to accept it.',
        false,
        '/tasks/' || NEW.task_id::text
    );

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_on_assignment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_on_assignment ON public.assignments;
CREATE TRIGGER trg_notify_on_assignment
    AFTER INSERT ON public.assignments
    FOR EACH ROW
    WHEN (NEW.status = 'pending')
    EXECUTE FUNCTION public.notify_on_assignment();

-- ---------------------------------------------------------------------------------------
-- 6. Assigning.
--
-- Replaces the client-side `update tasks set assignee_id`. The task and the offer move
-- together or not at all, which is the whole reason this is a function: two writes from the
-- browser can be interrupted between them, and the half that lands is a task assigned to
-- somebody who was never asked.
--
-- p_user_id NULL means take it off them -- back to the pool, no offer, no notification.
--
-- Role does not narrow who may receive work. The round robin goes to everyone on the team who
-- holds the skill -- leaders, managers and admins included -- so the only people refused here
-- are the ones who are not members at all: an invitee has not finished setting up, a requester
-- never joined. Everybody else is eligible, whatever their role says.
--
-- p_auto_accept is the difference between choosing work and being handed it, and it is passed
-- rather than inferred from "did the caller name themselves". Picking yourself out of the
-- assignee list is a decision already made, so the manual path passes true and skips the
-- approval step. A round robin that happens to land on the admin who started it has decided
-- nothing on their behalf, so it passes nothing and they get an offer like anyone else.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assign_task(
    p_task_id     uuid,
    p_user_id     uuid,
    p_auto_accept boolean DEFAULT false
)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    v_caller        uuid := auth.uid();
    v_task          public.tasks;
    v_target        public.users;
    v_assignment_id uuid;
    v_accept        boolean;
BEGIN
    IF NOT public.can_assign_work() THEN
        RAISE EXCEPTION 'Only an admin, manager or team leader can assign work.';
    END IF;

    SELECT * INTO v_task FROM public.tasks t WHERE t.id = p_task_id;
    IF v_task.id IS NULL THEN
        RAISE EXCEPTION 'That task no longer exists.';
    END IF;

    -- Whoever held this task holds it no longer, whether this is a reassignment or an
    -- unassignment. Pending and accepted both, and for different reasons: a pending row left
    -- alone keeps the task sitting in somebody's approval queue after it has moved on, and
    -- the partial unique index would refuse the new offer; an accepted row left alone says
    -- they are still doing it, so a task handed from one person to another would read as
    -- though both had it. Rejections stay as they are -- a refusal happened and is not undone
    -- by what came next.
    UPDATE public.assignments
       SET status = 'reassigned',
           response_date = timezone('utc', now())
     WHERE task_id = p_task_id AND status IN ('pending', 'accepted');

    IF p_user_id IS NULL THEN
        UPDATE public.tasks
           SET assignee_id = NULL,
               assigned_by_id = NULL,
               assigned_date = NULL,
               accepted_date = NULL,
               status = 'awaiting_assignment'
         WHERE id = p_task_id;

        RETURN jsonb_build_object('ok', true, 'assigned', false);
    END IF;

    SELECT * INTO v_target FROM public.users u WHERE u.id = p_user_id;
    IF v_target.id IS NULL THEN
        RAISE EXCEPTION 'That person no longer exists.';
    END IF;
    IF v_target.is_active = false OR v_target.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION '% is no longer active and cannot be given work.', v_target.name;
    END IF;
    -- The only bar, and it is about membership rather than rank: an invitee has not finished
    -- setting up and a requester never joined. Every actual member is assignable.
    IF v_target.role IN ('invitee', 'requester') THEN
        RAISE EXCEPTION '% has not joined the organisation yet and cannot be given work.', v_target.name;
    END IF;

    -- Accepting on somebody else's behalf is the one thing this flag must never do.
    v_accept := COALESCE(p_auto_accept, false) AND p_user_id = v_caller;

    INSERT INTO public.assignments (
        task_id, user_id, assigned_by_id, status, assigned_date,
        response_date, estimated_hours, proposed_start_date, proposed_end_date
    )
    VALUES (
        p_task_id, p_user_id, v_caller,
        CASE WHEN v_accept THEN 'accepted' ELSE 'pending' END,
        timezone('utc', now()),
        CASE WHEN v_accept THEN timezone('utc', now()) END,
        v_task.estimated_hours, v_task.proposed_start_date, v_task.proposed_end_date
    )
    RETURNING id INTO v_assignment_id;

    UPDATE public.tasks
       SET assignee_id = p_user_id,
           assigned_by_id = v_caller,
           assigned_date = timezone('utc', now()),
           accepted_date = CASE WHEN v_accept THEN timezone('utc', now()) ELSE NULL END,
           status = CASE WHEN v_accept THEN 'accepted' ELSE 'awaiting_employee_approval' END
     WHERE id = p_task_id;

    RETURN jsonb_build_object(
        'ok', true,
        'assigned', true,
        'assignmentId', v_assignment_id,
        'autoAccepted', v_accept
    );
END;
$$;

REVOKE ALL ON FUNCTION public.assign_task(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_task(uuid, uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------------------
-- 7. Accepting.
--
-- The deadline and the hours the assignee confirms here are the ones the task carries from
-- now on. They arrive pre-filled from whatever the requester or the assigner put there, and
-- they are editable, because the person doing the work is the one who knows how long it takes
-- -- that is the point of asking. The requester's original figures are not kept anywhere.
--
-- Dates make it 'scheduled' rather than 'accepted': agreeing to do something is not the same
-- as saying when, and the board has a column for each.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accept_assignment(
    p_assignment_id  uuid,
    p_deadline       date,
    p_estimated_hours numeric,
    p_start_date     date DEFAULT NULL,
    p_end_date       date DEFAULT NULL
)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    v_assignment public.assignments;
    v_task       public.tasks;
    v_status     text;
    v_moved_date boolean;
    v_moved_hours boolean;
BEGIN
    SELECT * INTO v_assignment FROM public.assignments a WHERE a.id = p_assignment_id;

    IF v_assignment.id IS NULL THEN
        RAISE EXCEPTION 'That assignment no longer exists.';
    END IF;
    IF v_assignment.user_id <> auth.uid() THEN
        RAISE EXCEPTION 'You can only accept your own assignments.';
    END IF;
    -- Not merely tidiness: without it, a second submission from a stale tab re-accepts work
    -- that has since been turned down or handed to somebody else.
    IF v_assignment.status <> 'pending' THEN
        RAISE EXCEPTION 'This assignment has already been answered.';
    END IF;

    IF p_deadline IS NULL THEN
        RAISE EXCEPTION 'A deadline is required.';
    END IF;
    IF p_estimated_hours IS NULL OR p_estimated_hours <= 0 THEN
        RAISE EXCEPTION 'Estimated hours must be greater than zero.';
    END IF;
    IF p_start_date IS NOT NULL AND p_end_date IS NOT NULL AND p_end_date < p_start_date THEN
        RAISE EXCEPTION 'The end date cannot fall before the start date.';
    END IF;

    v_status := CASE WHEN p_start_date IS NOT NULL OR p_end_date IS NOT NULL
                     THEN 'scheduled' ELSE 'accepted' END;

    -- Read the task before it is overwritten: these are the figures that were asked for, and
    -- in a moment they will not be anywhere.
    SELECT * INTO v_task FROM public.tasks t WHERE t.id = v_assignment.task_id;

    v_moved_date  := v_task.due_date::date IS DISTINCT FROM p_deadline;
    v_moved_hours := v_task.estimated_hours IS DISTINCT FROM p_estimated_hours;

    UPDATE public.assignments
       SET status = 'accepted',
           response_date = timezone('utc', now()),
           estimated_hours = p_estimated_hours,
           proposed_start_date = p_start_date,
           proposed_end_date = p_end_date
     WHERE id = p_assignment_id;

    UPDATE public.tasks
       SET status = v_status,
           due_date = p_deadline,
           estimated_hours = p_estimated_hours,
           proposed_start_date = p_start_date,
           proposed_end_date = p_end_date,
           accepted_date = timezone('utc', now())
     WHERE id = v_assignment.task_id;

    -- Only when something actually moved. Accepting the figures as they stood is agreement,
    -- not an event, and a history that records every acceptance identically is one nobody
    -- reads closely enough to notice the entries that matter.
    IF v_moved_date OR v_moved_hours THEN
        INSERT INTO public.task_activity (task_id, actor_id, type, detail)
        VALUES (
            v_assignment.task_id,
            auth.uid(),
            'estimates_revised_on_accept',
            jsonb_build_object(
                'dueDateChanged',        v_moved_date,
                'previousDueDate',       v_task.due_date,
                'newDueDate',            p_deadline,
                'estimatedHoursChanged', v_moved_hours,
                'previousEstimatedHours', v_task.estimated_hours,
                'newEstimatedHours',     p_estimated_hours
            )
        );
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'status', v_status,
        'dueDateChanged', v_moved_date,
        'estimatedHoursChanged', v_moved_hours
    );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_assignment(uuid, date, numeric, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_assignment(uuid, date, numeric, date, date) TO authenticated;

-- ---------------------------------------------------------------------------------------
-- 8. Turning it down.
--
-- Back to the pool, with the reason on the record and the person who assigned it told. A
-- refusal that only clears a column teaches nobody anything; the next assigner would make the
-- same choice.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reject_assignment(p_assignment_id uuid, p_reason text)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    v_assignment public.assignments;
    v_reason     text := nullif(btrim(p_reason), '');
    v_task_title text;
    v_who        text;
BEGIN
    SELECT * INTO v_assignment FROM public.assignments a WHERE a.id = p_assignment_id;

    IF v_assignment.id IS NULL THEN
        RAISE EXCEPTION 'That assignment no longer exists.';
    END IF;
    IF v_assignment.user_id <> auth.uid() THEN
        RAISE EXCEPTION 'You can only answer your own assignments.';
    END IF;
    IF v_assignment.status <> 'pending' THEN
        RAISE EXCEPTION 'This assignment has already been answered.';
    END IF;
    IF v_reason IS NULL THEN
        RAISE EXCEPTION 'Say why, so whoever assigned it can place it somewhere better.';
    END IF;

    UPDATE public.assignments
       SET status = 'rejected',
           response_date = timezone('utc', now()),
           rejection_reason = v_reason
     WHERE id = p_assignment_id;

    UPDATE public.tasks
       SET status = 'awaiting_assignment',
           assignee_id = NULL,
           assigned_date = NULL,
           assigned_by_id = NULL,
           accepted_date = NULL
     WHERE id = v_assignment.task_id;

    -- Nobody to tell if it was assigned by someone since deleted, and the refusal still stands.
    IF v_assignment.assigned_by_id IS NOT NULL THEN
        SELECT t.title INTO v_task_title FROM public.tasks t WHERE t.id = v_assignment.task_id;
        SELECT u.name  INTO v_who        FROM public.users u WHERE u.id = v_assignment.user_id;

        INSERT INTO public.notifications (user_id, type, title, message, is_read, link)
        VALUES (
            v_assignment.assigned_by_id,
            'assignment_rejected',
            'Task needs reassigning',
            COALESCE(v_who, 'Someone') || ' turned down ' || COALESCE(v_task_title, 'a task')
                || ': ' || v_reason,
            false,
            '/tasks/' || v_assignment.task_id::text
        );
    END IF;

    RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.reject_assignment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_assignment(uuid, text) TO authenticated;
