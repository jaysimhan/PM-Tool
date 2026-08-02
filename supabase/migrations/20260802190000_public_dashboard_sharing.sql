-- "Share Dashboard" copies a link to /public/dashboard, and that page has shown nothing but
-- zeros since the Data API was closed to the anon key. It was reading through DataContext,
-- which needs a session; a signed-out visitor got empty arrays, so every counter said 0 and
-- Team Capacity Overview had no teams to draw.
--
-- Opening the tables back up to anon is not the fix -- that is exactly what
-- 20260802170000_lock_down_data_api undid. This follows the shape already used for the
-- request form instead: a token is the credential, the token lives in a table anon cannot
-- read, and one SECURITY DEFINER function decides what a visitor without an account is
-- allowed to know.
--
-- What that function returns is deliberately narrow. Volumes, statuses, dates and the names
-- of teams, brands, regions and tags -- the things the dashboard actually plots. No task
-- titles, no descriptions, no names, no email addresses, and no way to tell who a task is
-- assigned to: assignment is reduced to a boolean before it leaves the database, because
-- "unassigned count" is the only thing the page does with it.

-- One link per organisation, same scope trick as request_form_links: the unique constraint
-- is what makes get_or_create idempotent without a second table.
CREATE TABLE IF NOT EXISTS public.dashboard_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope text NOT NULL DEFAULT 'org' UNIQUE,
    token text NOT NULL UNIQUE,
    public_access boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.dashboard_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.dashboard_links FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.dashboard_links FROM authenticated;
GRANT SELECT ON TABLE public.dashboard_links TO authenticated;

DROP POLICY IF EXISTS dashboard_links_select ON public.dashboard_links;
CREATE POLICY dashboard_links_select
    ON public.dashboard_links FOR SELECT TO authenticated USING (public.is_live_user());

-- 32 hex characters of gen_random_uuid entropy. The link is meant to be pasted somewhere a
-- signed-out person can open it, so the token is a bearer credential and nothing else
-- authenticates the visitor; guessing it has to be infeasible.
CREATE OR REPLACE FUNCTION public.get_or_create_dashboard_link()
    RETURNS public.dashboard_links
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

REVOKE ALL ON FUNCTION public.get_or_create_dashboard_link() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_dashboard_link() TO authenticated;

-- Turning the link off is how a shared dashboard gets taken down without minting a new
-- token for everyone who still has the old one bookmarked.
CREATE OR REPLACE FUNCTION public.update_dashboard_link(p_public_access boolean)
    RETURNS public.dashboard_links
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

REVOKE ALL ON FUNCTION public.update_dashboard_link(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_dashboard_link(boolean) TO authenticated;

/**
 * Everything /public/dashboard/<token> is allowed to know.
 *
 * Rows rather than pre-computed totals, so the page keeps its own time-range filter and its
 * four distribution charts without a round trip per option -- but stripped to the columns
 * those charts read. The identity columns (title, description, requester, assignee) never
 * appear in the result at all, rather than being filtered out client-side where a curious
 * visitor could read them back out of the network tab.
 *
 * An admin still gets the data back when the link is switched off, which is what lets the
 * dashboard preview its own public view; the reply says which case it is so the page can
 * say so out loud instead of looking live.
 */
CREATE OR REPLACE FUNCTION public.get_public_dashboard(p_token text)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER STABLE
    SET search_path TO ''
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

REVOKE ALL ON FUNCTION public.get_public_dashboard(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_dashboard(text) TO anon, authenticated;
