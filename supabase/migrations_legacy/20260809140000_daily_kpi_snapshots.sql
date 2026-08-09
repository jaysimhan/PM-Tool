-- The dashboard stops counting the whole table on every render.
--
-- OrganizationDashboard reads every task the session loaded and recomputes eight headline
-- numbers, a status breakdown, and a six-bucket breakdown for each brand, region, tag and
-- team -- inline, on every render, for every viewer. The public dashboard is worse: it is the
-- same component behind an RPC that aggregates the entire tasks table live, for every
-- anonymous visitor who opens the link, with no session and no rate limit in front of it.
--
-- So the counting moves here and happens once a day. A snapshot is a row per metric per day;
-- the dashboard reads the day it wants and renders. What the dashboard loses is up-to-the-
-- minute numbers, which is the trade being made deliberately -- an org-wide total that is a
-- day old is a reporting figure, not an operational one. What is genuinely operational (work
-- that is late, blocked, or sitting unaccepted) is the admin attention block, and that stays
-- live because it is small and specific.
--
-- The breakdowns are stored per dimension member with all six stages, not as flat counts.
-- DistributionChart draws a stacked bar per brand/region/tag/team and needs every stage to do
-- it; a single number per member would quietly turn four charts into bar stubs.

-- ---------------------------------------------------------------------------------------
-- 1. The snapshots.
-- ---------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.daily_kpi_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_date date NOT NULL,
    metric_name text NOT NULL,
    metric_value numeric NOT NULL DEFAULT 0,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (snapshot_date, metric_name)
);

ALTER TABLE public.daily_kpi_snapshots ENABLE ROW LEVEL SECURITY;

-- Read by every member; written only by the aggregation below, which is a definer function.
-- No INSERT grant, so a snapshot cannot be forged from a browser -- these are the numbers the
-- organisation reports on, and a figure anyone can overwrite is not a report.
REVOKE ALL ON TABLE public.daily_kpi_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.daily_kpi_snapshots TO authenticated;

DROP POLICY IF EXISTS daily_kpi_snapshots_select ON public.daily_kpi_snapshots;
CREATE POLICY daily_kpi_snapshots_select ON public.daily_kpi_snapshots
    FOR SELECT TO authenticated
    USING (public.is_live_user());

-- Every read is "one date" or "this range of dates, one metric".
CREATE INDEX IF NOT EXISTS daily_kpi_snapshots_date_idx
    ON public.daily_kpi_snapshots (snapshot_date DESC);
CREATE INDEX IF NOT EXISTS daily_kpi_snapshots_metric_date_idx
    ON public.daily_kpi_snapshots (metric_name, snapshot_date DESC);

-- ---------------------------------------------------------------------------------------
-- 2. The five stages, in one place.
--
-- These groupings already existed, as a literal in getTaskCounts() in
-- OrganizationDashboard.tsx. They are the axis of four charts, so if this function and that
-- component ever disagree the dashboard silently starts reporting something else. Defined
-- once here; the component now reads the result rather than deriving it.
--
-- 'cancelled' deliberately has its own bucket: it is excluded from Completed (finishing and
-- abandoning are not the same outcome) but still counted in Total, which is what the existing
-- chart does.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.task_stage(p_status text)
    RETURNS text
    LANGUAGE sql IMMUTABLE
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

