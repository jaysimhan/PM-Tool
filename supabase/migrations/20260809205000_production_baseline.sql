


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."accept_assignment"("p_assignment_id" "uuid", "p_deadline" "date", "p_estimated_hours" numeric, "p_start_date" "date" DEFAULT NULL::"date", "p_end_date" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
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


ALTER FUNCTION "public"."accept_assignment"("p_assignment_id" "uuid", "p_deadline" "date", "p_estimated_hours" numeric, "p_start_date" "date", "p_end_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."access_request_audience"() RETURNS TABLE("id" "uuid")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT u.id
    FROM public.users u
    WHERE u.role IN ('super_admin', 'admin', 'manager', 'team_leader')
      AND u.is_active
      AND u.deleted_at IS NULL;
$$;


ALTER FUNCTION "public"."access_request_audience"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_client_department"("p_client_id" "uuid", "p_department" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_current text;
    v_clean text := btrim(coalesce(p_department, ''));
BEGIN
    IF NOT public.is_live_user() THEN
        RAISE EXCEPTION 'You must be signed in.';
    END IF;

    IF v_clean = '' THEN
        RETURN jsonb_build_object('ok', true, 'added', false);
    END IF;

    IF length(v_clean) > 80 THEN
        RAISE EXCEPTION 'That department name is too long.';
    END IF;

    SELECT c.department INTO v_current FROM public.clients c WHERE c.id = p_client_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That brand no longer exists.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM unnest(string_to_array(coalesce(v_current, ''), ',')) AS existing(name)
        WHERE lower(btrim(existing.name)) = lower(v_clean)
    ) THEN
        RETURN jsonb_build_object('ok', true, 'added', false);
    END IF;

    UPDATE public.clients
    SET department = CASE
            WHEN coalesce(btrim(v_current), '') = '' THEN v_clean
            ELSE v_current || ', ' || v_clean
        END
    WHERE id = p_client_id;

    RETURN jsonb_build_object('ok', true, 'added', true);
END;
$$;


ALTER FUNCTION "public"."add_client_department"("p_client_id" "uuid", "p_department" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."aggregate_daily_kpis"("p_date" "date" DEFAULT CURRENT_DATE) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_written integer;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_org_admin() THEN
        RAISE EXCEPTION 'Only an admin can rebuild the dashboard snapshot.';
    END IF;

    DELETE FROM public.daily_kpi_snapshots WHERE snapshot_date = p_date;

    -- ── The headline numbers, mirroring the `stats` object the dashboard used to compute ──
    --
    -- Overdue and due-soon are measured against p_date rather than a hardcoded day. The
    -- component used to compare against a literal 2026-07-28, so both numbers had been
    -- answering for a date in the past that receded further every day the app stayed up.
    INSERT INTO public.daily_kpi_snapshots (snapshot_date, metric_name, metric_value)
    SELECT p_date, m.name, m.value
    FROM (
        -- The marker that says "this day was measured, not reconstructed".
        --
        -- backfill_daily_kpis writes a couple of metrics for past days from created_at and
        -- completed_date, and those days are otherwise indistinguishable from a real snapshot
        -- by their date alone. Without this, "the most recent day available" picks a
        -- backfilled day and the dashboard renders a page of blanks -- every headline number
        -- missing, every chart empty -- while looking like it loaded correctly.
        SELECT 'snapshot_complete' AS name, 1::numeric AS value
        UNION ALL
        SELECT 'total_requests', count(*)::numeric FROM public.tasks
        UNION ALL
        SELECT 'new_requests', count(*)::numeric FROM public.tasks
            WHERE status IN ('new_request', 'awaiting_assignment')
        UNION ALL
        SELECT 'active_tasks', count(*)::numeric FROM public.tasks
            WHERE status IN ('in_progress', 'scheduled', 'accepted')
        UNION ALL
        SELECT 'in_review', count(*)::numeric FROM public.tasks
            WHERE status = 'in_review'
        UNION ALL
        SELECT 'completed_tasks', count(*)::numeric FROM public.tasks
            WHERE status = 'completed'
        UNION ALL
        SELECT 'unassigned_tasks', count(*)::numeric FROM public.tasks
            WHERE assignee_id IS NULL
        UNION ALL
        SELECT 'overdue_tasks', count(*)::numeric FROM public.tasks
            WHERE due_date IS NOT NULL
              AND due_date < p_date::timestamptz
              AND status NOT IN ('completed', 'cancelled')
        UNION ALL
        -- Through the end of the third day, which is what "due in the next three days" means
        -- to a reader and what the component's midnight-to-midnight window nearly did.
        SELECT 'due_soon', count(*)::numeric FROM public.tasks
            WHERE due_date IS NOT NULL
              AND due_date >= p_date::timestamptz
              AND due_date < (p_date + 4)::timestamptz
              AND status NOT IN ('completed', 'cancelled')
        UNION ALL
        SELECT 'total_estimated_hours', COALESCE(sum(estimated_hours), 0)::numeric FROM public.tasks
        UNION ALL
        SELECT 'blocked_tasks', count(*)::numeric FROM public.tasks
            WHERE status = 'blocked'
        UNION ALL
        SELECT 'awaiting_acceptance', count(*)::numeric FROM public.tasks
            WHERE status = 'awaiting_employee_approval'
        UNION ALL
        -- The one flow metric. Totals tell you where things stand; this tells you what
        -- arrived, which is the only one of these that a range of days can be summed over.
        SELECT 'created_that_day', count(*)::numeric FROM public.tasks
            WHERE created_at >= p_date::timestamptz
              AND created_at < (p_date + 1)::timestamptz
        UNION ALL
        SELECT 'completed_that_day', count(*)::numeric FROM public.tasks
            WHERE completed_date IS NOT NULL
              AND completed_date >= p_date::timestamptz
              AND completed_date < (p_date + 1)::timestamptz
    ) m;

    -- ── Status and priority distributions ──
    INSERT INTO public.daily_kpi_snapshots (snapshot_date, metric_name, metric_value, metadata)
    SELECT p_date, 'status_distribution', COALESCE(sum(cnt), 0),
           COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb)
    FROM (SELECT status, count(*) AS cnt FROM public.tasks GROUP BY status) s;

    INSERT INTO public.daily_kpi_snapshots (snapshot_date, metric_name, metric_value, metadata)
    SELECT p_date, 'priority_distribution', COALESCE(sum(cnt), 0),
           COALESCE(jsonb_object_agg(priority, cnt), '{}'::jsonb)
    FROM (
        SELECT COALESCE(priority, 'normal') AS priority, count(*) AS cnt
        FROM public.tasks GROUP BY COALESCE(priority, 'normal')
    ) s;

    -- ── The five-stage breakdown, once per dimension ──
    --
    -- Same shape every time: { "<member id>": { NewRequests, Planning, InProgress, InReview,
    -- OnHold, Completed, Total } }, which is exactly what DistributionChart takes.

    -- Overall, for the status comparison chart.
    INSERT INTO public.daily_kpi_snapshots (snapshot_date, metric_name, metric_value, metadata)
    SELECT p_date, 'overall_stage_counts', count(*)::numeric,
        jsonb_build_object(
            'NewRequests', count(*) FILTER (WHERE public.task_stage(status) = 'NewRequests'),
            'Planning',    count(*) FILTER (WHERE public.task_stage(status) = 'Planning'),
            'InProgress',  count(*) FILTER (WHERE public.task_stage(status) = 'InProgress'),
            'InReview',    count(*) FILTER (WHERE public.task_stage(status) = 'InReview'),
            'OnHold',      count(*) FILTER (WHERE public.task_stage(status) = 'OnHold'),
            'Completed',   count(*) FILTER (WHERE public.task_stage(status) = 'Completed'),
            'Total',       count(*)
        )
    FROM public.tasks;

    INSERT INTO public.daily_kpi_snapshots (snapshot_date, metric_name, metric_value, metadata)
    SELECT p_date, 'client_stage_counts', 0, COALESCE(jsonb_object_agg(key, counts), '{}'::jsonb)
    FROM (
        SELECT t.client_id::text AS key,
            jsonb_build_object(
                'NewRequests', count(*) FILTER (WHERE public.task_stage(t.status) = 'NewRequests'),
                'Planning',    count(*) FILTER (WHERE public.task_stage(t.status) = 'Planning'),
                'InProgress',  count(*) FILTER (WHERE public.task_stage(t.status) = 'InProgress'),
                'InReview',    count(*) FILTER (WHERE public.task_stage(t.status) = 'InReview'),
                'OnHold',      count(*) FILTER (WHERE public.task_stage(t.status) = 'OnHold'),
                'Completed',   count(*) FILTER (WHERE public.task_stage(t.status) = 'Completed'),
                'Total',       count(*)
            ) AS counts
        FROM public.tasks t
        WHERE t.client_id IS NOT NULL
        GROUP BY t.client_id
    ) d;

    INSERT INTO public.daily_kpi_snapshots (snapshot_date, metric_name, metric_value, metadata)
    SELECT p_date, 'region_stage_counts', 0, COALESCE(jsonb_object_agg(key, counts), '{}'::jsonb)
    FROM (
        SELECT t.region_id::text AS key,
            jsonb_build_object(
                'NewRequests', count(*) FILTER (WHERE public.task_stage(t.status) = 'NewRequests'),
                'Planning',    count(*) FILTER (WHERE public.task_stage(t.status) = 'Planning'),
                'InProgress',  count(*) FILTER (WHERE public.task_stage(t.status) = 'InProgress'),
                'InReview',    count(*) FILTER (WHERE public.task_stage(t.status) = 'InReview'),
                'OnHold',      count(*) FILTER (WHERE public.task_stage(t.status) = 'OnHold'),
                'Completed',   count(*) FILTER (WHERE public.task_stage(t.status) = 'Completed'),
                'Total',       count(*)
            ) AS counts
        FROM public.tasks t
        WHERE t.region_id IS NOT NULL
        GROUP BY t.region_id
    ) d;

    INSERT INTO public.daily_kpi_snapshots (snapshot_date, metric_name, metric_value, metadata)
    SELECT p_date, 'tag_stage_counts', 0, COALESCE(jsonb_object_agg(key, counts), '{}'::jsonb)
    FROM (
        SELECT tt.tag_id::text AS key,
            jsonb_build_object(
                'NewRequests', count(*) FILTER (WHERE public.task_stage(t.status) = 'NewRequests'),
                'Planning',    count(*) FILTER (WHERE public.task_stage(t.status) = 'Planning'),
                'InProgress',  count(*) FILTER (WHERE public.task_stage(t.status) = 'InProgress'),
                'InReview',    count(*) FILTER (WHERE public.task_stage(t.status) = 'InReview'),
                'OnHold',      count(*) FILTER (WHERE public.task_stage(t.status) = 'OnHold'),
                'Completed',   count(*) FILTER (WHERE public.task_stage(t.status) = 'Completed'),
                'Total',       count(*)
            ) AS counts
        FROM public.task_tags tt
        JOIN public.tasks t ON t.id = tt.task_id
        GROUP BY tt.tag_id
    ) d;

    INSERT INTO public.daily_kpi_snapshots (snapshot_date, metric_name, metric_value, metadata)
    SELECT p_date, 'team_stage_counts', 0, COALESCE(jsonb_object_agg(key, counts), '{}'::jsonb)
    FROM (
        SELECT tt.team_id::text AS key,
            jsonb_build_object(
                'NewRequests', count(*) FILTER (WHERE public.task_stage(t.status) = 'NewRequests'),
                'Planning',    count(*) FILTER (WHERE public.task_stage(t.status) = 'Planning'),
                'InProgress',  count(*) FILTER (WHERE public.task_stage(t.status) = 'InProgress'),
                'InReview',    count(*) FILTER (WHERE public.task_stage(t.status) = 'InReview'),
                'OnHold',      count(*) FILTER (WHERE public.task_stage(t.status) = 'OnHold'),
                'Completed',   count(*) FILTER (WHERE public.task_stage(t.status) = 'Completed'),
                'Total',       count(*)
            ) AS counts
        FROM public.task_teams tt
        JOIN public.tasks t ON t.id = tt.task_id
        GROUP BY tt.team_id
    ) d;

    -- ── Team capacity, for the utilisation bars ──
    --
    -- Only live work counts against capacity, which is why this is not simply every task on
    -- the team. Deactivated and deleted people are excluded from the capacity they no longer
    -- provide.
    INSERT INTO public.daily_kpi_snapshots (snapshot_date, metric_name, metric_value, metadata)
    SELECT p_date, 'team_capacity', 0, COALESCE(jsonb_object_agg(key, payload), '{}'::jsonb)
    FROM (
        SELECT tm.id::text AS key,
            jsonb_build_object(
                'memberCount', (
                    SELECT count(*) FROM public.team_members m
                    JOIN public.users u ON u.id = m.user_id
                    WHERE m.team_id = tm.id
                      AND u.is_active IS DISTINCT FROM false AND u.deleted_at IS NULL
                ),
                'totalCapacity', (
                    SELECT COALESCE(sum(COALESCE(u.daily_capacity, 8)), 0)
                    FROM public.team_members m
                    JOIN public.users u ON u.id = m.user_id
                    WHERE m.team_id = tm.id
                      AND u.is_active IS DISTINCT FROM false AND u.deleted_at IS NULL
                ),
                'taskCount', (
                    SELECT count(*) FROM public.task_teams k
                    JOIN public.tasks t ON t.id = k.task_id
                    WHERE k.team_id = tm.id
                      AND t.status IN ('in_progress', 'scheduled', 'accepted')
                ),
                'scheduledHours', (
                    SELECT COALESCE(sum(GREATEST(COALESCE(t.estimated_hours, 0) - COALESCE(t.actual_hours, 0), 0)), 0)
                    FROM public.task_teams k
                    JOIN public.tasks t ON t.id = k.task_id
                    WHERE k.team_id = tm.id
                      AND t.status IN ('in_progress', 'scheduled', 'accepted')
                )
            ) AS payload
        FROM public.teams tm
    ) d;

    SELECT count(*) INTO v_written FROM public.daily_kpi_snapshots WHERE snapshot_date = p_date;

    RETURN jsonb_build_object('ok', true, 'date', p_date, 'metricsWritten', v_written);
END;
$$;


ALTER FUNCTION "public"."aggregate_daily_kpis"("p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_task"("p_task_id" "uuid", "p_user_id" "uuid", "p_auto_accept" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
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


ALTER FUNCTION "public"."assign_task"("p_task_id" "uuid", "p_user_id" "uuid", "p_auto_accept" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."backfill_daily_kpis"("p_days" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_filled integer := 0;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_org_admin() THEN
        RAISE EXCEPTION 'Only an admin can backfill dashboard history.';
    END IF;

    IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
        RAISE EXCEPTION 'Backfill must cover between 1 and 365 days.';
    END IF;

    INSERT INTO public.daily_kpi_snapshots (snapshot_date, metric_name, metric_value, metadata)
    SELECT d::date, 'created_that_day',
           (SELECT count(*) FROM public.tasks t
             WHERE t.created_at >= d AND t.created_at < d + interval '1 day'),
           jsonb_build_object('reconstructed', true)
    FROM generate_series(CURRENT_DATE - p_days, CURRENT_DATE - 1, interval '1 day') d
    ON CONFLICT (snapshot_date, metric_name) DO NOTHING;

    GET DIAGNOSTICS v_filled = ROW_COUNT;

    INSERT INTO public.daily_kpi_snapshots (snapshot_date, metric_name, metric_value, metadata)
    SELECT d::date, 'completed_that_day',
           (SELECT count(*) FROM public.tasks t
             WHERE t.completed_date >= d AND t.completed_date < d + interval '1 day'),
           jsonb_build_object('reconstructed', true)
    FROM generate_series(CURRENT_DATE - p_days, CURRENT_DATE - 1, interval '1 day') d
    ON CONFLICT (snapshot_date, metric_name) DO NOTHING;

    RETURN jsonb_build_object('ok', true, 'daysRequested', p_days, 'rowsFilled', v_filled);
END;
$$;


ALTER FUNCTION "public"."backfill_daily_kpis"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_assign_work"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid()
          AND u.role IN ('super_admin', 'admin', 'manager', 'team_leader')
          AND u.is_active
          AND u.deleted_at IS NULL
    );
$$;


ALTER FUNCTION "public"."can_assign_work"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_team"("p_team_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT public.is_org_admin() OR public.leads_team(p_team_id);
$$;


ALTER FUNCTION "public"."can_manage_team"("p_team_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."capture_public_dashboard_labels"("p_date" "date" DEFAULT CURRENT_DATE) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_written integer;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_org_admin() THEN
        RAISE EXCEPTION 'Only an admin can rebuild public dashboard labels.';
    END IF;

    INSERT INTO public.daily_kpi_snapshots (snapshot_date, metric_name, metric_value, metadata)
    VALUES
        (p_date, 'public_team_labels', (SELECT count(*) FROM public.teams),
            (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', t.id, 'name', t.name, 'color', t.color
            ) ORDER BY t.name), '[]'::jsonb) FROM public.teams t)),
        (p_date, 'public_client_labels', (SELECT count(*) FROM public.clients),
            (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', c.id, 'name', c.name, 'favicon', c.favicon
            ) ORDER BY c.name), '[]'::jsonb) FROM public.clients c)),
        (p_date, 'public_region_labels', (SELECT count(*) FROM public.regions),
            (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', r.id, 'name', r.name, 'flag', r.flag
            ) ORDER BY r.name), '[]'::jsonb) FROM public.regions r)),
        (p_date, 'public_tag_labels', (SELECT count(*) FROM public.tags),
            (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', g.id, 'name', g.name, 'color', g.color
            ) ORDER BY g.name), '[]'::jsonb) FROM public.tags g))
    ON CONFLICT (snapshot_date, metric_name) DO UPDATE
        SET metric_value = EXCLUDED.metric_value,
            metadata = EXCLUDED.metadata,
            created_at = timezone('utc', now());

    GET DIAGNOSTICS v_written = ROW_COUNT;
    RETURN jsonb_build_object('date', p_date, 'labelSetsWritten', v_written);
