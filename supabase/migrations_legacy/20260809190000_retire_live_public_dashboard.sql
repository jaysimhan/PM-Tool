-- A shared dashboard is a delayed daily report, not a live or historical Data API.
-- Anonymous visitors may receive exactly yesterday's completed snapshot and the labels that
-- were captured with it. They must never receive task rows, today's partial data, an older
-- fallback day, or labels read from the live dimension tables.

-- Retire the legacy function that returned task-level data.
REVOKE ALL ON FUNCTION public.get_public_dashboard(text) FROM PUBLIC, anon, authenticated;

-- Capture the display labels alongside the metrics. Keeping these in daily_kpi_snapshots
-- means a public response is internally consistent: counts and labels both describe the same
-- completed day, even if a team or client is renamed later.
CREATE OR REPLACE FUNCTION public.capture_public_dashboard_labels(p_date date DEFAULT CURRENT_DATE)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

REVOKE ALL ON FUNCTION public.capture_public_dashboard_labels(date)
    FROM PUBLIC, anon, authenticated;

-- One ordered entry point ensures the public labels are recorded only after the day's full
-- KPI aggregation succeeds. pg_cron has no user session and may call this definer function;
-- a signed-in caller must be an organisation admin.
CREATE OR REPLACE FUNCTION public.refresh_daily_kpi_snapshot(p_date date DEFAULT CURRENT_DATE)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

REVOKE ALL ON FUNCTION public.refresh_daily_kpi_snapshot(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_daily_kpi_snapshot(date) TO authenticated;

-- Replace the old cron target with the ordered snapshot wrapper.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-kpi-snapshot') THEN
        PERFORM cron.unschedule('daily-kpi-snapshot');
    END IF;

    PERFORM cron.schedule(
        'daily-kpi-snapshot',
        '59 23 * * *',
        $cron$SELECT public.refresh_daily_kpi_snapshot()$cron$
    );
END
$$;

CREATE OR REPLACE FUNCTION public.get_public_dashboard_cached(p_token text)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER STABLE
    SET search_path TO ''
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

REVOKE ALL ON FUNCTION public.get_public_dashboard_cached(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_dashboard_cached(text) TO anon, authenticated;

-- All previously shared URLs stop working when this migration is applied. An admin obtains
-- the replacement URL from Share Dashboard, which returns the same row with its new token.
UPDATE public.dashboard_links
SET token = replace(gen_random_uuid()::text, '-', ''),
    updated_at = timezone('utc', now());