REVOKE ALL ON FUNCTION public.task_stage(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_stage(text) TO authenticated;

-- ---------------------------------------------------------------------------------------
-- 3. Taking the snapshot.
--
-- Idempotent: it clears the day first, so a re-run repairs a bad night rather than doubling
-- it, and an admin can rebuild today's figures on demand.
--
-- The guard reads oddly on purpose. Under pg_cron there is no session and auth.uid() is null,
-- which is the one case that must be allowed through; anon cannot reach it at all because the
-- EXECUTE grant is withheld. So the rule is "if a person is calling this, they must be an
-- admin", not "the caller must be an admin".
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.aggregate_daily_kpis(p_date date DEFAULT CURRENT_DATE)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

REVOKE ALL ON FUNCTION public.aggregate_daily_kpis(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aggregate_daily_kpis(date) TO authenticated;

-- ---------------------------------------------------------------------------------------
-- 4. Filling in the past, honestly.
--
-- The time-range toggle reads a window of days, and on the first night there is exactly one
-- day to read, so every range shows a single point for a month. Some of the past can be
-- reconstructed and some cannot, and the difference matters: created_at and completed_date
-- are recorded per task, so "how many arrived on the 3rd" and "how many were finished on the
-- 3rd" are facts. Task status is not versioned -- there is no record of what anything was on
-- the 3rd -- so every breakdown, every total and every overdue count for a past day would be
-- an invention.
--
-- So this writes the two that are real and leaves the rest absent. A gap in a chart is
-- honest; a fabricated line is not. Days that already hold a real snapshot are left alone.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.backfill_daily_kpis(p_days integer DEFAULT 30)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

REVOKE ALL ON FUNCTION public.backfill_daily_kpis(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backfill_daily_kpis(integer) TO authenticated;

-- ---------------------------------------------------------------------------------------
-- 5. Every night at 23:59.
--
-- In the database rather than an Edge Function on a timer: there is no HTTP hop to fail, no
-- service-role key to store, and the job is visible in cron.job alongside its own run history.
-- ---------------------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
    -- Re-running the migration must not leave two jobs writing the same rows.
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-kpi-snapshot') THEN
        PERFORM cron.unschedule('daily-kpi-snapshot');
    END IF;

    PERFORM cron.schedule(
        'daily-kpi-snapshot',
        '59 23 * * *',
        $cron$SELECT public.aggregate_daily_kpis()$cron$
    );
END
$$;

-- ---------------------------------------------------------------------------------------
-- 6. The public dashboard, without the live aggregation.
--
-- get_public_dashboard hands a signed-out visitor every task in the organisation -- id,
-- status, dates, hours, brand, region, tags, teams -- and lets the browser do the counting.
-- It is a full table scan and a full table transfer, per visitor, on a URL whose only
-- credential is a token that may have been forwarded to anyone.
--
-- This returns the counts instead. Same token check, same closed-link behaviour, but the
-- payload is a few dozen numbers and the names needed to label them. No task ever leaves the
-- database, so there is nothing to re-identify.
--
-- The old function is left in place rather than dropped: an old tab still holding the page
-- keeps working until it is reloaded.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_public_dashboard_cached(p_token text)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER STABLE
    SET search_path TO ''
    AS $$
DECLARE
    link            public.dashboard_links;
    caller_is_admin boolean;
    v_date          date;
BEGIN
    SELECT * INTO link FROM public.dashboard_links WHERE token = p_token;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;

    caller_is_admin := auth.uid() IS NOT NULL AND public.current_user_is_form_admin();

    IF NOT link.public_access AND NOT caller_is_admin THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'closed');
    END IF;

    -- The newest COMPLETE day. Two things are being avoided here: today, whose snapshot is
    -- not written until 23:59 and would be empty for most of the day; and a backfilled day,
    -- which carries only the two metrics that could be reconstructed and would render as a
    -- dashboard full of blanks. snapshot_complete is written only by the full aggregation.
    SELECT max(snapshot_date) INTO v_date
    FROM public.daily_kpi_snapshots
    WHERE snapshot_date <= CURRENT_DATE - 1
      AND metric_name = 'snapshot_complete';

    IF v_date IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'publicAccess', link.public_access, 'pending', true);
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'publicAccess', link.public_access,
        'pending', false,
        'asOf', v_date,
        'metrics', (
            SELECT COALESCE(jsonb_object_agg(s.metric_name,
                       jsonb_build_object('value', s.metric_value, 'metadata', s.metadata)), '{}'::jsonb)
            FROM public.daily_kpi_snapshots s
            WHERE s.snapshot_date = v_date
        ),
        -- Labels only. Names and colours for the axes, nothing about any person.
        'teams', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color)
                   ORDER BY t.name), '[]'::jsonb) FROM public.teams t
        ),
        'clients', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'favicon', c.favicon)
                   ORDER BY c.name), '[]'::jsonb) FROM public.clients c
        ),
        'regions', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'flag', r.flag)
                   ORDER BY r.name), '[]'::jsonb) FROM public.regions r
        ),
        'tags', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'color', g.color)
                   ORDER BY g.name), '[]'::jsonb) FROM public.tags g
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_dashboard_cached(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_dashboard_cached(text) TO anon, authenticated;