END;
$$;


ALTER FUNCTION "public"."capture_public_dashboard_labels"("p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_onboarding_step_one"("p_name" "text", "p_team_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_email text;
    v_name text := NULLIF(btrim(coalesce(p_name, '')), '');
    v_has_password boolean;
    v_team_id uuid;
    v_team_name text;
    v_already_on_a_team boolean;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'You must be signed in.';
    END IF;

    SELECT a.email, coalesce(a.encrypted_password, '') <> ''
    INTO v_email, v_has_password
    FROM auth.users a
    WHERE a.id = v_uid;

    IF v_email IS NULL THEN
        RAISE EXCEPTION 'That account no longer exists.';
    END IF;

    -- A password must actually exist. Marking step 1 done without one would hand a role and a
    -- team to an account nobody can sign into.
    IF NOT v_has_password THEN
        RAISE EXCEPTION 'Set a password before finishing account setup.';
    END IF;

    IF v_name IS NULL THEN
        v_name := split_part(v_email, '@', 1);
    END IF;

    INSERT INTO public.users AS u (id, name, email, role, daily_capacity, is_active, onboarding_completed)
    VALUES (v_uid, v_name, v_email, 'team_member', 8, true, true)
    ON CONFLICT (id) DO UPDATE
    SET name = v_name,
        onboarding_completed = true,
        -- Only the placeholder roles are replaced. Somebody invited straight into a real role,
        -- or coming back, keeps what they have. 'requester' stays in the list for accounts that
        -- predate the split.
        role = CASE WHEN u.role IN ('invitee', 'requester') THEN 'team_member' ELSE u.role END;

    SELECT EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.user_id = v_uid)
    INTO v_already_on_a_team;

    IF NOT v_already_on_a_team THEN
        v_team_id := p_team_id;
        IF v_team_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = v_team_id) THEN
            v_team_id := public.default_onboarding_team();
        END IF;

        IF v_team_id IS NOT NULL THEN
            INSERT INTO public.team_members (team_id, user_id)
            VALUES (v_team_id, v_uid)
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    -- The queue entry that started all this, if there was one. They are in now; there is
    -- nothing left for an admin to decide.
    UPDATE public.access_requests
    SET status = 'invited',
        resolved_at = COALESCE(resolved_at, timezone('utc', now()))
    WHERE status = 'pending'
      AND lower(email) = lower(v_email);

    SELECT tm.team_id, t.name INTO v_team_id, v_team_name
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    WHERE tm.user_id = v_uid
    LIMIT 1;

    RETURN jsonb_build_object('ok', true, 'team_id', v_team_id, 'team_name', v_team_name);
END;
$$;


ALTER FUNCTION "public"."complete_onboarding_step_one"("p_name" "text", "p_team_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consume_onboarding_temp_password"("p_email" "text", "p_temp_password" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_user auth.users%ROWTYPE;
    v_profile public.users%ROWTYPE;
    v_credential public.onboarding_temp_passwords%ROWTYPE;
    v_attempts integer;
BEGIN
    SELECT au.* INTO v_user
    FROM auth.users au
    WHERE lower(au.email) = lower(trim(coalesce(p_email, '')))
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
    END IF;

    SELECT * INTO v_profile
    FROM public.users u
    WHERE u.id = v_user.id
      AND u.is_active
      AND u.deleted_at IS NULL
      AND NOT u.onboarding_completed
      AND u.role IN ('invitee', 'requester');

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
    END IF;

    SELECT * INTO v_credential
    FROM public.onboarding_temp_passwords otp
    WHERE otp.user_id = v_user.id
    FOR UPDATE;

    IF NOT FOUND
       OR v_credential.consumed_at IS NOT NULL
       OR v_credential.expires_at <= timezone('utc', now())
       OR v_credential.locked_until > timezone('utc', now()) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
    END IF;

    IF extensions.crypt(coalesce(p_temp_password, ''), v_credential.password_hash)
       <> v_credential.password_hash THEN
        v_attempts := v_credential.failed_attempts + 1;
        UPDATE public.onboarding_temp_passwords
        SET failed_attempts = CASE WHEN v_attempts >= 5 THEN 0 ELSE v_attempts END,
            locked_until = CASE
                WHEN v_attempts >= 5 THEN timezone('utc', now()) + interval '15 minutes'
                ELSE NULL
            END,
            updated_at = timezone('utc', now())
        WHERE user_id = v_user.id;
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
    END IF;

    UPDATE public.onboarding_temp_passwords
    SET consumed_at = timezone('utc', now()),
        failed_attempts = 0,
        locked_until = NULL,
        updated_at = timezone('utc', now())
    WHERE user_id = v_user.id;

    INSERT INTO public.onboarding_temp_password_events (user_id, event_type, actor_id)
    VALUES (v_user.id, 'consumed', v_user.id);

    RETURN jsonb_build_object(
        'ok', true,
        'userId', v_user.id,
        'email', lower(v_user.email),
        'teamId', v_user.raw_user_meta_data->>'team_id'
    );
END;
$$;


ALTER FUNCTION "public"."consume_onboarding_temp_password"("p_email" "text", "p_temp_password" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_has_password"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT COALESCE(a.encrypted_password, '') <> ''
    FROM auth.users a
    WHERE a.id = auth.uid();
$$;


ALTER FUNCTION "public"."current_user_has_password"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_is_form_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid() AND u.role IN ('super_admin', 'admin')
    );
$$;


ALTER FUNCTION "public"."current_user_is_form_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_sees_access_requests"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid()
          AND u.role IN ('super_admin', 'admin', 'manager', 'team_leader')
          AND u.is_active
          AND u.deleted_at IS NULL
    );
$$;


ALTER FUNCTION "public"."current_user_sees_access_requests"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."default_onboarding_team"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT t.id
    FROM public.teams t
    WHERE t.is_home_team OR lower(t.name) = 'general marketing'
    ORDER BY t.is_home_team DESC, t.created_at NULLS LAST
    LIMIT 1;
$$;


ALTER FUNCTION "public"."default_onboarding_team"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_user_account"("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_target public.users;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'super_admin') THEN
        RAISE EXCEPTION 'Only the super admin can delete an account.';
    END IF;
    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'You cannot delete your own account.';
    END IF;

    SELECT * INTO v_target FROM public.users WHERE id = p_user_id;
    IF v_target.id IS NULL THEN
        RAISE EXCEPTION 'That person no longer exists.';
    END IF;
    IF v_target.role = 'super_admin' THEN
        RAISE EXCEPTION 'The super admin cannot be deleted. Transfer ownership first.';
    END IF;
    IF v_target.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'That account has already been deleted.';
    END IF;

    -- Deletion is only for an account with nothing hanging off it. While a comment or a task
    -- of theirs still exists, the record of who did it is worth more than tidiness, and
    -- deactivation -- which keeps them in the history, greyed out -- is the honest end state.
    --
    -- This is a check on what is there right now, not a permanent verdict: clear out their
    -- tasks and comments, or hand them to someone else, and the same call goes through.
    IF EXISTS (SELECT 1 FROM public.comments c WHERE c.user_id = p_user_id)
        OR EXISTS (
            SELECT 1 FROM public.tasks t
            WHERE t.assignee_id = p_user_id
               OR t.requester_id = p_user_id
               OR t.assigned_by_id = p_user_id
        ) THEN
        RAISE EXCEPTION '% still has tasks or comments. Deactivate the account instead, or delete or reassign those first.', v_target.name;
    END IF;

    -- No tasks, so nothing to reassign and nobody to tell -- that notice belongs to removal
    -- and deactivation, which are what happen to people who do have work in flight.

    -- The tombstone. It carries no history by the rule above; it exists so a reactivation
    -- request from this address can still find a name to show the admins. The address moves
    -- aside so the unique index does not keep it hostage when they are invited again.
    UPDATE public.users
    SET deleted_at = timezone('utc', now()),
        deleted_email = COALESCE(deleted_email, email),
        email = 'deleted+' || id::text || '@deleted.invalid',
        is_active = false,
        sessions_revoked_at = timezone('utc', now())
    WHERE id = p_user_id;

    DELETE FROM public.team_members WHERE user_id = p_user_id;

    -- Ends the login itself. Everything under auth (sessions, refresh tokens, identities,
    -- MFA factors) cascades from here; public.users no longer does, which is the point.
    DELETE FROM auth.users WHERE id = p_user_id;

    RETURN jsonb_build_object('ok', true);
END;
$$;


ALTER FUNCTION "public"."delete_user_account"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."demote_and_sign_out_teamless_member"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_role text;
    v_deleted timestamptz;
BEGIN
    -- Only when that was their last team. Moving somebody between teams deletes and
    -- re-inserts, and must not sign them out in the middle of it.
    IF EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.user_id = OLD.user_id) THEN
        RETURN OLD;
    END IF;

    SELECT u.role, u.deleted_at INTO v_role, v_deleted FROM public.users u WHERE u.id = OLD.user_id;
    IF v_role IS NULL THEN
        RETURN OLD;   -- the user row itself is going away; nothing to demote.
    END IF;
    IF v_deleted IS NOT NULL THEN
        RETURN OLD;   -- a tombstone being unpicked from its team; leave it as it is.
    END IF;

    -- Admins keep their role: they are the ones who hand out teams, and an admin locked into
    -- the team picker cannot fix the org that put them there.
    IF v_role NOT IN ('super_admin', 'admin') THEN
        UPDATE public.users SET role = 'requester' WHERE id = OLD.user_id;
    END IF;

    -- A requester cannot be assigned work, so whatever they had open needs a new owner.
    PERFORM public.notify_reassignment_needed(OLD.user_id, OLD.team_id, 'was removed from the team');

    UPDATE public.users SET sessions_revoked_at = timezone('utc', now()) WHERE id = OLD.user_id;

    -- What actually ends the sessions. Deleting from auth.sessions cascades to the refresh
    -- tokens, so every device is signed out at its next refresh; sessions_revoked_at is what
    -- makes the app act on it sooner.
    DELETE FROM auth.sessions WHERE user_id = OLD.user_id;

    RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."demote_and_sign_out_teamless_member"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_assignment_status_transition"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
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


ALTER FUNCTION "public"."enforce_assignment_status_transition"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_super_admin_home_team"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
    home_team_id UUID;
BEGIN
    SELECT id INTO home_team_id FROM public.teams WHERE is_home_team = true LIMIT 1;
    IF home_team_id IS NOT NULL THEN
        DELETE FROM public.team_members WHERE user_id = NEW.id AND team_id <> home_team_id;
        INSERT INTO public.team_members (team_id, user_id)
        VALUES (home_team_id, NEW.id)
        ON CONFLICT (user_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_super_admin_home_team"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_mfa_recovery_codes"() RETURNS SETOF "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_user uuid := auth.uid();
    v_code text;
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'You must be signed in.';
    END IF;

    DELETE FROM public.mfa_recovery_codes WHERE user_id = v_user;

    FOR i IN 1..10 LOOP
        -- 12 hex characters, 48 bits, in two halves for the sake of whoever types it back in.
        v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)
               || '-'
               || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

        INSERT INTO public.mfa_recovery_codes (user_id, code_hash)
        VALUES (v_user, public.mfa_recovery_code_hash(v_code));

        RETURN NEXT v_code;
    END LOOP;
END;
$$;


ALTER FUNCTION "public"."generate_mfa_recovery_codes"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."dashboard_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scope" "text" DEFAULT 'org'::"text" NOT NULL,
    "token" "text" NOT NULL,
    "public_access" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."dashboard_links" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_or_create_dashboard_link"() RETURNS "public"."dashboard_links"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    link public.dashboard_links;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to see the share link.';
    END IF;

    SELECT * INTO link FROM public.dashboard_links WHERE scope = 'org';
    IF FOUND THEN
        RETURN link;
    END IF;

    IF NOT public.current_user_is_form_admin() THEN
        RAISE EXCEPTION 'No dashboard link exists yet. An admin has to create one first.';
    END IF;

    INSERT INTO public.dashboard_links (scope, token, created_by)
    VALUES ('org', replace(gen_random_uuid()::text, '-', ''), auth.uid())
    ON CONFLICT (scope) DO NOTHING
    RETURNING * INTO link;

    -- Two admins clicking Share at the same moment: the loser of the race reads the row the
    -- winner just wrote rather than erroring.
    IF link IS NULL THEN
        SELECT * INTO link FROM public.dashboard_links WHERE scope = 'org';
    END IF;

    RETURN link;
END;
$$;


ALTER FUNCTION "public"."get_or_create_dashboard_link"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."request_form_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scope" "text" DEFAULT 'org'::"text" NOT NULL,
    "token" "text" NOT NULL,
    "public_access" boolean DEFAULT true NOT NULL,
    "send_confirmation" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."request_form_links" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_or_create_request_form_link"() RETURNS "public"."request_form_links"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    link public.request_form_links;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to see the share link.';
    END IF;

    SELECT * INTO link FROM public.request_form_links WHERE scope = 'org';
    IF FOUND THEN
        RETURN link;
    END IF;

    IF NOT public.current_user_is_form_admin() THEN
        RAISE EXCEPTION 'No share link exists yet. An admin has to create one first.';
    END IF;

    INSERT INTO public.request_form_links (scope, token, created_by)
    VALUES ('org', replace(gen_random_uuid()::text, '-', ''), auth.uid())
    ON CONFLICT (scope) DO NOTHING
    RETURNING * INTO link;

    -- Two admins opening the modal at the same moment: the loser of the race reads the
    -- row the winner just wrote rather than erroring.
    IF link IS NULL THEN
        SELECT * INTO link FROM public.request_form_links WHERE scope = 'org';
    END IF;

    RETURN link;
END;
$$;


ALTER FUNCTION "public"."get_or_create_request_form_link"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_dashboard"("p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    link public.dashboard_links;
    caller_is_admin boolean;
