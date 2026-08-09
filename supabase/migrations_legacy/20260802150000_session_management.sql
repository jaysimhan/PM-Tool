-- Security Settings can now show you where you are signed in and let you end any of it.
--
-- GoTrue already records all of this in auth.sessions -- user agent, IP, when the session
-- started and when its token was last refreshed -- but auth is not an exposed schema, so
-- the client cannot read a row of it. These three functions are the whole window onto it,
-- and every one of them is scoped to auth.uid(): there is no argument you can pass that
-- shows you, or ends, somebody else's session.
--
-- "Last active" is refreshed_at: the client refreshes its access token about hourly while
-- the tab is alive, so it is the closest thing to a heartbeat that already exists. It falls
-- back to updated_at and then created_at for a session too new to have refreshed yet.

CREATE OR REPLACE FUNCTION public.list_my_sessions()
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER STABLE
    SET search_path TO ''
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

REVOKE ALL ON FUNCTION public.list_my_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_sessions() TO authenticated;

-- Ending one session. Deleting the row cascades to its refresh tokens, so that device is
-- out at its next refresh -- and immediately if it is this one, since the client signs out
-- locally the moment this returns wasCurrent.
CREATE OR REPLACE FUNCTION public.revoke_my_session(p_session_id uuid)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

REVOKE ALL ON FUNCTION public.revoke_my_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_my_session(uuid) TO authenticated;

-- Ending everything. p_keep_current is what separates "sign out my other devices" from
-- "sign out everywhere", and the caller says which -- the UI offers both.
CREATE OR REPLACE FUNCTION public.revoke_my_sessions(p_keep_current boolean DEFAULT false)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

REVOKE ALL ON FUNCTION public.revoke_my_sessions(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_my_sessions(boolean) TO authenticated;
