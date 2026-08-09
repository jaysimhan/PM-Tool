-- Three things that were described but not built:
--
-- 1. "Request access" on the login screen was a mailto: to admin@example.com -- an address
--    that does not exist. It now records a real request and notifies every admin and super
--    admin. Nobody is created by it: the person becomes a user, with the 'requester' role
--    handle_new_user() gives every new identity, only once an admin invites them.
--
-- 2. Losing your last team makes you a requester. The join direction of this already existed
--    (promote_requester_on_team_join); the leave direction was deliberately left out, and is
--    now here. super_admin and admin are exempt -- demoting the people who administer teams
--    for not being on one is how an organisation locks itself out of its own app.
--
-- 3. Being taken off a team ends every session that person has open, everywhere. Client-side
--    routing already sent them to the team picker, but only in the tab that noticed; their
--    other devices carried on with a valid token. Revoking in auth.sessions is what actually
--    ends them, and users.sessions_revoked_at lets the app act on it before the access token
--    would have expired on its own.

-- ---------------------------------------------------------------------------
-- Access requests
-- ---------------------------------------------------------------------------

-- Two kinds of "let me in" land in one table and one queue, because they are the same job
-- for an admin: somebody outside the app is asking to be let in, and the admin either acts
-- on it or dismisses it. 'reactivation' additionally names the account it is about.
CREATE TABLE IF NOT EXISTS public.access_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL DEFAULT 'access',
    user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
    name text NOT NULL,
    email text NOT NULL,
    note text,
    status text NOT NULL DEFAULT 'pending',
    resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT access_requests_kind_check CHECK (kind IN ('access', 'reactivation')),
    CONSTRAINT access_requests_status_check CHECK (status IN ('pending', 'invited', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS access_requests_pending_idx
    ON public.access_requests (created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS access_requests_email_created_idx
    ON public.access_requests (lower(email), created_at DESC);

-- The login screen is public, so anon reaches this only through request_access() below.
ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.access_requests FROM anon, authenticated;
GRANT SELECT ON TABLE public.access_requests TO authenticated;

DROP POLICY IF EXISTS "Admins can read access requests" ON public.access_requests;
CREATE POLICY "Admins can read access requests"
    ON public.access_requests FOR SELECT TO authenticated
    USING (public.current_user_is_form_admin());

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
-- The table shipped with the schema but nothing has ever written to it, and it inherited the
-- schema-wide default of ALL-to-anon. Before anything real lands in it, close that: a
-- notification is addressed to one person and only that person should see or clear it.

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notifications FROM anon;
REVOKE ALL ON TABLE public.notifications FROM authenticated;
GRANT SELECT, UPDATE ON TABLE public.notifications TO authenticated;

DROP POLICY IF EXISTS "Users read their own notifications" ON public.notifications;
CREATE POLICY "Users read their own notifications"
    ON public.notifications FOR SELECT TO authenticated
    USING (user_id = auth.uid());

-- Only is_read is ever changed from the client; WITH CHECK keeps a row from being
-- reassigned to somebody else on the way through.
DROP POLICY IF EXISTS "Users mark their own notifications read" ON public.notifications;
CREATE POLICY "Users mark their own notifications read"
    ON public.notifications FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- request_access: the only thing an anonymous visitor can write here
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_access(p_name text, p_email text, p_note text DEFAULT NULL)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    v_name text;
    v_email text;
    v_note text;
    v_request_id uuid;
    v_admin_count integer;
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

    -- Unauthenticated and public, so the same limits the public request form uses apply.
    IF (SELECT count(*) FROM public.access_requests r
        WHERE lower(r.email) = v_email AND r.created_at > now() - interval '24 hours') >= 3 THEN
        RAISE EXCEPTION 'You have already requested access recently. An admin will be in touch.';
    END IF;
    IF (SELECT count(*) FROM public.access_requests r
        WHERE r.created_at > now() - interval '1 hour') >= 50 THEN
        RAISE EXCEPTION 'Too many access requests right now. Please try again later.';
    END IF;

    -- Someone who already has an account gets the same answer either way: nothing is
    -- recorded, and the reply does not confirm whether the address is registered.
    IF EXISTS (SELECT 1 FROM public.users u WHERE lower(u.email) = v_email) THEN
        RETURN jsonb_build_object('ok', true);
    END IF;

    INSERT INTO public.access_requests (name, email, note)
    VALUES (v_name, v_email, v_note)
    RETURNING id INTO v_request_id;

    INSERT INTO public.notifications (user_id, type, title, message, link)
    SELECT
        u.id,
        'access_request',
        'Access requested',
        v_name || ' (' || v_email || ') asked for access to WorkFlow Pro.',
        '/team-management'
    FROM public.users u
    WHERE u.role IN ('super_admin', 'admin') AND u.is_active;

    GET DIAGNOSTICS v_admin_count = ROW_COUNT;

    RETURN jsonb_build_object('ok', true, 'notified', v_admin_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_access(text, text, text) TO anon, authenticated;

-- Admins close a request out once they have invited or turned down the person.
CREATE OR REPLACE FUNCTION public.resolve_access_request(p_id uuid, p_status text)
    RETURNS public.access_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

REVOKE ALL ON FUNCTION public.resolve_access_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_access_request(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Leaving your last team: back to requester, and signed out everywhere
-- ---------------------------------------------------------------------------

-- Stamped when sessions are revoked. The app compares it against the issue time of the
-- token in hand, so an open tab can be shown the door immediately instead of waiting up to
-- an hour for its access token to expire -- and a later sign-in, whose token is newer than
-- the stamp, is left alone rather than bounced in a loop.
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS sessions_revoked_at timestamptz;

-- A deleted account is a tombstone, not a missing row: their comments and the tasks they
-- worked on have to survive them, greyed out rather than orphaned or gone. deleted_email
-- holds the address they used, which is moved out of the unique `email` column so the same
-- person can be invited back later without colliding with their own tombstone.
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
    ADD COLUMN IF NOT EXISTS deleted_email text;

CREATE OR REPLACE FUNCTION public.demote_and_sign_out_teamless_member() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

DROP TRIGGER IF EXISTS on_team_member_removed_demote_requester ON public.team_members;
CREATE TRIGGER on_team_member_removed_demote_requester
    AFTER DELETE ON public.team_members
    FOR EACH ROW
    EXECUTE FUNCTION public.demote_and_sign_out_teamless_member();

-- Everyone the missing demotion already stranded: on no team, not an admin, not a requester.
UPDATE public.users u
SET role = 'requester'
WHERE u.role NOT IN ('super_admin', 'admin', 'requester')
  AND NOT EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.user_id = u.id);

-- ---------------------------------------------------------------------------
-- Somebody stops working: their open tasks need a new owner
-- ---------------------------------------------------------------------------

-- Whoever can actually do something about it: every admin and super admin, plus the team
-- leaders of the team the person was on. The team has to be read before their membership is
-- removed, so it is passed in rather than looked up here.
CREATE OR REPLACE FUNCTION public.notify_reassignment_needed(
    p_user_id uuid,
    p_team_id uuid,
    p_reason text
) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

REVOKE ALL ON FUNCTION public.notify_reassignment_needed(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who may do what to a member
-- ---------------------------------------------------------------------------
-- Removing, deactivating and deleting were all plain client-side writes against tables the
-- anon key can already reach, so the buttons were the only thing standing between a user and
-- any of it. The rules now live here:
--   team leader  -> remove people from their own team
--   admin        -> that, plus deactivate
--   super admin  -> that, plus delete the account outright
--
-- Deletion is further limited to accounts with no comments and no tasks. Anyone who has
-- actually worked here gets deactivated instead, so their name stays on what they did.

CREATE OR REPLACE FUNCTION public.remove_team_member(p_team_id uuid, p_user_id uuid)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

REVOKE ALL ON FUNCTION public.remove_team_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_team_member(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_user_active(p_user_id uuid, p_active boolean)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

REVOKE ALL ON FUNCTION public.set_user_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_active(uuid, boolean) TO authenticated;

-- public.users.id referenced auth.users ON DELETE CASCADE, so deleting the login deleted the
-- profile -- and with it, by cascade, every comment they ever wrote, while their tasks lost
-- their assignee. That is the opposite of what deleting an account should do here. The
-- profile row now outlives the auth identity and becomes the tombstone the app greys out.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_id_fkey;

CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id uuid)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

REVOKE ALL ON FUNCTION public.delete_user_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_account(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Asking to be let back in
-- ---------------------------------------------------------------------------
-- A deactivated account can still authenticate -- Supabase knows nothing about is_active --
-- and is turned away by the app, which is where it offers this. A deleted account cannot
-- authenticate at all, so the login screen offers it instead, without ever being told
-- whether the address exists.
--
-- Hence the flat 'ok': this is callable by anyone with the login page open, so answering
-- honestly ("no such account", "that one is fine") would turn it into a way to test which
-- addresses belong to the organisation. Nothing is recorded unless the address really does
-- belong to an account that is deactivated or deleted.
CREATE OR REPLACE FUNCTION public.request_reactivation(p_email text, p_note text DEFAULT NULL)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

    -- deleted_email as well as email: deletion moves the address aside, and that is exactly
    -- the address the person will type.
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
        u.id,
        'reactivation_request',
        'Reactivation requested',
        v_user.name || ' (' || v_email || ') asked for their '
            || CASE WHEN v_user.deleted_at IS NOT NULL THEN 'deleted' ELSE 'deactivated' END
            || ' account to be reactivated.',
        '/team-management'
    FROM public.users u
    WHERE u.role IN ('super_admin', 'admin') AND u.is_active AND u.deleted_at IS NULL;

    RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_reactivation(text, text) TO anon, authenticated;

-- There is deliberately no "undelete". Somebody who is deleted and later comes back comes
-- back as a new person: a fresh invite mints a new auth identity and a new profile, with the
-- 'requester' role and onboarding from the top. That is why deletion moves the email off the
-- unique column rather than keeping it -- the tombstone must not stand in the way of the new
-- account. A reactivation request from a deleted address therefore reaches the admins as a
-- request to invite them again, not to restore anything.