BEGIN
    SELECT * INTO link FROM public.dashboard_links WHERE token = p_token;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;

    caller_is_admin := auth.uid() IS NOT NULL AND public.current_user_is_form_admin();

    IF NOT link.public_access AND NOT caller_is_admin THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'closed');
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'publicAccess', link.public_access,
        -- memberIds are opaque uuids and the people they belong to are not in this payload;
        -- the dashboard only ever counts them and sums their capacity.
        'teams', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', t.id,
                'name', t.name,
                'color', t.color,
                'memberIds', (
                    SELECT COALESCE(jsonb_agg(tm.user_id), '[]'::jsonb)
                    FROM public.team_members tm
                    JOIN public.users u ON u.id = tm.user_id
                    WHERE tm.team_id = t.id
                      AND u.is_active IS DISTINCT FROM false
                      AND u.deleted_at IS NULL
                )
            ) ORDER BY t.name), '[]'::jsonb)
            FROM public.teams t
        ),
        'members', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', u.id,
                'dailyCapacity', COALESCE(u.daily_capacity, 8)
            )), '[]'::jsonb)
            FROM public.users u
            WHERE u.is_active IS DISTINCT FROM false
              AND u.deleted_at IS NULL
        ),
        'clients', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', c.id, 'name', c.name, 'favicon', c.favicon
            ) ORDER BY c.name), '[]'::jsonb)
            FROM public.clients c
        ),
        'regions', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', r.id, 'name', r.name, 'flag', r.flag
            ) ORDER BY r.name), '[]'::jsonb)
            FROM public.regions r
        ),
        'tags', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', g.id, 'name', g.name, 'color', g.color
            ) ORDER BY g.name), '[]'::jsonb)
            FROM public.tags g
        ),
        'tasks', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', k.id,
                'status', k.status,
                'createdDate', k.created_at,
                'dueDate', k.due_date,
                'estimatedHours', COALESCE(k.estimated_hours, 0),
                -- Who it is assigned to is nobody's business out here; whether it is
                -- assigned at all is one of the eight numbers at the top of the page.
                'assigned', k.assignee_id IS NOT NULL,
                'clientId', k.client_id,
                'regionId', k.region_id,
                'tagIds', (
                    SELECT COALESCE(jsonb_agg(tt.tag_id), '[]'::jsonb)
                    FROM public.task_tags tt WHERE tt.task_id = k.id
                ),
                'teamIds', (
                    SELECT COALESCE(jsonb_agg(tm.team_id), '[]'::jsonb)
                    FROM public.task_teams tm WHERE tm.task_id = k.id
                )
            )), '[]'::jsonb)
            FROM public.tasks k
        )
    );
END;
$$;


ALTER FUNCTION "public"."get_public_dashboard"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_dashboard_cached"("p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    link            public.dashboard_links;
    caller_is_admin boolean;
    v_date          date := CURRENT_DATE - 1;
BEGIN
    SELECT * INTO link FROM public.dashboard_links WHERE token = p_token;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;

    caller_is_admin := auth.uid() IS NOT NULL AND public.current_user_is_form_admin();

    IF NOT link.public_access AND NOT caller_is_admin THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'closed');
    END IF;

    -- Strictly yesterday. Never fall back to an older snapshot, because that would make the
    -- displayed age unpredictable and expose a historical-data API by accident.
    IF (
        SELECT count(DISTINCT metric_name)
        FROM public.daily_kpi_snapshots
        WHERE snapshot_date = v_date
          AND metric_name IN (
              'snapshot_complete',
              'public_team_labels',
              'public_client_labels',
              'public_region_labels',
              'public_tag_labels'
          )
    ) < 5 THEN
        RETURN jsonb_build_object(
            'ok', true,
            'publicAccess', link.public_access,
            'pending', true,
            'expectedDate', v_date
        );
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'publicAccess', link.public_access,
        'pending', false,
        'asOf', v_date,
        'metrics', (
            SELECT COALESCE(jsonb_object_agg(
                s.metric_name,
                jsonb_build_object('value', s.metric_value, 'metadata', s.metadata)
            ), '{}'::jsonb)
            FROM public.daily_kpi_snapshots s
            WHERE s.snapshot_date = v_date
              AND s.metric_name NOT IN (
                  'public_team_labels',
                  'public_client_labels',
                  'public_region_labels',
                  'public_tag_labels'
              )
        ),
        'teams', COALESCE((
            SELECT s.metadata FROM public.daily_kpi_snapshots s
            WHERE s.snapshot_date = v_date AND s.metric_name = 'public_team_labels'
        ), '[]'::jsonb),
        'clients', COALESCE((
            SELECT s.metadata FROM public.daily_kpi_snapshots s
            WHERE s.snapshot_date = v_date AND s.metric_name = 'public_client_labels'
        ), '[]'::jsonb),
        'regions', COALESCE((
            SELECT s.metadata FROM public.daily_kpi_snapshots s
            WHERE s.snapshot_date = v_date AND s.metric_name = 'public_region_labels'
        ), '[]'::jsonb),
        'tags', COALESCE((
            SELECT s.metadata FROM public.daily_kpi_snapshots s
            WHERE s.snapshot_date = v_date AND s.metric_name = 'public_tag_labels'
        ), '[]'::jsonb)
    );
END;
$$;


ALTER FUNCTION "public"."get_public_dashboard_cached"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_request_form"("p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    link public.request_form_links;
    caller_is_admin boolean;
BEGIN
    SELECT * INTO link FROM public.request_form_links WHERE token = p_token;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;

    caller_is_admin := auth.uid() IS NOT NULL AND public.current_user_is_form_admin();

    IF NOT link.public_access AND NOT caller_is_admin THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'closed');
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'publicAccess', link.public_access,
        'sendConfirmation', link.send_confirmation,
        'brands', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', c.id, 'name', c.name, 'departments', c.department
            ) ORDER BY c.name), '[]'::jsonb)
            FROM public.clients c
        ),
        'regions', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', r.id, 'name', r.name, 'flag', r.flag
            ) ORDER BY r.name), '[]'::jsonb)
            FROM public.regions r
        ),
        'categories', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', s.id, 'name', s.name
            ) ORDER BY s.name), '[]'::jsonb)
            FROM public.skills s
        ),
        -- Only the enabled ones. A disabled field is not "hidden by CSS" out here; the
        -- visitor is never told it exists, and submit_public_request would reject it.
        'fields', (
            SELECT COALESCE(jsonb_agg(public.request_form_field_json(f)
                ORDER BY f.skill_id NULLS FIRST, f.position, f.label), '[]'::jsonb)
            FROM public.request_form_fields f
            WHERE f.enabled
        )
    );
END;
$$;


ALTER FUNCTION "public"."get_public_request_form"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_request_form_config"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT COALESCE(
        jsonb_agg(public.request_form_field_json(f) ORDER BY f.skill_id NULLS FIRST, f.position, f.label),
        '[]'::jsonb
    )
    FROM public.request_form_fields f
    WHERE auth.uid() IS NOT NULL;
$$;


ALTER FUNCTION "public"."get_request_form_config"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
    INSERT INTO public.users (id, name, email, role, daily_capacity, is_active, onboarding_completed)
    VALUES (
        new.id,
        COALESCE(
            NULLIF(new.raw_user_meta_data->>'name', ''),
            NULLIF(new.raw_user_meta_data->>'full_name', ''),
            new.email
        ),
        new.email,
        'invitee',
        8,
        true,
        false
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN new;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_live_user"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT auth.uid() IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM public.users u
           WHERE u.id = auth.uid()
             AND (u.is_active = false OR u.deleted_at IS NOT NULL)
       );
$$;


ALTER FUNCTION "public"."is_live_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_org_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid()
          AND u.role IN ('admin', 'super_admin')
          AND u.is_active
          AND u.deleted_at IS NULL
    );
$$;


ALTER FUNCTION "public"."is_org_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_team_manager"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid()
          AND u.role IN ('admin', 'super_admin', 'team_leader')
          AND u.is_active
          AND u.deleted_at IS NULL
    );
$$;


ALTER FUNCTION "public"."is_team_manager"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."issue_onboarding_temp_password"("p_user_id" "uuid", "p_temp_password" "text", "p_generated_by" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_expires_at timestamptz := timezone('utc', now()) + interval '3 days';
BEGIN
    IF coalesce(length(p_temp_password), 0) < 16 THEN
        RAISE EXCEPTION 'Temporary passwords must contain at least 16 characters.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = p_user_id
          AND u.is_active
          AND u.deleted_at IS NULL
          AND NOT u.onboarding_completed
          AND u.role IN ('invitee', 'requester')
    ) THEN
        RAISE EXCEPTION 'The account is not waiting for onboarding.';
    END IF;

    INSERT INTO public.onboarding_temp_passwords AS otp (
        user_id,
        password_hash,
        expires_at,
        consumed_at,
        failed_attempts,
        locked_until,
        generated_by,
        created_at,
        updated_at
    ) VALUES (
        p_user_id,
        extensions.crypt(p_temp_password, extensions.gen_salt('bf', 12)),
        v_expires_at,
        NULL,
        0,
        NULL,
        p_generated_by,
        timezone('utc', now()),
        timezone('utc', now())
    )
    ON CONFLICT (user_id) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        expires_at = EXCLUDED.expires_at,
        consumed_at = NULL,
        failed_attempts = 0,
        locked_until = NULL,
        generated_by = EXCLUDED.generated_by,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at;

    INSERT INTO public.onboarding_temp_password_events (user_id, event_type, actor_id)
    VALUES (p_user_id, 'issued', p_generated_by);

    RETURN jsonb_build_object('ok', true, 'expiresAt', v_expires_at);
END;
$$;


