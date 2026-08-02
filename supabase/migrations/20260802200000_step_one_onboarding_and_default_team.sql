-- Onboarding, restated. Step 1 -- a name and a password of their own -- is the whole of what
-- an account needs to exist. Everything step 2 asks for (team, skills, brands, regions) is a
-- preference, and preferences have a home in the app already, so step 2 is skippable and
-- dropping out of it is not a half-finished state to be dragged back through.
--
-- Three rules follow from that, and all three belong here rather than in the screen:
--
--   1. Finishing step 1 is one transaction: name, onboarding_completed, the promotion out of
--      'requester', and a default team. The old flow spread these across four client calls, so
--      a tab closed mid-way left somebody onboarded-but-a-requester, or on no team at all.
--   2. 'requester' is what you are until step 1 is done, and nobody -- super admin included --
--      can move you out of it early. A role is a statement about a person who has an account;
--      an unclaimed invite is not that person yet.
--   3. A password must actually exist before step 1 counts. The screen asks for one, but the
--      screen is not what the rule rests on.

-- ---------------------------------------------------------------------------------------
-- The default team.
--
-- Everyone who finishes step 1 lands on one, so nobody starts out invisible to workload
-- planning. That team is General Marketing, and teams.is_home_team already points at it -- set
-- there when the flag was introduced, and unique by index -- so this reads the flag rather than
-- matching a name the org is free to change. The name is kept only as a fallback for a database
-- where the flag was never set. An org with neither lands people on no team, which is now a
-- supported state rather than a dead end.
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.default_onboarding_team() RETURNS uuid
    LANGUAGE sql SECURITY DEFINER STABLE
    SET search_path TO ''
    AS $$
    SELECT t.id
    FROM public.teams t
    WHERE t.is_home_team OR lower(t.name) = 'general marketing'
    ORDER BY t.is_home_team DESC, t.created_at NULLS LAST
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.default_onboarding_team() FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------------------
-- Step 1, committed in one go.
--
-- The password itself is set by the client through supabase.auth.updateUser() -- only GoTrue
-- may write auth.users -- so this checks that it landed rather than taking the caller's word
-- for it. p_team_id lets an invite that named a team keep it; anything else falls to the
-- default above.
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

    -- Rule 3. Marking step 1 done without one would hand out a 'team_member' role and a team to
    -- an account nobody can sign into.
    IF NOT v_has_password THEN
        RAISE EXCEPTION 'Set a password before finishing account setup.';
    END IF;

    IF v_name IS NULL THEN
        v_name := split_part(v_email, '@', 1);
    END IF;

    -- The invite trigger normally leaves a row here; this covers the case where it did not,
    -- which is the only reason Onboarding ever needed to insert one itself.
    -- Aliased so the DO UPDATE can name the row that is already there without ambiguity.
    INSERT INTO public.users AS u (id, name, email, role, daily_capacity, is_active, onboarding_completed)
    VALUES (v_uid, v_name, v_email, 'team_member', 8, true, true)
    ON CONFLICT (id) DO UPDATE
    SET name = v_name,
        onboarding_completed = true,
        -- Only the placeholder role is replaced. Somebody who was invited straight into a real
        -- role, or who is coming back, keeps what they have.
        role = CASE WHEN u.role = 'requester' THEN 'team_member' ELSE u.role END;

    SELECT EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.user_id = v_uid)
    INTO v_already_on_a_team;

    IF NOT v_already_on_a_team THEN
        -- An invite that named a team wins: an admin who chose one meant it, and step 2 is where
        -- the person can disagree.
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
-- Rule 2, in the two places a role can move.
-- ---------------------------------------------------------------------------------------

-- An admin cannot promote an unclaimed invite. Same shape and same error style as the checks
-- already in here; this one goes first because it is about whether the target is a person yet,
-- which is prior to what the caller is allowed to do to them.
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

    IF p_role NOT IN ('admin', 'manager', 'team_leader', 'team_member', 'requester') THEN
        RAISE EXCEPTION 'Unknown role: %', p_role;
    END IF;

    SELECT u.role, u.onboarding_completed INTO v_target_role, v_target_onboarded
    FROM public.users u WHERE u.id = p_user_id;
    IF v_target_role IS NULL THEN
        RAISE EXCEPTION 'That person no longer exists.';
    END IF;

    -- An invite nobody has claimed yet stays a requester, whoever is asking.
    IF NOT v_target_onboarded THEN
        RAISE EXCEPTION 'They have not set up their account yet, so they stay a requester until they do.';
    END IF;

    IF v_target_role = 'super_admin' THEN
        RAISE EXCEPTION 'The super admin''s role is changed by transferring ownership.';
    END IF;

    -- Nobody promotes themselves, and an admin cannot quietly demote themselves out of a job
    -- somebody is relying on them for.
    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'You cannot change your own role.';
    END IF;

    -- An admin is not senior enough to appoint another admin, or to unmake one; the super
    -- admin is.
    IF (p_role = 'admin' OR v_target_role = 'admin') AND v_caller_role <> 'super_admin' THEN
        RAISE EXCEPTION 'Only the super admin can make or unmake an admin.';
    END IF;

    UPDATE public.users SET role = p_role WHERE id = p_user_id;

    RETURN jsonb_build_object('ok', true, 'role', p_role);
END;
$$;

-- The other door: an admin dropping an unclaimed invite into a team used to promote them out of
-- 'requester' as a side effect. Joining a team is still the promotion, but only for somebody who
-- has an account -- and step 1 now does its own promotion, so nothing is lost by waiting.
CREATE OR REPLACE FUNCTION public.promote_requester_on_team_join() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
    UPDATE public.users
    SET role = 'team_member'
    WHERE id = NEW.user_id
      AND role = 'requester'
      AND onboarding_completed;
    RETURN NEW;
END;
$$;

-- The third door is the biggest one: ownership. Handing the org to an unclaimed invite would
-- make a super admin nobody can sign in as, and the rule is that a role waits for an account.
CREATE OR REPLACE FUNCTION public.transfer_super_admin_ownership(new_super_admin_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
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

-- And the last: Onboarding's own fallback INSERT, which could name its own role. It no longer
-- inserts at all -- complete_onboarding_step_one does -- so cap what a self-insert may claim.
DROP POLICY IF EXISTS users_insert_self ON public.users;
CREATE POLICY users_insert_self ON public.users
    FOR INSERT TO authenticated
    WITH CHECK (
        (id = auth.uid() AND role = 'requester' AND is_active AND deleted_at IS NULL)
        OR public.is_org_admin()
    );

-- ---------------------------------------------------------------------------------------
-- Anyone the old two-step model stranded: they set a password and picked a team, so step 1 was
-- done by the new definition, but onboarding_completed only went true at the end of step 2.
-- ---------------------------------------------------------------------------------------
UPDATE public.users u
SET onboarding_completed = true
WHERE NOT u.onboarding_completed
  AND EXISTS (
      SELECT 1 FROM auth.users a
      WHERE a.id = u.id AND coalesce(a.encrypted_password, '') <> ''
  );

-- Promoted whether or not they are on a team: under the new model the promotion belongs to step
-- 1, not to joining a team, and leaving them a requester would strand them -- set_user_role now
-- refuses to touch anyone un-onboarded, and they no longer pass through a team picker.
UPDATE public.users u
SET role = 'team_member'
WHERE u.role = 'requester'
  AND u.onboarding_completed;
