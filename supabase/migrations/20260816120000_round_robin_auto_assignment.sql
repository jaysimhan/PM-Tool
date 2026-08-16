-- ---------------------------------------------------------------------------------------
-- Round-robin auto-assignment.
--
-- Nothing in this system has ever assigned a task on its own. Every path that creates one --
-- the in-app request form, the public form, anything added later -- inserted the row and
-- stopped there, and `enforce_task_insert_identity` nulls `assignee_id` on the way in, so a
-- task could not arrive pre-assigned even if a caller tried. Work sat in `new_request` until
-- somebody opened the review queue and picked a name by hand. The preference tables the round
-- robin was meant to read (`user_clients`, `user_regions`, added 20260802140000) have existed
-- this whole time with nothing reading them.
--
-- This adds the half that was missing. It hangs off an AFTER INSERT trigger rather than a call
-- the request form makes, because a creation path that forgets to ask is otherwise a path
-- where assignment silently goes back to being manual -- which is the bug being fixed here.
-- ---------------------------------------------------------------------------------------


-- ---------------------------------------------------------------------------------------
-- 1. Placing an assignment, separated from who is allowed to ask for one.
--
-- `assign_task` did two things: it decided the caller was entitled to assign, then it wrote
-- the offer and the task together. The round robin needs the second half without the first --
-- it acts for the system, on behalf of a requester who is very often not entitled to assign
-- anything. Rather than a second copy of the two writes that can drift from this one, the
-- writes move here and `assign_task` keeps the permission check and delegates.
--
-- p_assigned_by is the person to credit, or NULL when the system chose. NULL is also what
-- makes auto-acceptance impossible on this path: work is only ever auto-accepted when somebody
-- picked themselves, and the system picking you is not you picking yourself.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.place_assignment(
    p_task_id     uuid,
    p_user_id     uuid,
    p_assigned_by uuid,
    p_auto_accept boolean DEFAULT false
)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    v_task          public.tasks;
    v_target        public.users;
    v_assignment_id uuid;
    v_accept        boolean;
BEGIN
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
    v_accept := COALESCE(p_auto_accept, false)
                AND p_assigned_by IS NOT NULL
                AND p_user_id = p_assigned_by;

    INSERT INTO public.assignments (
        task_id, user_id, assigned_by_id, status, assigned_date,
        response_date, estimated_hours, proposed_start_date, proposed_end_date
    )
    VALUES (
        p_task_id, p_user_id, p_assigned_by,
        CASE WHEN v_accept THEN 'accepted' ELSE 'pending' END,
        timezone('utc', now()),
        CASE WHEN v_accept THEN timezone('utc', now()) END,
        v_task.estimated_hours, v_task.proposed_start_date, v_task.proposed_end_date
    )
    RETURNING id INTO v_assignment_id;

    UPDATE public.tasks
       SET assignee_id = p_user_id,
           assigned_by_id = p_assigned_by,
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

ALTER FUNCTION public.place_assignment(uuid, uuid, uuid, boolean) OWNER TO postgres;