ALTER FUNCTION "public"."issue_onboarding_temp_password"("p_user_id" "uuid", "p_temp_password" "text", "p_generated_by" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."leads_team"("p_team_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        JOIN public.team_members tm ON tm.user_id = u.id
        WHERE u.id = auth.uid()
          AND u.role = 'team_leader'
          AND u.is_active
          AND u.deleted_at IS NULL
          AND tm.team_id = p_team_id
    );
$$;


ALTER FUNCTION "public"."leads_team"("p_team_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_my_sessions"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_current uuid;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'You must be signed in.';
    END IF;

    -- The access token names the session it belongs to, which is how the list knows which
    -- row is "this device" without the client having to claim it.
    BEGIN
        v_current := nullif(auth.jwt() ->> 'session_id', '')::uuid;
    EXCEPTION WHEN others THEN
        v_current := NULL;
    END;

    RETURN COALESCE((
        SELECT jsonb_agg(r.session_row ORDER BY r.last_active DESC NULLS LAST)
        FROM (
            SELECT
                COALESCE(s.refreshed_at AT TIME ZONE 'UTC', s.updated_at, s.created_at) AS last_active,
                jsonb_build_object(
                    'id', s.id,
                    'isCurrent', s.id IS NOT DISTINCT FROM v_current,
                    'createdAt', s.created_at,
                    'lastActiveAt', COALESCE(s.refreshed_at AT TIME ZONE 'UTC', s.updated_at, s.created_at),
                    'notAfter', s.not_after,
                    'userAgent', s.user_agent,
                    'ip', host(s.ip),
                    'aal', s.aal::text
                ) AS session_row
            FROM auth.sessions s
            WHERE s.user_id = auth.uid()
              AND (s.not_after IS NULL OR s.not_after > now())
        ) r
    ), '[]'::jsonb);
END;
$$;


ALTER FUNCTION "public"."list_my_sessions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_skills"("query_embedding" "extensions"."vector", "match_count" integer DEFAULT 8) RETURNS TABLE("id" "uuid", "name" "text", "category" "text", "similarity" double precision)
    LANGUAGE "sql" STABLE
    AS $$
    SELECT s.id, s.name, s.category, 1 - (s.embedding <=> query_embedding) AS similarity
    FROM public.skills s
    WHERE s.embedding IS NOT NULL
    ORDER BY s.embedding <=> query_embedding
    LIMIT match_count;
$$;


ALTER FUNCTION "public"."match_skills"("query_embedding" "extensions"."vector", "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mfa_recovery_code_hash"("p_code" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
    SELECT encode(sha256(upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'))::bytea), 'hex');
$$;


ALTER FUNCTION "public"."mfa_recovery_code_hash"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_mfa_recovery_code_status"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT jsonb_build_object(
        'total', count(*),
        'unused', count(*) FILTER (WHERE used_at IS NULL),
        'generatedAt', max(created_at)
    )
    FROM public.mfa_recovery_codes
    WHERE user_id = auth.uid();
$$;


ALTER FUNCTION "public"."my_mfa_recovery_code_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_on_assignment"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
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


ALTER FUNCTION "public"."notify_on_assignment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_reassignment_needed"("p_user_id" "uuid", "p_team_id" "uuid", "p_reason" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_name text;
    v_open_count integer;
    v_notified integer;
BEGIN
    SELECT u.name INTO v_name FROM public.users u WHERE u.id = p_user_id;
    IF v_name IS NULL THEN RETURN 0; END IF;

    -- Finished and cancelled work stays where it is; only live work needs a new owner.
    SELECT count(*) INTO v_open_count
    FROM public.tasks t
    WHERE t.assignee_id = p_user_id
      AND t.status NOT IN ('completed', 'cancelled');

    IF v_open_count = 0 THEN RETURN 0; END IF;

    INSERT INTO public.notifications (user_id, type, title, message, link)
    SELECT
        recipient.id,
        'reassignment_needed',
        'Tasks need reassigning',
        v_name || ' ' || p_reason || ' with ' || v_open_count || ' open '
            || CASE WHEN v_open_count = 1 THEN 'task' ELSE 'tasks' END
            || '. Please reassign ' || CASE WHEN v_open_count = 1 THEN 'it' ELSE 'them' END || '.',
        '/workload'
    FROM public.users recipient
    WHERE recipient.is_active
      AND recipient.deleted_at IS NULL
      AND recipient.id <> p_user_id
      AND (
          recipient.role IN ('super_admin', 'admin')
          OR (
              recipient.role = 'team_leader'
              AND p_team_id IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM public.team_members tm
                  WHERE tm.user_id = recipient.id AND tm.team_id = p_team_id
              )
          )
      );

    GET DIAGNOSTICS v_notified = ROW_COUNT;
    RETURN v_notified;
END;
$$;


ALTER FUNCTION "public"."notify_reassignment_needed"("p_user_id" "uuid", "p_team_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."onboarding_account_state"("p_email" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
DECLARE
    v_email text := lower(nullif(btrim(p_email), ''));
    v_user public.users;
BEGIN
    IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$' THEN
        RAISE EXCEPTION 'A valid email address is required.';
    END IF;

    -- deleted_email as well as email: deleting an account moves the address aside, and the
    -- address the person types is the one they always had.
    SELECT * INTO v_user FROM public.users u
    WHERE lower(u.email) = v_email OR lower(u.deleted_email) = v_email
    LIMIT 1;

    IF v_user.id IS NULL THEN
        RETURN jsonb_build_object('status', 'unknown');
    END IF;

    IF v_user.deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'deleted', 'user_id', v_user.id);
    END IF;

    IF NOT v_user.is_active THEN
        RETURN jsonb_build_object('status', 'deactivated', 'user_id', v_user.id);
    END IF;

    IF v_user.onboarding_completed THEN
        RETURN jsonb_build_object('status', 'member', 'user_id', v_user.id);
    END IF;

    -- A profile row with no auth identity behind it cannot have a password set on it, so it is
    -- not an invitation waiting to be claimed however much it looks like one. Rare, and only
    -- reachable by removing an auth user without its profile, but 'invitee' here would send
    -- somebody to a password screen that could never work.
    IF NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = v_user.id) THEN
        RETURN jsonb_build_object('status', 'unknown');
    END IF;

    RETURN jsonb_build_object('status', 'invitee', 'user_id', v_user.id);
END;
$_$;


ALTER FUNCTION "public"."onboarding_account_state"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."onboarding_email_status"("p_email" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT jsonb_build_object('status', public.onboarding_account_state(p_email) ->> 'status');
$$;


ALTER FUNCTION "public"."onboarding_email_status"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_super_admin_home_team_removal"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
    member_role TEXT;
    left_team_is_home BOOLEAN;
BEGIN
    SELECT role INTO member_role FROM public.users WHERE id = OLD.user_id;
    SELECT is_home_team INTO left_team_is_home FROM public.teams WHERE id = OLD.team_id;
    IF member_role = 'super_admin' AND left_team_is_home THEN
        RAISE EXCEPTION 'Cannot remove the super admin from the home team.';
    END IF;
    RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."prevent_super_admin_home_team_removal"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."promote_requester_on_team_join"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
    UPDATE public.users
    SET role = 'team_member'
    WHERE id = NEW.user_id
      AND role IN ('invitee', 'requester')
      AND onboarding_completed;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."promote_requester_on_team_join"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."redeem_mfa_recovery_code"("p_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_user uuid := auth.uid();
    v_failures integer;
    v_id uuid;
    v_removed integer;
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'You must be signed in.';
    END IF;

    SELECT count(*) INTO v_failures
    FROM public.mfa_recovery_attempts
    WHERE user_id = v_user
      AND NOT succeeded
      AND attempted_at > now() - interval '1 hour';

    IF v_failures >= 10 THEN
        RAISE EXCEPTION 'Too many recovery attempts. Try again in an hour.';
    END IF;

    SELECT id INTO v_id
    FROM public.mfa_recovery_codes
    WHERE user_id = v_user
      AND used_at IS NULL
      AND code_hash = public.mfa_recovery_code_hash(p_code)
    LIMIT 1;

    IF v_id IS NULL THEN
        INSERT INTO public.mfa_recovery_attempts (user_id, succeeded) VALUES (v_user, false);
        RETURN jsonb_build_object('ok', false);
    END IF;

    UPDATE public.mfa_recovery_codes SET used_at = now() WHERE id = v_id;

    -- Every factor, not just the one that happened to be verified: a half-finished
    -- enrolment left behind would otherwise put the account straight back into the loop.
    DELETE FROM auth.mfa_factors WHERE user_id = v_user;
    GET DIAGNOSTICS v_removed = ROW_COUNT;

    -- The remaining codes only ever existed to unlock a factor that is now gone. Re-enrolling
    -- issues a fresh set.
    DELETE FROM public.mfa_recovery_codes WHERE user_id = v_user;
    INSERT INTO public.mfa_recovery_attempts (user_id, succeeded) VALUES (v_user, true);

    RETURN jsonb_build_object('ok', true, 'factorsRemoved', v_removed);
END;
$$;


ALTER FUNCTION "public"."redeem_mfa_recovery_code"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_daily_kpi_snapshot"("p_date" "date" DEFAULT CURRENT_DATE) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_metrics jsonb;
    v_labels  jsonb;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_org_admin() THEN
        RAISE EXCEPTION 'Only an admin can rebuild the dashboard snapshot.';
    END IF;

    v_metrics := public.aggregate_daily_kpis(p_date);
    v_labels := public.capture_public_dashboard_labels(p_date);
    RETURN jsonb_build_object('metrics', v_metrics, 'labels', v_labels);
END;
$$;


ALTER FUNCTION "public"."refresh_daily_kpi_snapshot"("p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_assignment"("p_assignment_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
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


ALTER FUNCTION "public"."reject_assignment"("p_assignment_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_team_member"("p_team_id" "uuid", "p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_caller_role text;
    v_target_role text;
BEGIN
    SELECT u.role INTO v_caller_role FROM public.users u WHERE u.id = auth.uid();
    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'You must be signed in.';
    END IF;

    SELECT u.role INTO v_target_role FROM public.users u WHERE u.id = p_user_id;
    IF v_target_role IS NULL THEN
        RAISE EXCEPTION 'That person no longer exists.';
    END IF;
    IF v_target_role = 'super_admin' THEN
        RAISE EXCEPTION 'The super admin cannot be removed from their team. Transfer ownership first.';
    END IF;

    IF v_caller_role NOT IN ('super_admin', 'admin') THEN
        IF v_caller_role <> 'team_leader' OR NOT EXISTS (
            SELECT 1 FROM public.team_members tm
            WHERE tm.user_id = auth.uid() AND tm.team_id = p_team_id
        ) THEN
            RAISE EXCEPTION 'Only an admin, or a leader of this team, can remove its members.';
        END IF;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.team_members tm
        WHERE tm.team_id = p_team_id AND tm.user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'They are not on that team.';
    END IF;

    -- The demotion, the sign-out and the reassignment notice all hang off the trigger on
    -- team_members, so they happen however the row goes -- not only when it goes through here.
    DELETE FROM public.team_members WHERE team_id = p_team_id AND user_id = p_user_id;

    RETURN jsonb_build_object('ok', true);
END;
$$;


ALTER FUNCTION "public"."remove_team_member"("p_team_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_access"("p_name" "text", "p_email" "text", "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
DECLARE
    v_name text;
    v_email text;
    v_note text;
    v_request_id uuid;
    v_notified integer;
    v_existing public.users;
    v_kind text := 'access';
    v_user_id uuid := NULL;
    v_context text := '';
BEGIN
    v_name  := nullif(btrim(p_name), '');
    v_email := lower(nullif(btrim(p_email), ''));
    v_note  := nullif(btrim(p_note), '');

    IF v_name IS NULL THEN
        RAISE EXCEPTION 'Your name is required.';
    END IF;
    IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$' THEN
        RAISE EXCEPTION 'A valid email address is required.';
    END IF;
    IF length(v_note) > 1000 THEN
        RAISE EXCEPTION 'Please keep your message under 1000 characters.';
    END IF;

    IF (SELECT count(*) FROM public.access_requests r
        WHERE lower(r.email) = v_email AND r.created_at > now() - interval '24 hours') >= 3 THEN
        RAISE EXCEPTION 'You have already requested access recently. An admin will be in touch.';
    END IF;
    IF (SELECT count(*) FROM public.access_requests r
        WHERE r.created_at > now() - interval '1 hour') >= 50 THEN
        RAISE EXCEPTION 'Too many access requests right now. Please try again later.';
    END IF;

    -- deleted_email as well as email: deleting an account moves the address aside, and that is
    -- the address the person will type.
    SELECT * INTO v_existing FROM public.users u
    WHERE lower(u.email) = v_email OR lower(u.deleted_email) = v_email
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
        v_user_id := v_existing.id;
        IF v_existing.deleted_at IS NOT NULL OR NOT v_existing.is_active THEN
            -- What they are asking for is reactivation, whichever door they came through.
            v_kind := 'reactivation';
            v_context := ' Their account already exists and is '
                || CASE WHEN v_existing.deleted_at IS NOT NULL THEN 'deleted' ELSE 'deactivated' END || '.';
        ELSIF NOT v_existing.onboarding_completed THEN
            v_context := ' They were approved already but have not finished setup — send them the'
                || ' setup link again, or point them at it and let them ask for a fresh code.';
        ELSE
            v_context := ' They already have an active account, so they are probably stuck signing in'
                || ' rather than waiting to be let in.';
        END IF;
    END IF;

    INSERT INTO public.access_requests (kind, user_id, name, email, note)
    VALUES (v_kind, v_user_id, COALESCE(NULLIF(v_existing.name, ''), v_name), v_email, v_note)
    RETURNING id INTO v_request_id;

    INSERT INTO public.notifications (user_id, type, title, message, link)
    SELECT
        a.id,
        'access_request',
        CASE WHEN v_kind = 'reactivation' THEN 'Reactivation requested' ELSE 'Access requested' END,
        v_name || ' (' || v_email || ') asked for access.'
            || COALESCE(NULLIF(v_context, ''), ' An admin needs to approve them.'),
        '/team-management'
    FROM public.access_request_audience() a;

    GET DIAGNOSTICS v_notified = ROW_COUNT;

    -- Same shape for every caller. Whether the address was known is not in here.
    RETURN jsonb_build_object('ok', true, 'notified', v_notified);
END;
$_$;


ALTER FUNCTION "public"."request_access"("p_name" "text", "p_email" "text", "p_note" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."request_form_fields" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "field_key" "text" NOT NULL,
    "skill_id" "uuid",
    "label" "text" NOT NULL,
    "placeholder" "text",
    "help_text" "text",
    "field_type" "text" NOT NULL,
    "options" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "default_value" "text",
    "enabled" boolean DEFAULT true NOT NULL,
    "required" boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "is_core" boolean DEFAULT false NOT NULL,
    "locked" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "request_form_fields_core_is_base" CHECK (((NOT "is_core") OR ("skill_id" IS NULL))),
    CONSTRAINT "request_form_fields_field_key_check" CHECK (("field_key" ~ '^[a-z][a-zA-Z0-9_]*$'::"text")),
    CONSTRAINT "request_form_fields_field_type_check" CHECK (("field_type" = ANY (ARRAY['text'::"text", 'textarea'::"text", 'number'::"text", 'date'::"text", 'select'::"text", 'checkbox'::"text", 'tags'::"text", 'picker'::"text"]))),
    CONSTRAINT "request_form_fields_label_check" CHECK (("btrim"("label") <> ''::"text")),
    CONSTRAINT "request_form_fields_locked_is_core" CHECK (((NOT "locked") OR "is_core")),
    CONSTRAINT "request_form_fields_options_is_array" CHECK (("jsonb_typeof"("options") = 'array'::"text")),
    CONSTRAINT "request_form_fields_select_has_options" CHECK ((("field_type" <> 'select'::"text") OR "is_core" OR ("jsonb_array_length"("options") > 0)))
);


ALTER TABLE "public"."request_form_fields" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_form_field_json"("f" "public"."request_form_fields") RETURNS "jsonb"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
    SELECT jsonb_build_object(
        'id', f.id,
        'fieldKey', f.field_key,
        'skillId', f.skill_id,
        'label', f.label,
        'placeholder', f.placeholder,
        'helpText', f.help_text,
        'fieldType', f.field_type,
        'options', f.options,
        'defaultValue', f.default_value,
        'enabled', f.enabled,
        'required', f.required,
        'position', f.position,
        'isCore', f.is_core,
        'locked', f.locked
    );
$$;


ALTER FUNCTION "public"."request_form_field_json"("f" "public"."request_form_fields") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_reactivation"("p_email" "text", "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
DECLARE
    v_email text;
    v_note text;
    v_user public.users;
BEGIN
    v_email := lower(nullif(btrim(p_email), ''));
    v_note  := nullif(btrim(p_note), '');

    IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$' THEN
        RAISE EXCEPTION 'A valid email address is required.';
    END IF;
    IF length(v_note) > 1000 THEN
        RAISE EXCEPTION 'Please keep your message under 1000 characters.';
    END IF;

    IF (SELECT count(*) FROM public.access_requests r
        WHERE lower(r.email) = v_email AND r.created_at > now() - interval '24 hours') >= 3 THEN
        RETURN jsonb_build_object('ok', true);
    END IF;

    SELECT * INTO v_user FROM public.users u
    WHERE lower(u.email) = v_email OR lower(u.deleted_email) = v_email
    LIMIT 1;

    IF v_user.id IS NULL OR (v_user.is_active AND v_user.deleted_at IS NULL) THEN
        RETURN jsonb_build_object('ok', true);
    END IF;

    INSERT INTO public.access_requests (kind, user_id, name, email, note)
    VALUES ('reactivation', v_user.id, v_user.name, v_email, v_note);

    INSERT INTO public.notifications (user_id, type, title, message, link)
    SELECT
        a.id,
        'reactivation_request',
        'Reactivation requested',
        v_user.name || ' (' || v_email || ') asked for their '
            || CASE WHEN v_user.deleted_at IS NOT NULL THEN 'deleted' ELSE 'deactivated' END
            || ' account to be reactivated.',
        '/team-management'
    FROM public.access_request_audience() a;

    RETURN jsonb_build_object('ok', true);
END;
$_$;


ALTER FUNCTION "public"."request_reactivation"("p_email" "text", "p_note" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."access_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kind" "text" DEFAULT 'access'::"text" NOT NULL,
    "user_id" "uuid",
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "note" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "resolved_by" "uuid",
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "access_requests_kind_check" CHECK (("kind" = ANY (ARRAY['access'::"text", 'reactivation'::"text"]))),
    CONSTRAINT "access_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'invited'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."access_requests" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_access_request"("p_id" "uuid", "p_status" "text") RETURNS "public"."access_requests"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_request public.access_requests;
BEGIN
    IF NOT public.current_user_is_form_admin() THEN
        RAISE EXCEPTION 'Only an admin can act on access requests.';
    END IF;
    IF p_status NOT IN ('invited', 'dismissed', 'pending') THEN
        RAISE EXCEPTION 'Unknown status: %', p_status;
    END IF;

    UPDATE public.access_requests
    SET status = p_status,
        resolved_by = CASE WHEN p_status = 'pending' THEN NULL ELSE auth.uid() END,
        resolved_at = CASE WHEN p_status = 'pending' THEN NULL ELSE timezone('utc', now()) END
    WHERE id = p_id
    RETURNING * INTO v_request;

    IF v_request IS NULL THEN
        RAISE EXCEPTION 'That access request no longer exists.';
    END IF;

    RETURN v_request;
END;
$$;


ALTER FUNCTION "public"."resolve_access_request"("p_id" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revoke_my_session"("p_session_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_current uuid;
    v_deleted integer;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'You must be signed in.';
    END IF;

    BEGIN
        v_current := nullif(auth.jwt() ->> 'session_id', '')::uuid;
    EXCEPTION WHEN others THEN
        v_current := NULL;
    END;

    -- user_id in the predicate, not just the id: the argument is client-supplied, and this
    -- is the line that keeps it from reaching anybody else's session.
    DELETE FROM auth.sessions WHERE id = p_session_id AND user_id = auth.uid();
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    IF v_deleted = 0 THEN
        RAISE EXCEPTION 'That session is no longer active.';
    END IF;

    RETURN jsonb_build_object('ok', true, 'wasCurrent', p_session_id IS NOT DISTINCT FROM v_current);
END;
$$;


ALTER FUNCTION "public"."revoke_my_session"("p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revoke_my_sessions"("p_keep_current" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_current uuid;
    v_deleted integer;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'You must be signed in.';
    END IF;

    BEGIN
        v_current := nullif(auth.jwt() ->> 'session_id', '')::uuid;
    EXCEPTION WHEN others THEN
        v_current := NULL;
    END;

    DELETE FROM auth.sessions
    WHERE user_id = auth.uid()
      AND (NOT p_keep_current OR v_current IS NULL OR id <> v_current);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    RETURN jsonb_build_object('ok', true, 'ended', v_deleted, 'keptCurrent', p_keep_current);
END;
$$;


ALTER FUNCTION "public"."revoke_my_sessions"("p_keep_current" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_request_form_config"("p_fields" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
DECLARE
    entry jsonb;
    v_id uuid;
    v_key text;
    v_skill uuid;
    v_type text;
    v_options jsonb;
    v_label text;
    v_enabled boolean;
    v_required boolean;
    v_kept uuid[] := ARRAY[]::uuid[];
    existing public.request_form_fields;
BEGIN
    IF NOT public.current_user_is_form_admin() THEN
        RAISE EXCEPTION 'Only an admin can change the request form.';
    END IF;

    IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'array' THEN
        RAISE EXCEPTION 'Expected a list of fields.';
    END IF;

    FOR entry IN SELECT * FROM jsonb_array_elements(p_fields)
    LOOP
        v_id      := nullif(entry->>'id', '')::uuid;
        v_key     := btrim(COALESCE(entry->>'fieldKey', ''));
        v_skill   := nullif(entry->>'skillId', '')::uuid;
        v_label   := btrim(COALESCE(entry->>'label', ''));
        v_type    := COALESCE(entry->>'fieldType', 'text');
        v_options := COALESCE(entry->'options', '[]'::jsonb);
        v_enabled := COALESCE((entry->>'enabled')::boolean, true);
        v_required := COALESCE((entry->>'required')::boolean, false);

        IF v_label = '' THEN
            RAISE EXCEPTION 'Every field needs a label.';
        END IF;
        IF jsonb_typeof(v_options) <> 'array' THEN
            RAISE EXCEPTION 'Options for "%" must be a list.', v_label;
        END IF;

        IF v_id IS NOT NULL THEN
            SELECT * INTO existing FROM public.request_form_fields WHERE id = v_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'That field no longer exists -- reopen the form settings and try again.';
            END IF;

            -- Identity is not editable. Letting the key or scope move would silently
            -- orphan every answer already stored under the old key.
            IF existing.is_core AND existing.locked AND NOT v_enabled THEN
                RAISE EXCEPTION '"%" cannot be turned off.', existing.label;
            END IF;
            IF NOT existing.is_core AND v_type NOT IN ('text','textarea','number','date','select','checkbox') THEN
                RAISE EXCEPTION 'Unknown field type: %', v_type;
            END IF;
            IF NOT existing.is_core AND v_type = 'select' AND jsonb_array_length(v_options) = 0 THEN
                RAISE EXCEPTION 'Dropdown "%" needs at least one option.', v_label;
            END IF;

            UPDATE public.request_form_fields SET
                label         = v_label,
                placeholder   = nullif(btrim(COALESCE(entry->>'placeholder', '')), ''),
                help_text     = nullif(btrim(COALESCE(entry->>'helpText', '')), ''),
                -- Core fields render a fixed control, so their type is theirs to keep.
                field_type    = CASE WHEN existing.is_core THEN existing.field_type ELSE v_type END,
                options       = CASE WHEN existing.is_core THEN existing.options ELSE v_options END,
                default_value = nullif(btrim(COALESCE(entry->>'defaultValue', '')), ''),
                enabled       = v_enabled,
                -- A field nobody can see cannot be required, and a locked one -- title,
                -- backed by a NOT NULL column -- cannot stop being.
                required      = CASE WHEN existing.locked THEN true ELSE v_enabled AND v_required END,
                position      = COALESCE((entry->>'position')::integer, existing.position),
                updated_at    = timezone('utc', now())
            WHERE id = v_id;

            v_kept := v_kept || v_id;
        ELSE
            IF v_key !~ '^[a-z][a-zA-Z0-9_]*$' THEN
                RAISE EXCEPTION 'Field key "%" must start with a lowercase letter and contain only letters, numbers or underscores.', v_key;
            END IF;
            IF v_type NOT IN ('text','textarea','number','date','select','checkbox') THEN
                RAISE EXCEPTION 'Unknown field type: %', v_type;
            END IF;
            IF v_type = 'select' AND jsonb_array_length(v_options) = 0 THEN
                RAISE EXCEPTION 'Dropdown "%" needs at least one option.', v_label;
            END IF;
            IF v_skill IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.skills s WHERE s.id = v_skill) THEN
                RAISE EXCEPTION 'That work category no longer exists.';
            END IF;
            IF EXISTS (
                SELECT 1 FROM public.request_form_fields f
                WHERE f.field_key = v_key AND f.skill_id IS NOT DISTINCT FROM v_skill
            ) THEN
                RAISE EXCEPTION 'A field with the key "%" already exists here.', v_key;
            END IF;

            INSERT INTO public.request_form_fields (
                field_key, skill_id, label, placeholder, help_text, field_type, options,
                default_value, enabled, required, position, is_core
            ) VALUES (
                v_key, v_skill, v_label,
                nullif(btrim(COALESCE(entry->>'placeholder', '')), ''),
                nullif(btrim(COALESCE(entry->>'helpText', '')), ''),
                v_type, v_options,
                nullif(btrim(COALESCE(entry->>'defaultValue', '')), ''),
                v_enabled, v_enabled AND v_required,
                COALESCE((entry->>'position')::integer, 500),
                false
            )
            RETURNING id INTO v_id;

            v_kept := v_kept || v_id;
        END IF;
    END LOOP;

    -- Anything custom the draft no longer mentions was removed in the modal. Core rows
    -- are never deleted, so a malformed payload cannot amputate the form.
    DELETE FROM public.request_form_fields f
    WHERE NOT f.is_core AND NOT (f.id = ANY (v_kept));

    RETURN public.get_request_form_config();
END;
$_$;


ALTER FUNCTION "public"."save_request_form_config"("p_fields" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_user_active"("p_user_id" "uuid", "p_active" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_caller_role text;
    v_target public.users;
    v_team_id uuid;
    v_notified integer := 0;
BEGIN
    SELECT u.role INTO v_caller_role FROM public.users u WHERE u.id = auth.uid();
    IF v_caller_role NOT IN ('super_admin', 'admin') THEN
        RAISE EXCEPTION 'Only an admin can deactivate or reactivate an account.';
    END IF;

    SELECT * INTO v_target FROM public.users WHERE id = p_user_id;
    IF v_target.id IS NULL THEN
        RAISE EXCEPTION 'That person no longer exists.';
    END IF;
    IF v_target.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'That account has been deleted.';
    END IF;
    IF v_target.role = 'super_admin' THEN
        RAISE EXCEPTION 'The super admin cannot be deactivated. Transfer ownership first.';
    END IF;
    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'You cannot deactivate your own account.';
    END IF;

    UPDATE public.users SET is_active = p_active WHERE id = p_user_id;

    IF NOT p_active THEN
        SELECT tm.team_id INTO v_team_id FROM public.team_members tm WHERE tm.user_id = p_user_id LIMIT 1;
        v_notified := public.notify_reassignment_needed(p_user_id, v_team_id, 'was deactivated');

        -- A deactivated account is turned away by the app on its next load; ending the
        -- sessions is what stops the tab already open in front of them.
        UPDATE public.users SET sessions_revoked_at = timezone('utc', now()) WHERE id = p_user_id;
        DELETE FROM auth.sessions WHERE user_id = p_user_id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'notified', v_notified);
END;
$$;


ALTER FUNCTION "public"."set_user_active"("p_user_id" "uuid", "p_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_user_role"("p_user_id" "uuid", "p_role" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_caller_role text;
    v_target_role text;
    v_target_onboarded boolean;
BEGIN
    SELECT u.role INTO v_caller_role
    FROM public.users u
    WHERE u.id = auth.uid() AND u.is_active AND u.deleted_at IS NULL;

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'You must be signed in.';
    END IF;

    IF v_caller_role NOT IN ('super_admin', 'admin') THEN
        RAISE EXCEPTION 'Only an admin can change what someone may do.';
    END IF;

    IF p_role NOT IN ('admin', 'manager', 'team_leader', 'team_member') THEN
        RAISE EXCEPTION 'Unknown role: %', p_role;
    END IF;

    SELECT u.role, u.onboarding_completed INTO v_target_role, v_target_onboarded
    FROM public.users u WHERE u.id = p_user_id;
    IF v_target_role IS NULL THEN
        RAISE EXCEPTION 'That person no longer exists.';
    END IF;

    IF NOT v_target_onboarded THEN
        RAISE EXCEPTION 'They have not set up their account yet, so they stay an invitee until they do.';
    END IF;

    IF v_target_role = 'super_admin' THEN
        RAISE EXCEPTION 'The super admin''s role is changed by transferring ownership.';
    END IF;

    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'You cannot change your own role.';
    END IF;

    IF (p_role = 'admin' OR v_target_role = 'admin') AND v_caller_role <> 'super_admin' THEN
        RAISE EXCEPTION 'Only the super admin can make or unmake an admin.';
    END IF;

    UPDATE public.users SET role = p_role WHERE id = p_user_id;

    RETURN jsonb_build_object('ok', true, 'role', p_role);
END;
$$;


ALTER FUNCTION "public"."set_user_role"("p_user_id" "uuid", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_public_request"("p_token" "text", "p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
DECLARE
    link public.request_form_links;
    fld public.request_form_fields;

    -- Core field settings, keyed by field_key. Read once so each check below is a lookup
    -- rather than ten more round trips into the table.
    cfg_on  jsonb;
    cfg_req jsonb;

    v_name text;
    v_email text;
    v_title text;
    v_description text;
    v_department text;
    v_priority text;
    v_client_id uuid;
    v_region_id uuid;
    v_category_id uuid;
    v_due_date timestamptz;
    v_hours numeric;
    v_custom jsonb := '{}'::jsonb;

    v_raw jsonb;
    v_val jsonb;
    v_text text;
    v_num numeric;
    v_bool boolean;
    v_date date;

    v_requester_id uuid;
    v_task_id uuid;
    v_ref text;
    v_submission_id uuid;
    v_tag_name text;
    v_tag_id uuid;
    v_palette text[] := ARRAY['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#14b8a6','#6366f1','#f43f5e'];

    -- Helper predicates, assigned right after cfg_on/cfg_req are loaded. A field with no
    -- row at all defaults to on, so a half-applied migration degrades to the old form.
    on_description boolean; req_description boolean;
    on_category    boolean; req_category    boolean;
    on_client      boolean; req_client      boolean;
    on_region      boolean; req_region      boolean;
    on_department  boolean; req_department  boolean;
    on_priority    boolean; req_priority    boolean;
    on_due         boolean; req_due         boolean;
    on_hours       boolean; req_hours       boolean;
    on_tags        boolean;
BEGIN
    SELECT * INTO link FROM public.request_form_links WHERE token = p_token;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This request link is not valid.';
    END IF;
    IF NOT link.public_access THEN
        RAISE EXCEPTION 'This form is not accepting requests right now.';
    END IF;

    SELECT
        COALESCE(jsonb_object_agg(f.field_key, f.enabled), '{}'::jsonb),
        COALESCE(jsonb_object_agg(f.field_key, f.enabled AND f.required), '{}'::jsonb)
    INTO cfg_on, cfg_req
    FROM public.request_form_fields f
    WHERE f.is_core AND f.skill_id IS NULL;

    on_description := COALESCE((cfg_on ->>'description')::boolean, true);
    on_category    := COALESCE((cfg_on ->>'category')::boolean, true);
    on_client      := COALESCE((cfg_on ->>'client')::boolean, true);
    on_region      := COALESCE((cfg_on ->>'region')::boolean, true);
    on_department  := COALESCE((cfg_on ->>'department')::boolean, true);
    on_priority    := COALESCE((cfg_on ->>'priority')::boolean, true);
    on_due         := COALESCE((cfg_on ->>'dueDate')::boolean, true);
    on_hours       := COALESCE((cfg_on ->>'estimatedHours')::boolean, true);
    on_tags        := COALESCE((cfg_on ->>'tags')::boolean, true);

    req_description := COALESCE((cfg_req->>'description')::boolean, true);
    req_category    := COALESCE((cfg_req->>'category')::boolean, true);
    req_client      := COALESCE((cfg_req->>'client')::boolean, true);
    req_region      := COALESCE((cfg_req->>'region')::boolean, true);
    req_department  := COALESCE((cfg_req->>'department')::boolean, true);
    req_priority    := COALESCE((cfg_req->>'priority')::boolean, true);
    req_due         := COALESCE((cfg_req->>'dueDate')::boolean, true);
    req_hours       := COALESCE((cfg_req->>'estimatedHours')::boolean, false);

    -- Name and email are not configurable: without them nobody can be told what happened
    -- to the request, and the per-address rate limit has nothing to count.
    v_name  := nullif(btrim(p_payload->>'requesterName'), '');
    v_email := lower(nullif(btrim(p_payload->>'requesterEmail'), ''));
    IF v_name IS NULL THEN RAISE EXCEPTION 'Your name is required.'; END IF;
    IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$' THEN
        RAISE EXCEPTION 'A valid email address is required.';
    END IF;

    -- tasks.title is NOT NULL, which is why this one field has no toggle.
    v_title := nullif(btrim(p_payload->>'title'), '');
    IF v_title IS NULL THEN RAISE EXCEPTION 'A request title is required.'; END IF;

    IF on_description THEN
        v_description := nullif(btrim(p_payload->>'description'), '');
        IF v_description IS NULL AND req_description THEN
            RAISE EXCEPTION 'A description is required.';
        END IF;
    END IF;

    IF on_department THEN
        v_department := nullif(btrim(p_payload->>'department'), '');
        IF v_department IS NULL AND req_department THEN
            RAISE EXCEPTION 'A department is required.';
        END IF;
    END IF;

    IF on_priority THEN
        v_priority := COALESCE(nullif(btrim(p_payload->>'priority'), ''), 'normal');
        IF v_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
            RAISE EXCEPTION 'Unknown priority: %', v_priority;
        END IF;
    ELSE
        -- Off means the requester was not asked, not that the task has no priority.
        v_priority := 'normal';
    END IF;

    -- Foreign keys come from the client, so each is checked against the same lists
    -- get_public_request_form handed out rather than trusted into the insert. The shape
    -- is checked before the cast so a hand-crafted payload gets the form's own wording
    -- back instead of a raw 'invalid input syntax for type uuid'.
    IF on_client THEN
        IF COALESCE(p_payload->>'clientId', '') ~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$' THEN
            v_client_id := (p_payload->>'clientId')::uuid;
            IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_client_id) THEN
                RAISE EXCEPTION 'Select a brand.';
            END IF;
        ELSIF req_client THEN
            RAISE EXCEPTION 'Select a brand.';
        END IF;
    END IF;

    IF on_region THEN
        IF COALESCE(p_payload->>'regionId', '') ~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$' THEN
            v_region_id := (p_payload->>'regionId')::uuid;
            IF NOT EXISTS (SELECT 1 FROM public.regions r WHERE r.id = v_region_id) THEN
                RAISE EXCEPTION 'Select a region.';
            END IF;
        ELSIF req_region THEN
            RAISE EXCEPTION 'Select a region.';
        END IF;
    END IF;

    IF on_category THEN
        IF COALESCE(p_payload->>'categoryId', '') ~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$' THEN
            v_category_id := (p_payload->>'categoryId')::uuid;
            IF NOT EXISTS (SELECT 1 FROM public.skills s WHERE s.id = v_category_id) THEN
                RAISE EXCEPTION 'Select a work category.';
            END IF;
        ELSIF req_category THEN
            RAISE EXCEPTION 'Select a work category.';
        END IF;
    END IF;

    IF on_due THEN
        BEGIN
            v_due_date := nullif(btrim(p_payload->>'dueDate'), '')::timestamptz;
        EXCEPTION WHEN others THEN
            RAISE EXCEPTION 'A valid due date is required.';
        END;
        IF v_due_date IS NULL AND req_due THEN
            RAISE EXCEPTION 'A due date is required.';
        END IF;
    END IF;

    IF on_hours THEN
        BEGIN
            v_hours := nullif(btrim(p_payload->>'estimatedHours'), '')::numeric;
        EXCEPTION WHEN others THEN
            RAISE EXCEPTION 'Estimated hours must be a number.';
        END;
        IF v_hours IS NULL AND req_hours THEN
            RAISE EXCEPTION 'Estimated hours are required.';
        END IF;
        IF v_hours IS NOT NULL AND (v_hours <= 0 OR v_hours > 10000) THEN
            RAISE EXCEPTION 'Estimated hours must be between 0 and 10000.';
        END IF;
    END IF;

    -- Custom fields: the base extras plus whatever is scoped to the chosen category.
    -- Anything else in p_payload->'customFields' is dropped rather than stored, so the
    -- shape of tasks.custom_fields is decided here and not by the caller.
    FOR fld IN
        SELECT * FROM public.request_form_fields f
        WHERE f.enabled AND NOT f.is_core
          AND (f.skill_id IS NULL OR f.skill_id = v_category_id)
        ORDER BY f.position, f.label
    LOOP
        v_raw := p_payload->'customFields'->fld.field_key;

        IF v_raw IS NULL
           OR jsonb_typeof(v_raw) = 'null'
           OR (jsonb_typeof(v_raw) = 'string' AND btrim(v_raw #>> '{}') = '') THEN
            IF fld.required THEN
                RAISE EXCEPTION '% is required.', fld.label;
            END IF;
            CONTINUE;
        END IF;

        IF fld.field_type = 'number' THEN
            BEGIN
                v_num := (btrim(v_raw #>> '{}'))::numeric;
            EXCEPTION WHEN others THEN
                RAISE EXCEPTION '% must be a number.', fld.label;
            END;
            v_val := to_jsonb(v_num);
        ELSIF fld.field_type = 'checkbox' THEN
            BEGIN
                v_bool := (btrim(v_raw #>> '{}'))::boolean;
            EXCEPTION WHEN others THEN
                RAISE EXCEPTION '% must be yes or no.', fld.label;
            END;
            IF fld.required AND NOT v_bool THEN
                RAISE EXCEPTION '% is required.', fld.label;
            END IF;
            v_val := to_jsonb(v_bool);
        ELSIF fld.field_type = 'date' THEN
            BEGIN
                v_date := (btrim(v_raw #>> '{}'))::date;
            EXCEPTION WHEN others THEN
                RAISE EXCEPTION '% must be a valid date.', fld.label;
            END;
            v_val := to_jsonb(v_date::text);
        ELSIF fld.field_type = 'select' THEN
            v_text := btrim(v_raw #>> '{}');
            IF NOT (fld.options ? v_text) THEN
                RAISE EXCEPTION 'Choose one of the listed options for %.', fld.label;
            END IF;
            v_val := to_jsonb(v_text);
        ELSE
            v_text := btrim(v_raw #>> '{}');
            IF length(v_text) > 5000 THEN
                RAISE EXCEPTION '% is too long (5000 characters maximum).', fld.label;
            END IF;
            v_val := to_jsonb(v_text);
        END IF;

        v_custom := v_custom || jsonb_build_object(fld.field_key, v_val);
    END LOOP;

    IF (SELECT count(*) FROM public.request_form_submissions s
        WHERE s.link_id = link.id AND s.created_at > now() - interval '1 hour') >= 100 THEN
        RAISE EXCEPTION 'This form has received too many requests in the last hour. Please try again later.';
    END IF;
    IF (SELECT count(*) FROM public.request_form_submissions s
        WHERE lower(s.requester_email) = v_email AND s.created_at > now() - interval '1 hour') >= 10 THEN
        RAISE EXCEPTION 'Too many requests from this email address in the last hour. Please try again later.';
    END IF;

    -- Someone on the team using the public link still gets attributed to their account.
    SELECT u.id INTO v_requester_id FROM public.users u WHERE lower(u.email) = v_email;

    INSERT INTO public.tasks (
        title, description, client_id, department, region_id, priority, due_date,
        estimated_hours, status, requester_id, requester_name, requester_email, custom_fields
    ) VALUES (
        v_title, v_description, v_client_id, v_department, v_region_id, v_priority, v_due_date,
        v_hours, 'new_request', v_requester_id, v_name, v_email, v_custom
    )
    RETURNING id INTO v_task_id;

    -- The Work Category picker searches skills, so the answer belongs in task_skills.
    IF v_category_id IS NOT NULL THEN
        INSERT INTO public.task_skills (task_id, skill_id)
        VALUES (v_task_id, v_category_id)
        ON CONFLICT DO NOTHING;
    END IF;

    -- Tags are find-or-create by name, case-insensitively, same as the internal form.
    IF on_tags THEN
        FOR v_tag_name IN
            SELECT DISTINCT btrim(elem.tag)
            FROM jsonb_array_elements_text(COALESCE(p_payload->'tags', '[]'::jsonb)) AS elem(tag)
            WHERE btrim(elem.tag) <> ''
        LOOP
            v_tag_name := upper(left(v_tag_name, 1)) || substr(v_tag_name, 2);

            SELECT id INTO v_tag_id FROM public.tags WHERE lower(name) = lower(v_tag_name);
            IF v_tag_id IS NULL THEN
                INSERT INTO public.tags (name, color)
                VALUES (v_tag_name, v_palette[1 + floor(random() * array_length(v_palette, 1))::int])
                RETURNING id INTO v_tag_id;
            END IF;

            INSERT INTO public.task_tags (task_id, tag_id)
            VALUES (v_task_id, v_tag_id)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END IF;

    v_ref := 'REQ-' || upper(left(replace(v_task_id::text, '-', ''), 6));

    INSERT INTO public.request_form_submissions (
        link_id, task_id, requester_name, requester_email, request_ref
    ) VALUES (
        link.id, v_task_id, v_name, v_email, v_ref
    )
    RETURNING id INTO v_submission_id;

    RETURN jsonb_build_object(
        'ok', true,
        'taskId', v_task_id,
        'requestRef', v_ref,
        'submissionId', v_submission_id,
        'sendConfirmation', link.send_confirmation
    );
END;
$_$;


ALTER FUNCTION "public"."submit_public_request"("p_token" "text", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."task_stage"("p_status" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
    SELECT CASE p_status
        WHEN 'new_request'                 THEN 'NewRequests'
        WHEN 'awaiting_assignment'         THEN 'NewRequests'
        WHEN 'scheduled'                   THEN 'Planning'
        WHEN 'manager_review_required'     THEN 'Planning'
        WHEN 'awaiting_employee_approval'  THEN 'Planning'
        WHEN 'provisional_assignment'      THEN 'Planning'
        WHEN 'accepted'                    THEN 'Planning'
        WHEN 'in_progress'                 THEN 'InProgress'
        WHEN 'changes_requested'           THEN 'InProgress'
        WHEN 'in_review'                   THEN 'InReview'
        WHEN 'on_hold'                     THEN 'OnHold'
        WHEN 'blocked'                     THEN 'OnHold'
        WHEN 'waiting_for_information'     THEN 'OnHold'
        WHEN 'waiting_for_approval'        THEN 'OnHold'
        WHEN 'completed'                   THEN 'Completed'
        WHEN 'cancelled'                   THEN 'Cancelled'
        ELSE 'Other'
    END;
$$;


ALTER FUNCTION "public"."task_stage"("p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transfer_super_admin_ownership"("new_super_admin_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'super_admin'
    ) THEN
        RAISE EXCEPTION 'Only the current super admin can transfer ownership.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = new_super_admin_id) THEN
        RAISE EXCEPTION 'Target user does not exist.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = new_super_admin_id AND onboarding_completed
    ) THEN
        RAISE EXCEPTION 'They have not set up their account yet, so ownership cannot be transferred to them.';
    END IF;
    IF auth.uid() = new_super_admin_id THEN
        RAISE EXCEPTION 'That user is already the super admin.';
    END IF;

    UPDATE public.users SET role = 'admin' WHERE id = auth.uid();
    UPDATE public.users SET role = 'super_admin' WHERE id = new_super_admin_id;
END;
$$;


ALTER FUNCTION "public"."transfer_super_admin_ownership"("new_super_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_dashboard_link"("p_public_access" boolean) RETURNS "public"."dashboard_links"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    link public.dashboard_links;
BEGIN
    IF NOT public.current_user_is_form_admin() THEN
        RAISE EXCEPTION 'Only an admin can change the dashboard link.';
    END IF;

    UPDATE public.dashboard_links
    SET public_access = COALESCE(p_public_access, public_access),
        updated_at = timezone('utc', now())
    WHERE scope = 'org'
    RETURNING * INTO link;

    IF link IS NULL THEN
        RAISE EXCEPTION 'No dashboard link exists yet.';
    END IF;

    RETURN link;
END;
$$;


ALTER FUNCTION "public"."update_dashboard_link"("p_public_access" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_request_form_link"("p_public_access" boolean DEFAULT NULL::boolean, "p_send_confirmation" boolean DEFAULT NULL::boolean) RETURNS "public"."request_form_links"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    link public.request_form_links;
BEGIN
    IF NOT public.current_user_is_form_admin() THEN
        RAISE EXCEPTION 'Only an admin can change the share link settings.';
    END IF;

    UPDATE public.request_form_links
    SET public_access = COALESCE(p_public_access, public_access),
        send_confirmation = COALESCE(p_send_confirmation, send_confirmation),
        updated_at = timezone('utc', now())
    WHERE scope = 'org'
    RETURNING * INTO link;

    IF link IS NULL THEN
        RAISE EXCEPTION 'No share link exists yet.';
    END IF;

    RETURN link;
END;
$$;


ALTER FUNCTION "public"."update_request_form_link"("p_public_access" boolean, "p_send_confirmation" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_current_password"("p_password" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_hash text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'You must be signed in.';
    END IF;

    IF coalesce(p_password, '') = '' THEN
        RETURN false;
    END IF;

    SELECT encrypted_password INTO v_hash FROM auth.users WHERE id = auth.uid();
    IF coalesce(v_hash, '') = '' THEN
        RETURN false;
    END IF;

    RETURN extensions.crypt(p_password, v_hash) = v_hash;
END;
$$;


ALTER FUNCTION "public"."verify_current_password"("p_password" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assignments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "assigned_date" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "assigned_by_id" "uuid",
    "response_date" timestamp with time zone,
    "proposed_start_date" timestamp with time zone,
    "proposed_end_date" timestamp with time zone,
    "estimated_hours" numeric,
    "rejection_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "assignments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'rejected'::"text", 'reassigned'::"text"])))
);


ALTER TABLE "public"."assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "action" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "changes" "jsonb" NOT NULL,
    "timestamp" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "department" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "website" "text",
    "favicon" "text"
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."comments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "task_id" "uuid",
    "user_id" "uuid",
    "content" "text" NOT NULL,
    "is_internal" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_kpi_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "snapshot_date" "date" NOT NULL,
    "metric_name" "text" NOT NULL,
    "metric_value" numeric DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."daily_kpi_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leaves" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "start_date" timestamp with time zone NOT NULL,
    "end_date" timestamp with time zone NOT NULL,
    "type" "text" NOT NULL,
    "hours" numeric,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."leaves" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mfa_recovery_attempts" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "succeeded" boolean NOT NULL,
    "attempted_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."mfa_recovery_attempts" OWNER TO "postgres";


ALTER TABLE "public"."mfa_recovery_attempts" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."mfa_recovery_attempts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."mfa_recovery_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "code_hash" "text" NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."mfa_recovery_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "is_read" boolean DEFAULT false,
    "link" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."onboarding_temp_password_events" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "actor_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "onboarding_temp_password_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['issued'::"text", 'consumed'::"text"])))
);


ALTER TABLE "public"."onboarding_temp_password_events" OWNER TO "postgres";


ALTER TABLE "public"."onboarding_temp_password_events" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."onboarding_temp_password_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."onboarding_temp_passwords" (
    "user_id" "uuid" NOT NULL,
    "password_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "consumed_at" timestamp with time zone,
    "failed_attempts" integer DEFAULT 0 NOT NULL,
    "locked_until" timestamp with time zone,
    "generated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "onboarding_temp_password_attempts_nonnegative" CHECK (("failed_attempts" >= 0))
);


ALTER TABLE "public"."onboarding_temp_passwords" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."regions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "code" "text" NOT NULL,
    "flag" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."regions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."request_form_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "link_id" "uuid" NOT NULL,
    "task_id" "uuid",
    "requester_name" "text" NOT NULL,
    "requester_email" "text" NOT NULL,
    "request_ref" "text" NOT NULL,
    "confirmation_sent_at" timestamp with time zone,
    "confirmation_error" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."request_form_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."skills" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "embedding" "extensions"."vector"(384)
);


ALTER TABLE "public"."skills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "color" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_activity" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "type" "text" NOT NULL,
    "detail" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."task_activity" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_dependencies" (
    "task_id" "uuid" NOT NULL,
    "depends_on_task_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    CONSTRAINT "task_dependencies_type_check" CHECK (("type" = ANY (ARRAY['blocks'::"text", 'blocked_by'::"text", 'linked'::"text", 'dependency'::"text"])))
);


ALTER TABLE "public"."task_dependencies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_skills" (
    "task_id" "uuid" NOT NULL,
    "skill_id" "uuid" NOT NULL
);


ALTER TABLE "public"."task_skills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_tags" (
    "task_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL
);


ALTER TABLE "public"."task_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_teams" (
    "task_id" "uuid" NOT NULL,
    "team_id" "uuid" NOT NULL
);


ALTER TABLE "public"."task_teams" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "request_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "category_id" "uuid",
    "client_id" "uuid",
    "department" "text",
    "requester_id" "uuid",
    "priority" "text",
    "status" "text" NOT NULL,
    "estimated_hours" numeric,
    "actual_hours" numeric,
    "due_date" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "completed_date" timestamp with time zone,
    "assignee_id" "uuid",
    "assigned_date" timestamp with time zone,
    "assigned_by_id" "uuid",
    "accepted_date" timestamp with time zone,
    "proposed_start_date" timestamp with time zone,
    "proposed_end_date" timestamp with time zone,
    "parent_task_id" "uuid",
    "is_subtask" boolean DEFAULT false,
    "checklist" "jsonb" DEFAULT '[]'::"jsonb",
    "tags" "text"[] DEFAULT ARRAY[]::"text"[],
    "region_id" "uuid",
    "requester_name" "text",
    "requester_email" "text",
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "tasks_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text", 'urgent'::"text"])))
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_members" (
    "team_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL
);


ALTER TABLE "public"."team_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_skills" (
    "team_id" "uuid" NOT NULL,
    "skill_id" "uuid" NOT NULL
);


ALTER TABLE "public"."team_skills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teams" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "color" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_home_team" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."teams" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_clients" (
    "user_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL
);


ALTER TABLE "public"."user_clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_regions" (
    "user_id" "uuid" NOT NULL,
    "region_id" "uuid" NOT NULL
);


ALTER TABLE "public"."user_regions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_skills" (
    "user_id" "uuid" NOT NULL,
    "skill_id" "uuid" NOT NULL,
    "proficiency_level" "text",
    CONSTRAINT "user_skills_proficiency_level_check" CHECK (("proficiency_level" = ANY (ARRAY['beginner'::"text", 'intermediate'::"text", 'advanced'::"text", 'expert'::"text"])))
);


ALTER TABLE "public"."user_skills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" DEFAULT 'team_member'::"text" NOT NULL,
    "daily_capacity" integer DEFAULT 8 NOT NULL,
    "avatar" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "onboarding_completed" boolean DEFAULT false NOT NULL,
    "sessions_revoked_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "deleted_email" "text",
    CONSTRAINT "users_role_check" CHECK (("role" = ANY (ARRAY['super_admin'::"text", 'admin'::"text", 'manager'::"text", 'team_leader'::"text", 'team_member'::"text", 'invitee'::"text", 'requester'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."work_categories" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "default_hours" numeric,
    "icon" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."work_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."work_category_skills" (
    "category_id" "uuid" NOT NULL,
    "skill_id" "uuid" NOT NULL
);


ALTER TABLE "public"."work_category_skills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."work_category_teams" (
    "category_id" "uuid" NOT NULL,
    "team_id" "uuid" NOT NULL
);


ALTER TABLE "public"."work_category_teams" OWNER TO "postgres";


ALTER TABLE ONLY "public"."access_requests"
    ADD CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_kpi_snapshots"
    ADD CONSTRAINT "daily_kpi_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_kpi_snapshots"
    ADD CONSTRAINT "daily_kpi_snapshots_snapshot_date_metric_name_key" UNIQUE ("snapshot_date", "metric_name");



ALTER TABLE ONLY "public"."dashboard_links"
    ADD CONSTRAINT "dashboard_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dashboard_links"
    ADD CONSTRAINT "dashboard_links_scope_key" UNIQUE ("scope");



ALTER TABLE ONLY "public"."dashboard_links"
    ADD CONSTRAINT "dashboard_links_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."leaves"
    ADD CONSTRAINT "leaves_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mfa_recovery_attempts"
    ADD CONSTRAINT "mfa_recovery_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mfa_recovery_codes"
    ADD CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."onboarding_temp_password_events"
    ADD CONSTRAINT "onboarding_temp_password_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."onboarding_temp_passwords"
    ADD CONSTRAINT "onboarding_temp_passwords_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."regions"
    ADD CONSTRAINT "regions_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."regions"
    ADD CONSTRAINT "regions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."request_form_fields"
    ADD CONSTRAINT "request_form_fields_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."request_form_links"
    ADD CONSTRAINT "request_form_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."request_form_links"
    ADD CONSTRAINT "request_form_links_scope_key" UNIQUE ("scope");



ALTER TABLE ONLY "public"."request_form_links"
    ADD CONSTRAINT "request_form_links_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."request_form_submissions"
    ADD CONSTRAINT "request_form_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_activity"
    ADD CONSTRAINT "task_activity_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_dependencies"
    ADD CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("task_id", "depends_on_task_id", "type");



ALTER TABLE ONLY "public"."task_skills"
    ADD CONSTRAINT "task_skills_pkey" PRIMARY KEY ("task_id", "skill_id");



ALTER TABLE ONLY "public"."task_tags"
    ADD CONSTRAINT "task_tags_pkey" PRIMARY KEY ("task_id", "tag_id");



ALTER TABLE ONLY "public"."task_teams"
    ADD CONSTRAINT "task_teams_pkey" PRIMARY KEY ("task_id", "team_id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_pkey" PRIMARY KEY ("team_id", "user_id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."team_skills"
    ADD CONSTRAINT "team_skills_pkey" PRIMARY KEY ("team_id", "skill_id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_clients"
    ADD CONSTRAINT "user_clients_pkey" PRIMARY KEY ("user_id", "client_id");



ALTER TABLE ONLY "public"."user_regions"
    ADD CONSTRAINT "user_regions_pkey" PRIMARY KEY ("user_id", "region_id");



ALTER TABLE ONLY "public"."user_skills"
    ADD CONSTRAINT "user_skills_pkey" PRIMARY KEY ("user_id", "skill_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."work_categories"
    ADD CONSTRAINT "work_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."work_category_skills"
    ADD CONSTRAINT "work_category_skills_pkey" PRIMARY KEY ("category_id", "skill_id");



ALTER TABLE ONLY "public"."work_category_teams"
    ADD CONSTRAINT "work_category_teams_pkey" PRIMARY KEY ("category_id", "team_id");



CREATE INDEX "access_requests_email_created_idx" ON "public"."access_requests" USING "btree" ("lower"("email"), "created_at" DESC);



CREATE INDEX "access_requests_pending_idx" ON "public"."access_requests" USING "btree" ("created_at" DESC) WHERE ("status" = 'pending'::"text");



CREATE UNIQUE INDEX "assignments_one_pending_per_task" ON "public"."assignments" USING "btree" ("task_id") WHERE ("status" = 'pending'::"text");



CREATE INDEX "assignments_task_id_idx" ON "public"."assignments" USING "btree" ("task_id");



CREATE INDEX "assignments_user_status_idx" ON "public"."assignments" USING "btree" ("user_id", "status");



CREATE INDEX "audit_logs_timestamp_idx" ON "public"."audit_logs" USING "btree" ("timestamp" DESC);



CREATE INDEX "comments_task_created_idx" ON "public"."comments" USING "btree" ("task_id", "created_at");



CREATE INDEX "comments_user_id_idx" ON "public"."comments" USING "btree" ("user_id");



CREATE INDEX "daily_kpi_snapshots_date_idx" ON "public"."daily_kpi_snapshots" USING "btree" ("snapshot_date" DESC);



CREATE INDEX "daily_kpi_snapshots_metric_date_idx" ON "public"."daily_kpi_snapshots" USING "btree" ("metric_name", "snapshot_date" DESC);



CREATE INDEX "mfa_recovery_attempts_user_idx" ON "public"."mfa_recovery_attempts" USING "btree" ("user_id", "attempted_at" DESC);



CREATE INDEX "mfa_recovery_codes_user_idx" ON "public"."mfa_recovery_codes" USING "btree" ("user_id") WHERE ("used_at" IS NULL);



CREATE INDEX "notifications_unread_idx" ON "public"."notifications" USING "btree" ("user_id") WHERE ("is_read" = false);



CREATE INDEX "notifications_user_created_idx" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "onboarding_temp_password_events_user_idx" ON "public"."onboarding_temp_password_events" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "onboarding_temp_passwords_expiry_idx" ON "public"."onboarding_temp_passwords" USING "btree" ("expires_at") WHERE ("consumed_at" IS NULL);



CREATE UNIQUE INDEX "request_form_fields_base_key_idx" ON "public"."request_form_fields" USING "btree" ("field_key") WHERE ("skill_id" IS NULL);



CREATE UNIQUE INDEX "request_form_fields_scoped_key_idx" ON "public"."request_form_fields" USING "btree" ("skill_id", "field_key") WHERE ("skill_id" IS NOT NULL);



CREATE INDEX "request_form_fields_skill_idx" ON "public"."request_form_fields" USING "btree" ("skill_id");



CREATE INDEX "request_form_submissions_email_created_idx" ON "public"."request_form_submissions" USING "btree" ("lower"("requester_email"), "created_at" DESC);



CREATE INDEX "request_form_submissions_link_created_idx" ON "public"."request_form_submissions" USING "btree" ("link_id", "created_at" DESC);



CREATE INDEX "task_activity_task_created_idx" ON "public"."task_activity" USING "btree" ("task_id", "created_at");



CREATE INDEX "task_skills_skill_id_idx" ON "public"."task_skills" USING "btree" ("skill_id");



CREATE INDEX "task_tags_tag_id_idx" ON "public"."task_tags" USING "btree" ("tag_id");



CREATE INDEX "task_teams_team_id_idx" ON "public"."task_teams" USING "btree" ("team_id");



CREATE INDEX "tasks_assignee_id_idx" ON "public"."tasks" USING "btree" ("assignee_id");



CREATE INDEX "tasks_assignee_status_idx" ON "public"."tasks" USING "btree" ("assignee_id", "status") WHERE ("assignee_id" IS NOT NULL);



CREATE INDEX "tasks_client_id_idx" ON "public"."tasks" USING "btree" ("client_id");



CREATE INDEX "tasks_created_at_idx" ON "public"."tasks" USING "btree" ("created_at" DESC);



CREATE INDEX "tasks_due_date_idx" ON "public"."tasks" USING "btree" ("due_date");



CREATE INDEX "tasks_open_due_date_idx" ON "public"."tasks" USING "btree" ("due_date") WHERE ("status" <> ALL (ARRAY['completed'::"text", 'cancelled'::"text"]));



CREATE INDEX "tasks_parent_task_id_idx" ON "public"."tasks" USING "btree" ("parent_task_id") WHERE ("parent_task_id" IS NOT NULL);



CREATE INDEX "tasks_priority_idx" ON "public"."tasks" USING "btree" ("priority");



CREATE INDEX "tasks_region_id_idx" ON "public"."tasks" USING "btree" ("region_id");



CREATE INDEX "tasks_requester_id_idx" ON "public"."tasks" USING "btree" ("requester_id");



CREATE INDEX "tasks_status_idx" ON "public"."tasks" USING "btree" ("status");



CREATE INDEX "team_members_team_id_idx" ON "public"."team_members" USING "btree" ("team_id");



CREATE INDEX "team_skills_skill_id_idx" ON "public"."team_skills" USING "btree" ("skill_id");



CREATE UNIQUE INDEX "teams_single_home_team" ON "public"."teams" USING "btree" ("is_home_team") WHERE ("is_home_team" = true);



CREATE INDEX "user_clients_client_id_idx" ON "public"."user_clients" USING "btree" ("client_id");



CREATE INDEX "user_regions_region_id_idx" ON "public"."user_regions" USING "btree" ("region_id");



CREATE INDEX "user_skills_skill_id_idx" ON "public"."user_skills" USING "btree" ("skill_id");



CREATE INDEX "users_active_idx" ON "public"."users" USING "btree" ("role") WHERE (("deleted_at" IS NULL) AND "is_active");



CREATE INDEX "users_lower_email_idx" ON "public"."users" USING "btree" ("lower"("email"));



CREATE UNIQUE INDEX "users_single_super_admin" ON "public"."users" USING "btree" ("role") WHERE ("role" = 'super_admin'::"text");



CREATE OR REPLACE TRIGGER "on_team_member_added_promote_requester" AFTER INSERT ON "public"."team_members" FOR EACH ROW EXECUTE FUNCTION "public"."promote_requester_on_team_join"();



CREATE OR REPLACE TRIGGER "on_team_member_removed_demote_requester" AFTER DELETE ON "public"."team_members" FOR EACH ROW EXECUTE FUNCTION "public"."demote_and_sign_out_teamless_member"();



CREATE OR REPLACE TRIGGER "trg_enforce_assignment_status_transition" BEFORE UPDATE OF "status" ON "public"."assignments" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_assignment_status_transition"();



CREATE OR REPLACE TRIGGER "trg_enforce_super_admin_home_team" AFTER INSERT OR UPDATE OF "role" ON "public"."users" FOR EACH ROW WHEN (("new"."role" = 'super_admin'::"text")) EXECUTE FUNCTION "public"."enforce_super_admin_home_team"();



CREATE OR REPLACE TRIGGER "trg_notify_on_assignment" AFTER INSERT ON "public"."assignments" FOR EACH ROW WHEN (("new"."status" = 'pending'::"text")) EXECUTE FUNCTION "public"."notify_on_assignment"();



CREATE OR REPLACE TRIGGER "trg_prevent_super_admin_home_team_removal" BEFORE DELETE ON "public"."team_members" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_super_admin_home_team_removal"();



ALTER TABLE ONLY "public"."access_requests"
    ADD CONSTRAINT "access_requests_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."access_requests"
    ADD CONSTRAINT "access_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dashboard_links"
    ADD CONSTRAINT "dashboard_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leaves"
    ADD CONSTRAINT "leaves_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mfa_recovery_attempts"
    ADD CONSTRAINT "mfa_recovery_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mfa_recovery_codes"
    ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."onboarding_temp_password_events"
    ADD CONSTRAINT "onboarding_temp_password_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."onboarding_temp_password_events"
    ADD CONSTRAINT "onboarding_temp_password_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."onboarding_temp_passwords"
    ADD CONSTRAINT "onboarding_temp_passwords_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."onboarding_temp_passwords"
    ADD CONSTRAINT "onboarding_temp_passwords_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."request_form_fields"
    ADD CONSTRAINT "request_form_fields_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."request_form_links"
    ADD CONSTRAINT "request_form_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."request_form_submissions"
    ADD CONSTRAINT "request_form_submissions_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "public"."request_form_links"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."request_form_submissions"
    ADD CONSTRAINT "request_form_submissions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_activity"
    ADD CONSTRAINT "task_activity_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_activity"
    ADD CONSTRAINT "task_activity_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_dependencies"
    ADD CONSTRAINT "task_dependencies_depends_on_task_id_fkey" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_dependencies"
    ADD CONSTRAINT "task_dependencies_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_skills"
    ADD CONSTRAINT "task_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_skills"
    ADD CONSTRAINT "task_skills_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_tags"
    ADD CONSTRAINT "task_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_tags"
    ADD CONSTRAINT "task_tags_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_teams"
    ADD CONSTRAINT "task_teams_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_teams"
    ADD CONSTRAINT "task_teams_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."work_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_skills"
    ADD CONSTRAINT "team_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_skills"
    ADD CONSTRAINT "team_skills_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_clients"
    ADD CONSTRAINT "user_clients_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_clients"
    ADD CONSTRAINT "user_clients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_regions"
    ADD CONSTRAINT "user_regions_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_regions"
    ADD CONSTRAINT "user_regions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_skills"
    ADD CONSTRAINT "user_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_skills"
    ADD CONSTRAINT "user_skills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_category_skills"
    ADD CONSTRAINT "work_category_skills_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."work_categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_category_skills"
    ADD CONSTRAINT "work_category_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_category_teams"
    ADD CONSTRAINT "work_category_teams_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."work_categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_category_teams"
    ADD CONSTRAINT "work_category_teams_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



CREATE POLICY "Signed-in users can read form fields" ON "public"."request_form_fields" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Signed-in users can read public submissions" ON "public"."request_form_submissions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Signed-in users can read the share link" ON "public"."request_form_links" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."access_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "access_requests_select" ON "public"."access_requests" FOR SELECT TO "authenticated" USING ("public"."current_user_sees_access_requests"());



ALTER TABLE "public"."assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assignments_select" ON "public"."assignments" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."can_assign_work"()));



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_logs_select" ON "public"."audit_logs" FOR SELECT TO "authenticated" USING ("public"."is_org_admin"());



ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients_delete" ON "public"."clients" FOR DELETE TO "authenticated" USING ("public"."is_org_admin"());



CREATE POLICY "clients_insert" ON "public"."clients" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_org_admin"());



CREATE POLICY "clients_select" ON "public"."clients" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



CREATE POLICY "clients_update" ON "public"."clients" FOR UPDATE TO "authenticated" USING ("public"."is_org_admin"()) WITH CHECK ("public"."is_org_admin"());



ALTER TABLE "public"."comments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "comments_delete" ON "public"."comments" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_org_admin"()));



CREATE POLICY "comments_insert" ON "public"."comments" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."is_live_user"()));



CREATE POLICY "comments_select" ON "public"."comments" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



CREATE POLICY "comments_update" ON "public"."comments" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_org_admin"())) WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_org_admin"()));



ALTER TABLE "public"."daily_kpi_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "daily_kpi_snapshots_select" ON "public"."daily_kpi_snapshots" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



ALTER TABLE "public"."dashboard_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dashboard_links_select" ON "public"."dashboard_links" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



ALTER TABLE "public"."leaves" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leaves_delete" ON "public"."leaves" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_org_admin"()));



CREATE POLICY "leaves_insert" ON "public"."leaves" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_org_admin"()));



CREATE POLICY "leaves_select" ON "public"."leaves" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



CREATE POLICY "leaves_update" ON "public"."leaves" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_org_admin"())) WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_org_admin"()));



ALTER TABLE "public"."mfa_recovery_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mfa_recovery_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_select_own" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "notifications_update_own" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."onboarding_temp_password_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."onboarding_temp_passwords" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."regions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "regions_delete" ON "public"."regions" FOR DELETE TO "authenticated" USING ("public"."is_org_admin"());



CREATE POLICY "regions_insert" ON "public"."regions" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_org_admin"());



CREATE POLICY "regions_select" ON "public"."regions" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



CREATE POLICY "regions_update" ON "public"."regions" FOR UPDATE TO "authenticated" USING ("public"."is_org_admin"()) WITH CHECK ("public"."is_org_admin"());



ALTER TABLE "public"."request_form_fields" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."request_form_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."request_form_submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."skills" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "skills_delete" ON "public"."skills" FOR DELETE TO "authenticated" USING ("public"."is_org_admin"());



CREATE POLICY "skills_insert" ON "public"."skills" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_team_manager"());



CREATE POLICY "skills_select" ON "public"."skills" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



CREATE POLICY "skills_update" ON "public"."skills" FOR UPDATE TO "authenticated" USING ("public"."is_team_manager"()) WITH CHECK ("public"."is_team_manager"());



ALTER TABLE "public"."tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tags_delete" ON "public"."tags" FOR DELETE TO "authenticated" USING ("public"."is_org_admin"());



CREATE POLICY "tags_insert" ON "public"."tags" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_live_user"());



CREATE POLICY "tags_select" ON "public"."tags" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



CREATE POLICY "tags_update" ON "public"."tags" FOR UPDATE TO "authenticated" USING ("public"."is_org_admin"()) WITH CHECK ("public"."is_org_admin"());



ALTER TABLE "public"."task_activity" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_activity_select" ON "public"."task_activity" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



ALTER TABLE "public"."task_dependencies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_dependencies_delete" ON "public"."task_dependencies" FOR DELETE TO "authenticated" USING ("public"."is_live_user"());



CREATE POLICY "task_dependencies_insert" ON "public"."task_dependencies" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_live_user"());



CREATE POLICY "task_dependencies_select" ON "public"."task_dependencies" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



ALTER TABLE "public"."task_skills" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_skills_delete" ON "public"."task_skills" FOR DELETE TO "authenticated" USING ("public"."is_live_user"());



CREATE POLICY "task_skills_insert" ON "public"."task_skills" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_live_user"());



CREATE POLICY "task_skills_select" ON "public"."task_skills" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



ALTER TABLE "public"."task_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_tags_delete" ON "public"."task_tags" FOR DELETE TO "authenticated" USING ("public"."is_live_user"());



CREATE POLICY "task_tags_insert" ON "public"."task_tags" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_live_user"());



CREATE POLICY "task_tags_select" ON "public"."task_tags" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



ALTER TABLE "public"."task_teams" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_teams_delete" ON "public"."task_teams" FOR DELETE TO "authenticated" USING ("public"."is_live_user"());



CREATE POLICY "task_teams_insert" ON "public"."task_teams" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_live_user"());



CREATE POLICY "task_teams_select" ON "public"."task_teams" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tasks_delete" ON "public"."tasks" FOR DELETE TO "authenticated" USING (("public"."is_org_admin"() OR ("requester_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."task_teams" "tt"
  WHERE (("tt"."task_id" = "tasks"."id") AND "public"."leads_team"("tt"."team_id"))))));



CREATE POLICY "tasks_insert" ON "public"."tasks" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_live_user"());



CREATE POLICY "tasks_select" ON "public"."tasks" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



CREATE POLICY "tasks_update" ON "public"."tasks" FOR UPDATE TO "authenticated" USING ("public"."is_live_user"()) WITH CHECK ("public"."is_live_user"());



ALTER TABLE "public"."team_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "team_members_delete" ON "public"."team_members" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."can_manage_team"("team_id")));



CREATE POLICY "team_members_insert" ON "public"."team_members" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."can_manage_team"("team_id")));



CREATE POLICY "team_members_select" ON "public"."team_members" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



ALTER TABLE "public"."team_skills" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "team_skills_delete" ON "public"."team_skills" FOR DELETE TO "authenticated" USING ("public"."can_manage_team"("team_id"));



CREATE POLICY "team_skills_insert" ON "public"."team_skills" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_manage_team"("team_id"));



CREATE POLICY "team_skills_select" ON "public"."team_skills" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "teams_delete" ON "public"."teams" FOR DELETE TO "authenticated" USING ("public"."is_org_admin"());



CREATE POLICY "teams_insert" ON "public"."teams" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_org_admin"());



CREATE POLICY "teams_select" ON "public"."teams" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



CREATE POLICY "teams_update" ON "public"."teams" FOR UPDATE TO "authenticated" USING ("public"."can_manage_team"("id")) WITH CHECK ("public"."can_manage_team"("id"));



ALTER TABLE "public"."user_clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_clients_delete" ON "public"."user_clients" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_org_admin"()));



CREATE POLICY "user_clients_insert" ON "public"."user_clients" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_org_admin"()));



CREATE POLICY "user_clients_select" ON "public"."user_clients" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



ALTER TABLE "public"."user_regions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_regions_delete" ON "public"."user_regions" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_org_admin"()));



CREATE POLICY "user_regions_insert" ON "public"."user_regions" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_org_admin"()));



CREATE POLICY "user_regions_select" ON "public"."user_regions" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



ALTER TABLE "public"."user_skills" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_skills_delete" ON "public"."user_skills" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_org_admin"()));



CREATE POLICY "user_skills_insert" ON "public"."user_skills" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_org_admin"()));



CREATE POLICY "user_skills_select" ON "public"."user_skills" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_insert_self" ON "public"."users" FOR INSERT TO "authenticated" WITH CHECK (((("id" = "auth"."uid"()) AND ("role" = ANY (ARRAY['invitee'::"text", 'requester'::"text"])) AND "is_active" AND ("deleted_at" IS NULL)) OR "public"."is_org_admin"()));



CREATE POLICY "users_select" ON "public"."users" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR "public"."is_live_user"()));



CREATE POLICY "users_update_admin" ON "public"."users" FOR UPDATE TO "authenticated" USING ("public"."is_org_admin"()) WITH CHECK ("public"."is_org_admin"());



CREATE POLICY "users_update_self" ON "public"."users" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



ALTER TABLE "public"."work_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "work_categories_delete" ON "public"."work_categories" FOR DELETE TO "authenticated" USING ("public"."is_org_admin"());



CREATE POLICY "work_categories_insert" ON "public"."work_categories" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_org_admin"());



CREATE POLICY "work_categories_select" ON "public"."work_categories" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



CREATE POLICY "work_categories_update" ON "public"."work_categories" FOR UPDATE TO "authenticated" USING ("public"."is_org_admin"()) WITH CHECK ("public"."is_org_admin"());



ALTER TABLE "public"."work_category_skills" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "work_category_skills_delete" ON "public"."work_category_skills" FOR DELETE TO "authenticated" USING ("public"."is_org_admin"());



CREATE POLICY "work_category_skills_insert" ON "public"."work_category_skills" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_org_admin"());



CREATE POLICY "work_category_skills_select" ON "public"."work_category_skills" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



CREATE POLICY "work_category_skills_update" ON "public"."work_category_skills" FOR UPDATE TO "authenticated" USING ("public"."is_org_admin"()) WITH CHECK ("public"."is_org_admin"());



ALTER TABLE "public"."work_category_teams" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "work_category_teams_delete" ON "public"."work_category_teams" FOR DELETE TO "authenticated" USING ("public"."is_org_admin"());



CREATE POLICY "work_category_teams_insert" ON "public"."work_category_teams" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_org_admin"());



CREATE POLICY "work_category_teams_select" ON "public"."work_category_teams" FOR SELECT TO "authenticated" USING ("public"."is_live_user"());



CREATE POLICY "work_category_teams_update" ON "public"."work_category_teams" FOR UPDATE TO "authenticated" USING ("public"."is_org_admin"()) WITH CHECK ("public"."is_org_admin"());





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."assignments";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."comments";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."notifications";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."tasks";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."teams";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."users";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

































































































































































































































































































































































































































































































































REVOKE ALL ON FUNCTION "public"."accept_assignment"("p_assignment_id" "uuid", "p_deadline" "date", "p_estimated_hours" numeric, "p_start_date" "date", "p_end_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_assignment"("p_assignment_id" "uuid", "p_deadline" "date", "p_estimated_hours" numeric, "p_start_date" "date", "p_end_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_assignment"("p_assignment_id" "uuid", "p_deadline" "date", "p_estimated_hours" numeric, "p_start_date" "date", "p_end_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."access_request_audience"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."access_request_audience"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_client_department"("p_client_id" "uuid", "p_department" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_client_department"("p_client_id" "uuid", "p_department" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_client_department"("p_client_id" "uuid", "p_department" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."aggregate_daily_kpis"("p_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."aggregate_daily_kpis"("p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."aggregate_daily_kpis"("p_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."assign_task"("p_task_id" "uuid", "p_user_id" "uuid", "p_auto_accept" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assign_task"("p_task_id" "uuid", "p_user_id" "uuid", "p_auto_accept" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_task"("p_task_id" "uuid", "p_user_id" "uuid", "p_auto_accept" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."backfill_daily_kpis"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."backfill_daily_kpis"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."backfill_daily_kpis"("p_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_assign_work"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_assign_work"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_assign_work"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_manage_team"("p_team_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_manage_team"("p_team_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_team"("p_team_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."capture_public_dashboard_labels"("p_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."capture_public_dashboard_labels"("p_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_onboarding_step_one"("p_name" "text", "p_team_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_onboarding_step_one"("p_name" "text", "p_team_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_onboarding_step_one"("p_name" "text", "p_team_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."consume_onboarding_temp_password"("p_email" "text", "p_temp_password" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_onboarding_temp_password"("p_email" "text", "p_temp_password" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_has_password"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_has_password"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_has_password"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_is_form_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_is_form_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_is_form_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_sees_access_requests"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_sees_access_requests"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_sees_access_requests"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."default_onboarding_team"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."default_onboarding_team"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."default_onboarding_team"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_user_account"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_user_account"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_user_account"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."demote_and_sign_out_teamless_member"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."demote_and_sign_out_teamless_member"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."demote_and_sign_out_teamless_member"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_assignment_status_transition"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_assignment_status_transition"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_super_admin_home_team"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_super_admin_home_team"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_super_admin_home_team"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_mfa_recovery_codes"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_mfa_recovery_codes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_mfa_recovery_codes"() TO "service_role";



GRANT ALL ON TABLE "public"."dashboard_links" TO "service_role";
GRANT SELECT ON TABLE "public"."dashboard_links" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_or_create_dashboard_link"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_or_create_dashboard_link"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_or_create_dashboard_link"() TO "service_role";



GRANT ALL ON TABLE "public"."request_form_links" TO "service_role";
GRANT SELECT ON TABLE "public"."request_form_links" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_or_create_request_form_link"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_or_create_request_form_link"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_or_create_request_form_link"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_public_dashboard"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_dashboard"("p_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_public_dashboard_cached"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_dashboard_cached"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_dashboard_cached"("p_token" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_public_dashboard_cached"("p_token" "text") TO "anon";



REVOKE ALL ON FUNCTION "public"."get_public_request_form"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_request_form"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_request_form"("p_token" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_public_request_form"("p_token" "text") TO "anon";



REVOKE ALL ON FUNCTION "public"."get_request_form_config"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_request_form_config"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_request_form_config"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_live_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_live_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_live_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_org_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_org_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_team_manager"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_team_manager"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_team_manager"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."issue_onboarding_temp_password"("p_user_id" "uuid", "p_temp_password" "text", "p_generated_by" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."issue_onboarding_temp_password"("p_user_id" "uuid", "p_temp_password" "text", "p_generated_by" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."leads_team"("p_team_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."leads_team"("p_team_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."leads_team"("p_team_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_my_sessions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_my_sessions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_my_sessions"() TO "service_role";






REVOKE ALL ON FUNCTION "public"."mfa_recovery_code_hash"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mfa_recovery_code_hash"("p_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_mfa_recovery_code_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_mfa_recovery_code_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_mfa_recovery_code_status"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_on_assignment"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_on_assignment"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_reassignment_needed"("p_user_id" "uuid", "p_team_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_reassignment_needed"("p_user_id" "uuid", "p_team_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."onboarding_account_state"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."onboarding_account_state"("p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."onboarding_email_status"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."onboarding_email_status"("p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_super_admin_home_team_removal"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_super_admin_home_team_removal"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_super_admin_home_team_removal"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."promote_requester_on_team_join"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."promote_requester_on_team_join"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."promote_requester_on_team_join"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."redeem_mfa_recovery_code"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."redeem_mfa_recovery_code"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."redeem_mfa_recovery_code"("p_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_daily_kpi_snapshot"("p_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_daily_kpi_snapshot"("p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_daily_kpi_snapshot"("p_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reject_assignment"("p_assignment_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reject_assignment"("p_assignment_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_assignment"("p_assignment_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."remove_team_member"("p_team_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_team_member"("p_team_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_team_member"("p_team_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_access"("p_name" "text", "p_email" "text", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_access"("p_name" "text", "p_email" "text", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_access"("p_name" "text", "p_email" "text", "p_note" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."request_access"("p_name" "text", "p_email" "text", "p_note" "text") TO "anon";



GRANT ALL ON TABLE "public"."request_form_fields" TO "service_role";
GRANT SELECT ON TABLE "public"."request_form_fields" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."request_form_field_json"("f" "public"."request_form_fields") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_form_field_json"("f" "public"."request_form_fields") TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_form_field_json"("f" "public"."request_form_fields") TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_reactivation"("p_email" "text", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_reactivation"("p_email" "text", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_reactivation"("p_email" "text", "p_note" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."request_reactivation"("p_email" "text", "p_note" "text") TO "anon";



GRANT ALL ON TABLE "public"."access_requests" TO "service_role";
GRANT SELECT ON TABLE "public"."access_requests" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."resolve_access_request"("p_id" "uuid", "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_access_request"("p_id" "uuid", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_access_request"("p_id" "uuid", "p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."revoke_my_session"("p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_my_session"("p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."revoke_my_session"("p_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."revoke_my_sessions"("p_keep_current" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_my_sessions"("p_keep_current" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."revoke_my_sessions"("p_keep_current" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_request_form_config"("p_fields" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_request_form_config"("p_fields" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_request_form_config"("p_fields" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_user_active"("p_user_id" "uuid", "p_active" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_user_active"("p_user_id" "uuid", "p_active" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_user_active"("p_user_id" "uuid", "p_active" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_user_role"("p_user_id" "uuid", "p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_user_role"("p_user_id" "uuid", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_user_role"("p_user_id" "uuid", "p_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_public_request"("p_token" "text", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_public_request"("p_token" "text", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_public_request"("p_token" "text", "p_payload" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."submit_public_request"("p_token" "text", "p_payload" "jsonb") TO "anon";



REVOKE ALL ON FUNCTION "public"."task_stage"("p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."task_stage"("p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."task_stage"("p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."transfer_super_admin_ownership"("new_super_admin_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transfer_super_admin_ownership"("new_super_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."transfer_super_admin_ownership"("new_super_admin_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_dashboard_link"("p_public_access" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_dashboard_link"("p_public_access" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_dashboard_link"("p_public_access" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_request_form_link"("p_public_access" boolean, "p_send_confirmation" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_request_form_link"("p_public_access" boolean, "p_send_confirmation" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_request_form_link"("p_public_access" boolean, "p_send_confirmation" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_current_password"("p_password" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_current_password"("p_password" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_current_password"("p_password" "text") TO "service_role";




































GRANT ALL ON TABLE "public"."assignments" TO "service_role";
GRANT SELECT ON TABLE "public"."assignments" TO "authenticated";



GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";
GRANT SELECT ON TABLE "public"."audit_logs" TO "authenticated";



GRANT ALL ON TABLE "public"."clients" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."clients" TO "authenticated";



GRANT ALL ON TABLE "public"."comments" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."comments" TO "authenticated";



GRANT ALL ON TABLE "public"."daily_kpi_snapshots" TO "service_role";
GRANT SELECT ON TABLE "public"."daily_kpi_snapshots" TO "authenticated";



GRANT ALL ON TABLE "public"."leaves" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."leaves" TO "authenticated";



GRANT ALL ON TABLE "public"."mfa_recovery_attempts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."mfa_recovery_attempts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."mfa_recovery_attempts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."mfa_recovery_codes" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "service_role";
GRANT SELECT,UPDATE ON TABLE "public"."notifications" TO "authenticated";



GRANT ALL ON TABLE "public"."onboarding_temp_password_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."onboarding_temp_password_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."onboarding_temp_passwords" TO "service_role";



GRANT ALL ON TABLE "public"."regions" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."regions" TO "authenticated";



GRANT ALL ON TABLE "public"."request_form_submissions" TO "service_role";
GRANT SELECT ON TABLE "public"."request_form_submissions" TO "authenticated";



GRANT ALL ON TABLE "public"."skills" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."skills" TO "authenticated";



GRANT ALL ON TABLE "public"."tags" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."tags" TO "authenticated";



GRANT ALL ON TABLE "public"."task_activity" TO "service_role";
GRANT SELECT ON TABLE "public"."task_activity" TO "authenticated";



GRANT ALL ON TABLE "public"."task_dependencies" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."task_dependencies" TO "authenticated";



GRANT ALL ON TABLE "public"."task_skills" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."task_skills" TO "authenticated";



GRANT ALL ON TABLE "public"."task_tags" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."task_tags" TO "authenticated";



GRANT ALL ON TABLE "public"."task_teams" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."task_teams" TO "authenticated";



GRANT ALL ON TABLE "public"."tasks" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."tasks" TO "authenticated";



GRANT ALL ON TABLE "public"."team_members" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."team_members" TO "authenticated";



GRANT ALL ON TABLE "public"."team_skills" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."team_skills" TO "authenticated";



GRANT ALL ON TABLE "public"."teams" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."teams" TO "authenticated";



GRANT ALL ON TABLE "public"."user_clients" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."user_clients" TO "authenticated";



GRANT ALL ON TABLE "public"."user_regions" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."user_regions" TO "authenticated";



GRANT ALL ON TABLE "public"."user_skills" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."user_skills" TO "authenticated";



GRANT ALL ON TABLE "public"."users" TO "service_role";
GRANT SELECT ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("id") ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("name"),UPDATE("name") ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("email") ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("role") ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("daily_capacity"),UPDATE("daily_capacity") ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("avatar"),UPDATE("avatar") ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("is_active") ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("onboarding_completed"),UPDATE("onboarding_completed") ON TABLE "public"."users" TO "authenticated";



GRANT ALL ON TABLE "public"."work_categories" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."work_categories" TO "authenticated";



GRANT ALL ON TABLE "public"."work_category_skills" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."work_category_skills" TO "authenticated";



GRANT ALL ON TABLE "public"."work_category_teams" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."work_category_teams" TO "authenticated";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































