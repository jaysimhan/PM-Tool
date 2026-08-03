-- Three states, named honestly, and one shared link that is safe to hand around.
--
-- Until now "somebody who is not a member yet" was a single role, 'requester', and it meant two
-- different things at once: a stranger who filled in Request Access, and a person an admin had
-- already decided to let in. The first must not be able to get in; the second must. One word
-- cannot carry both, so the second one gets its own:
--
--   requester   asked to be let in. Lives in access_requests, has no account, cannot sign in.
--   invitee     an admin approved them. The account exists and is waiting for a password.
--   team_member finished setup. A member.
--
-- Approval is the transition, and it is the existing Invite button on the access-request queue:
-- it mints the auth identity (which is what makes them an invitee) and resolves the request.
--
-- What this buys is the second half: because 'invitee' is a state the database knows about, the
-- setup link no longer has to be a per-person secret. Anyone may open /welcome; what gets them
-- past it is proving they hold an approved address -- a one-time code, emailed to it. So the
-- link is shareable by design, and sharing it grants nothing.
--
-- Sending that code is Supabase's `signInWithOtp` with shouldCreateUser: false, which refuses
-- any address without an account. That refusal is the allow-list: requesters have no account,
-- so they cannot get a code, and no policy here has to restate the rule.

-- ---------------------------------------------------------------------------------------
-- 1. The role itself.
-- ---------------------------------------------------------------------------------------

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('super_admin', 'admin', 'manager', 'team_leader', 'team_member', 'invitee', 'requester'));

-- Everyone currently sitting in the old shared state is, by definition, the approved kind:
-- a public.users row only ever comes from an invite. A stranger who merely asked has an
-- access_requests row and nothing else.
UPDATE public.users
SET role = 'invitee'
WHERE role = 'requester'
  AND NOT onboarding_completed
  AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------------------
-- 2. A new auth identity is an invitee, not a requester.
--
-- This trigger only ever fires because an admin invited somebody -- signups are disabled on the
-- project -- so 'requester' was never the right word for what it creates.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

-- ---------------------------------------------------------------------------------------
-- 3. Finishing step 1 promotes an invitee, and closes the request that led to them.
--
-- Same transaction as before -- name, onboarding_completed, promotion, default team -- with two
-- changes: 'invitee' is now the placeholder role being replaced, and any access request from
-- this address stops being pending, because the thing it was asking for has happened. Leaving
-- it open would keep the person in the admin queue forever with nothing left to do to them.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_onboarding_step_one(p_name text, p_team_id uuid DEFAULT NULL)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

REVOKE ALL ON FUNCTION public.complete_onboarding_step_one(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_onboarding_step_one(text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------------------
-- 4. The other places the placeholder role is read.
-- ---------------------------------------------------------------------------------------

-- Joining a team promotes somebody who has an account but no real role yet. Still gated on
-- onboarding_completed: an unclaimed invite dropped into a team is not a member.
CREATE OR REPLACE FUNCTION public.promote_requester_on_team_join() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

-- A self-insert may still only claim a placeholder role. 'invitee' joins the list for the same
-- reason 'requester' was on it: it is the role that grants nothing.
DROP POLICY IF EXISTS users_insert_self ON public.users;
CREATE POLICY users_insert_self ON public.users
    FOR INSERT TO authenticated
    WITH CHECK (
        (id = auth.uid() AND role IN ('invitee', 'requester') AND is_active AND deleted_at IS NULL)
        OR public.is_org_admin()
    );

-- An admin hands out real roles. Neither placeholder is one of them -- they are states a person
-- passes through, not jobs -- and set_user_role already refuses to touch anyone un-onboarded.
CREATE OR REPLACE FUNCTION public.set_user_role(p_user_id uuid, p_role text)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

-- ---------------------------------------------------------------------------------------
-- 5. Who hears about an access request.
--
-- The fan-out was super_admin and admin only, which on an org with one admin means one person
-- gets told and the queue waits on them being logged in. Managers and team leaders now hear it
-- too. Acting on a request is still an admin's job -- resolve_access_request has not moved --
-- but a notification that nobody sees is not a notification, and someone has to be able to go
-- and nudge them.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.access_request_audience() RETURNS TABLE (id uuid)
    LANGUAGE sql SECURITY DEFINER STABLE
    SET search_path TO ''
    AS $$
    SELECT u.id
    FROM public.users u
    WHERE u.role IN ('super_admin', 'admin', 'manager', 'team_leader')
      AND u.is_active
      AND u.deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.access_request_audience() FROM PUBLIC, anon, authenticated;

-- The one that was actually losing requests.
--
-- This used to return a bare ok, and record nothing at all, for any address that already had a
-- users row. The intent was sound -- the form is public, so "no such account" and "that one is
-- fine" would turn it into a way to find out who works here -- but the implementation threw the
-- request away, and it threw away exactly the cases that matter most: an invitee whose setup
-- link died, a deactivated account, anybody who cannot get in and does not know why. They were
-- told "your request is with the admins" and it was with nobody.
--
-- Anonymity did not require the silence. Everything is recorded and the admins are told; the
-- reply is byte-for-byte the same whoever asks, which is where the property actually lives. What
-- the admins see additionally says which of those cases it is, because that is what decides what
-- they do about it.
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
$$;

GRANT EXECUTE ON FUNCTION public.request_access(text, text, text) TO anon, authenticated;

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
$$;

GRANT EXECUTE ON FUNCTION public.request_reactivation(text, text) TO anon, authenticated;

-- A notification that links to a page where the thing it is about is invisible is a dead end,
-- so everyone who is told can also look. Only the reading is widened: resolve_access_request
-- and the invite itself still refuse anyone who is not an admin.
CREATE OR REPLACE FUNCTION public.current_user_sees_access_requests() RETURNS boolean
    LANGUAGE sql SECURITY DEFINER STABLE
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

REVOKE ALL ON FUNCTION public.current_user_sees_access_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_sees_access_requests() TO authenticated;

DROP POLICY IF EXISTS "Admins can read access requests" ON public.access_requests;
DROP POLICY IF EXISTS access_requests_select ON public.access_requests;
CREATE POLICY access_requests_select
    ON public.access_requests FOR SELECT TO authenticated
    USING (public.current_user_sees_access_requests());