-- Nobody calls this from outside. It is the half of `assign_task` that does not ask whether
-- the caller may assign, so reaching it directly is exactly the thing to prevent.
REVOKE ALL ON FUNCTION public.place_assignment(uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;


-- `assign_task` keeps its signature, its permission check and its return shape; the body it
-- used to carry now lives above.
CREATE OR REPLACE FUNCTION public.assign_task(
    p_task_id     uuid,
    p_user_id     uuid,
    p_auto_accept boolean DEFAULT false
)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
    IF NOT public.can_assign_work() THEN
        RAISE EXCEPTION 'Only an admin, manager or team leader can assign work.';
    END IF;

    RETURN public.place_assignment(p_task_id, p_user_id, auth.uid(), p_auto_accept);
END;
$$;

ALTER FUNCTION public.assign_task(uuid, uuid, boolean) OWNER TO postgres;

-- Unchanged posture: the browser reaches assignment through assign_task_checked, which locks
-- the row it thought it was looking at before delegating here.
REVOKE ALL ON FUNCTION public.assign_task(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;


-- ---------------------------------------------------------------------------------------
-- 2. Nobody could take it.
--
-- The round robin declining to place a task is a normal outcome, not a failure: it means
-- everyone who could have done it is unavailable, or nobody has said they want this brand or
-- region. The task stays in the pool and the people who can place it by hand are told, because
-- manual assignment is deliberately wider than the round robin -- it goes on skill alone and
-- ignores brand, region and team, so a human has options the round robin does not.
--
-- Same recipients as notify_reassignment_needed: admins and super admins always, and the
-- leaders of whichever teams the work belonged to.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_manual_assignment_needed(
    p_task_id  uuid,
    p_team_ids uuid[],
    p_reason   text
)
    RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    v_title    text;
    v_notified integer;
BEGIN
    SELECT t.title INTO v_title FROM public.tasks t WHERE t.id = p_task_id;
    IF v_title IS NULL THEN RETURN 0; END IF;

    INSERT INTO public.notifications (user_id, type, title, message, is_read, link)
    SELECT
        recipient.id,
        'manual_assignment_needed',
        'A task needs assigning by hand',
        v_title || ' could not be assigned automatically: ' || p_reason
            || '. Assigning by hand can go to anyone with the skill.',
        false,
        '/tasks/' || p_task_id::text
    FROM public.users recipient
    WHERE recipient.is_active
      AND recipient.deleted_at IS NULL
      AND (
          recipient.role IN ('super_admin', 'admin')
          OR (
              recipient.role = 'team_leader'
              AND p_team_ids IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM public.team_members tm
                  WHERE tm.user_id = recipient.id AND tm.team_id = ANY (p_team_ids)
              )
          )
      );

    GET DIAGNOSTICS v_notified = ROW_COUNT;
    RETURN v_notified;
END;
$$;

ALTER FUNCTION public.notify_manual_assignment_needed(uuid, uuid[], text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.notify_manual_assignment_needed(uuid, uuid[], text) FROM PUBLIC, anon, authenticated;


-- ---------------------------------------------------------------------------------------
-- 3. Choosing who gets it.
--
-- Four questions in order, and the task is only placed if all four have an answer.
--
-- WHICH TEAM. `task_teams` if something set it, else the work category's teams, else the teams
-- that hold the required skill. That last fallback is not decoration: the in-app request form
-- writes the Work Category picker's answer to `task_skills` and leaves `tasks.category_id`
-- null, so for a task somebody creates in the app the skill is the only route to a team, and
-- without this step the round robin would find no pool and decline every single one of them.
--
-- WHICH SKILL. `task_skills` for the task, falling back to the work category's skills. A task
-- with no skill recorded either way does not narrow the pool rather than emptying it -- the
-- team is then the whole answer to who could do this.
--
-- WHO IS AVAILABLE. Active, not deleted, finished onboarding, actually a member (an invitee
-- has not finished setting up and a requester never joined), and not booked out on leave for
-- the whole of today. Anyone with an hour left is a candidate; how full their week is belongs
-- to the workload pages, not to whether they may be offered work at all.
--
-- WHO WANTS IT. `user_clients` and `user_regions` are preferences, and the round robin honours
-- them -- a person is only handed work for a brand and a region they picked. A task carrying
-- no brand or no region does not apply that half of the filter, because there is nothing to
-- have a preference about.
--
-- Then round robin proper: of everyone left, whoever has gone longest without being handed
-- anything. Never-assigned sorts first, so a new joiner starts at the front rather than last.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auto_assign_task(
    p_task_id           uuid,
    p_notify_unresolved boolean DEFAULT false
)
    RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    v_task      public.tasks;
    v_skills    uuid[];
    v_teams     uuid[];
    v_chosen    uuid;
BEGIN
    SELECT * INTO v_task FROM public.tasks t WHERE t.id = p_task_id;
    IF v_task.id IS NULL THEN RETURN NULL; END IF;

    -- Called from two places for one task (see the triggers below), so placing it twice has to
    -- be impossible. The status is half of that guard rather than the assignee alone: adding a
    -- skill to work that is already under way must not hand it to somebody else.
    IF v_task.assignee_id IS NOT NULL
       OR v_task.status <> 'new_request'
       OR v_task.parent_task_id IS NOT NULL THEN
        RETURN NULL;
    END IF;

    -- Required skill: the task's own, else the work category's.
    SELECT array_agg(skill_id) INTO v_skills
    FROM (
        SELECT ts.skill_id FROM public.task_skills ts WHERE ts.task_id = p_task_id
        UNION
        SELECT wcs.skill_id FROM public.work_category_skills wcs
        WHERE v_task.category_id IS NOT NULL
          AND wcs.category_id = v_task.category_id
          AND NOT EXISTS (SELECT 1 FROM public.task_skills ts2 WHERE ts2.task_id = p_task_id)
    ) s;

    -- Owning team: explicit, else the category's, else whoever holds the skill.
    SELECT array_agg(DISTINCT team_id) INTO v_teams
    FROM (
        SELECT tt.team_id FROM public.task_teams tt WHERE tt.task_id = p_task_id
        UNION
        SELECT wct.team_id FROM public.work_category_teams wct
        WHERE v_task.category_id IS NOT NULL
          AND wct.category_id = v_task.category_id
          AND NOT EXISTS (SELECT 1 FROM public.task_teams tt2 WHERE tt2.task_id = p_task_id)
        UNION
        SELECT tsk.team_id FROM public.team_skills tsk
        WHERE v_skills IS NOT NULL
          AND tsk.skill_id = ANY (v_skills)
          AND NOT EXISTS (SELECT 1 FROM public.task_teams tt3 WHERE tt3.task_id = p_task_id)
          AND NOT EXISTS (
              SELECT 1 FROM public.work_category_teams wct2
              WHERE v_task.category_id IS NOT NULL AND wct2.category_id = v_task.category_id
          )
    ) t;

    -- No team resolved. On the task-insert attempt this usually means "too early" rather than
    -- "impossible" -- the skill is still one HTTP call away -- so that caller passes false and
    -- the attempt goes quiet. The task_skills caller passes true, because by then the skill is
    -- known and "nothing holds this skill" is a real answer somebody should act on.
    IF v_teams IS NULL OR cardinality(v_teams) = 0 THEN
        IF p_notify_unresolved THEN
            PERFORM public.notify_manual_assignment_needed(
                p_task_id, NULL,
                'no team holds the skill this work needs'
            );
        END IF;
        RETURN NULL;
    END IF;

    SELECT u.id INTO v_chosen
    FROM public.users u
    WHERE u.is_active
      AND u.deleted_at IS NULL
      AND u.onboarding_completed
      AND u.role NOT IN ('invitee', 'requester')
      AND EXISTS (
          SELECT 1 FROM public.team_members tm
          WHERE tm.user_id = u.id AND tm.team_id = ANY (v_teams)
      )
      -- No skill recorded anywhere leaves the team as the whole answer.
      AND (
          v_skills IS NULL
          OR EXISTS (
              SELECT 1 FROM public.user_skills us
              WHERE us.user_id = u.id AND us.skill_id = ANY (v_skills)
          )
      )
      -- Booked out for the whole of today. A partial day still leaves time to be offered work.
      AND COALESCE((
          SELECT sum(LEAST(COALESCE(l.hours, u.daily_capacity), u.daily_capacity))
          FROM public.leaves l
          WHERE l.user_id = u.id
            AND l.start_date <= (timezone('utc', now()))::date
            AND l.end_date >= (timezone('utc', now()))::date
      ), 0) < u.daily_capacity
      AND (
          v_task.client_id IS NULL
          OR EXISTS (
              SELECT 1 FROM public.user_clients uc
              WHERE uc.user_id = u.id AND uc.client_id = v_task.client_id
          )
      )
      AND (
          v_task.region_id IS NULL
          OR EXISTS (
              SELECT 1 FROM public.user_regions ur
              WHERE ur.user_id = u.id AND ur.region_id = v_task.region_id
          )
      )
    ORDER BY
        (SELECT max(a.assigned_date) FROM public.assignments a WHERE a.user_id = u.id)
            ASC NULLS FIRST,
        u.created_at ASC,
        u.id ASC
    LIMIT 1;

    IF v_chosen IS NULL THEN
        PERFORM public.notify_manual_assignment_needed(
            p_task_id, v_teams,
            'nobody on the team was available for this brand and region'
        );
        RETURN NULL;
    END IF;

    -- NULL assigner: the system chose, so there is no one to credit and no auto-acceptance.
    -- The person gets an offer and confirms their own hours and deadline, exactly as they
    -- would if a manager had picked them.
    PERFORM public.place_assignment(p_task_id, v_chosen, NULL, false);
    RETURN v_chosen;
END;
$$;

ALTER FUNCTION public.auto_assign_task(uuid, boolean) OWNER TO postgres;

-- The triggers are the only callers. Exposed, this would be an assignment that skips
-- can_assign_work entirely.
REVOKE ALL ON FUNCTION public.auto_assign_task(uuid, boolean) FROM PUBLIC, anon, authenticated;


-- ---------------------------------------------------------------------------------------
-- 4. When to try.
--
-- Twice, because of the order the request forms write in. Both of them -- the in-app form at
-- RequestForm.handleSubmit and the `submit_public_request` RPC -- insert the task first and
-- the Work Category's skill into `task_skills` immediately afterwards, and the in-app one does
-- it as a second HTTP call, so a second transaction. A task-insert trigger on its own would
-- therefore look for the skill before it existed, resolve no team, and decline every request
-- that came through a form: the bug this migration exists to fix, moved rather than removed.
--
-- So: try when the task appears, in case its category already answers who owns it, and try
-- again when its skill arrives. `auto_assign_task` returns early on a task that is already
-- assigned or already moved on, so whichever attempt gets there first is the one that counts
-- and the other is a no-op.
--
-- Subtasks never qualify. They are created inside a task by whoever is already working it, and
-- round-robining each one to a stranger would scatter a single piece of work across the team.
--
-- Both wrappers swallow failures: a request that cannot be placed must still be a request. If
-- the selection raises, the task survives unassigned and the people who can place it by hand
-- are told -- the same outcome as nobody being available, handled the same way.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auto_assign_on_task_insert()
    RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
    BEGIN
        -- Quiet on an unresolved team: the skill may still be a call away.
        PERFORM public.auto_assign_task(NEW.id, false);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Auto-assignment failed for task %: %', NEW.id, SQLERRM;
        PERFORM public.notify_manual_assignment_needed(
            NEW.id, NULL, 'automatic assignment could not be completed'
        );
    END;
    RETURN NULL;
END;
$$;

ALTER FUNCTION public.auto_assign_on_task_insert() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.auto_assign_on_task_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_auto_assign_on_task_insert ON public.tasks;
CREATE TRIGGER trg_auto_assign_on_task_insert
    AFTER INSERT ON public.tasks
    FOR EACH ROW
    WHEN (NEW.parent_task_id IS NULL AND NEW.assignee_id IS NULL)
    EXECUTE FUNCTION public.auto_assign_on_task_insert();


CREATE OR REPLACE FUNCTION public.auto_assign_on_task_skill()
    RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
    BEGIN
        -- The skill is known now, so an unresolved team is a real answer worth reporting.
        PERFORM public.auto_assign_task(NEW.task_id, true);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Auto-assignment failed for task %: %', NEW.task_id, SQLERRM;
        PERFORM public.notify_manual_assignment_needed(
            NEW.task_id, NULL, 'automatic assignment could not be completed'
        );
    END;
    RETURN NULL;
END;
$$;

ALTER FUNCTION public.auto_assign_on_task_skill() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.auto_assign_on_task_skill() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_auto_assign_on_task_skill ON public.task_skills;
CREATE TRIGGER trg_auto_assign_on_task_skill
    AFTER INSERT ON public.task_skills
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_assign_on_task_skill();


-- The round robin's ordering is "max(assigned_date) per user", asked once per task created.
CREATE INDEX IF NOT EXISTS assignments_user_id_assigned_date_idx
    ON public.assignments (user_id, assigned_date DESC);
