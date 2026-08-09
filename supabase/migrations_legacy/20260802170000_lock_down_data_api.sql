-- Closing the Data API to the anon key, and giving `authenticated` rules instead of a blank
-- cheque.
--
-- Every careful check in this schema -- only an admin may deactivate an account, only the
-- super admin may delete one, only a team leader may invite into their own team -- lives
-- inside a SECURITY DEFINER function. None of it applies to a request that skips the
-- functions and talks to the table.
--
-- And skipping them was open to anyone. `grant.ts` in the repo root used to run
--
--     GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role
--
-- and the same thing has evidently been run against the live project, because the anon key --
-- which ships inside the JavaScript bundle and is meant to carry no authority at all -- could
-- read public.users (names, addresses, roles), and could UPDATE and DELETE rows in it. No
-- session, no password: the key out of the page source was the whole credential. Deleting
-- every employee, or handing yourself role = 'super_admin', was one curl away. RLS was off on
-- seventeen tables, so there was nothing behind the grant either.
--
-- What this establishes:
--
--   anon            no table access whatsoever. The signed-out screens already go through
--                   SECURITY DEFINER functions (request_access, get_public_request_form,
--                   submit_public_request, request_reactivation), which is why they keep
--                   working with the tables shut. Those four are also the only functions in
--                   the schema anon may still execute.
--   authenticated   RLS on, on every table, with the policies below. Reads stay org-wide,
--                   because that is what this app is for -- workload is meant to be visible.
--                   Writes are held to who the app actually lets do them: org configuration
--                   to admins, a person's own skills and leave to that person, a task's
--                   deletion to the people who own it.
--
-- Three things get their own defence because a policy cannot express them:
--
--   * users.role -- a policy authorises a row, not a column, so "you may edit your own
--     profile" would also mean "you may promote yourself". The UPDATE grant is therefore
--     column-level (name, avatar, daily_capacity, onboarding_completed) and role changes move
--     to set_user_role(), which checks the caller. Self-INSERT during onboarding is capped at
--     the two roles someone can legitimately start with.
--   * clients.department -- the request form appends a department a requester typed, which was
--     the only reason a member ever needed to write to a brand row. add_client_department()
--     does exactly that and nothing else, so brands themselves stay admin-only.
--   * the default privileges -- every future table was set to inherit GRANT ALL to anon, so
--     this would have quietly come undone on the next CREATE TABLE.

-- ---------------------------------------------------------------------------------------
-- 1. Who is asking.
--
-- SECURITY DEFINER because these are called from policies on the very tables they read. An
-- invoker-rights function reading public.users from inside a policy on public.users recurses;
-- the definer's rights stop that.
-- ---------------------------------------------------------------------------------------

/**
 * Signed in, and not a suspended or deleted account.
 *
 * Deliberately true for somebody who has no profile row yet: that is an invited person part
 * way through onboarding, and they need to read the team and skill lists they are about to
 * choose from. It is the presence of a *disabled* row that revokes access, not the absence of
 * one.
 */
CREATE OR REPLACE FUNCTION public.is_live_user()
    RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
    SELECT auth.uid() IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM public.users u
           WHERE u.id = auth.uid()
             AND (u.is_active = false OR u.deleted_at IS NOT NULL)
       );
$$;

/** Admin or super admin, and still active. The org-wide management rights. */
CREATE OR REPLACE FUNCTION public.is_org_admin()
    RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid()
          AND u.role IN ('admin', 'super_admin')
          AND u.is_active
          AND u.deleted_at IS NULL
    );
$$;

/** Adds team leaders: the people who curate skills alongside admins. */
CREATE OR REPLACE FUNCTION public.is_team_manager()
    RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid()
          AND u.role IN ('admin', 'super_admin', 'team_leader')
          AND u.is_active
          AND u.deleted_at IS NULL
    );
$$;

/** A leader of this particular team -- leadership is not transferable between teams. */
CREATE OR REPLACE FUNCTION public.leads_team(p_team_id uuid)
    RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
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

/** The same rule the UI draws its buttons from: canManageTeam in TeamManagement. */
CREATE OR REPLACE FUNCTION public.can_manage_team(p_team_id uuid)
    RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
    SELECT public.is_org_admin() OR public.leads_team(p_team_id);
$$;

-- ---------------------------------------------------------------------------------------
-- 2. Every table: anon out, PUBLIC out, RLS on.
--
-- A loop rather than a list so nothing is missed, including tables added by migrations
-- authored in parallel with this one. Extension-owned tables are skipped -- they are not ours
-- to alter, and ALTER TABLE on one aborts the whole migration.
-- ---------------------------------------------------------------------------------------

DO $$
DECLARE
    t record;
BEGIN
    FOR t IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND pg_get_userbyid(c.relowner) = current_user
    LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t.relname);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t.relname);
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    END LOOP;
END
$$;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- New tables must not inherit the old habit. Both spellings: the grants were made under an
-- explicit FOR ROLE postgres as well as the session default.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;

-- These two are worth having but do NOT finish the job, and the difference matters to whoever
-- writes the next migration.
--
-- Postgres grants EXECUTE on every new function to PUBLIC as a built-in, and anon is a member
-- of PUBLIC. Revoking it from the *default privileges* does not suppress that: tested on a
-- fresh database with these lines applied, a function created afterwards still comes out with
-- `=X/postgres` in its ACL, and has_function_privilege('anon', …) is true. There is no way to
-- change that from a migration without superuser (an event trigger), which hosted Supabase
-- does not grant.
--
-- So the rule is a convention with a sweep behind it: section 13 below revokes EXECUTE from
-- PUBLIC and anon on every function that exists today, and every new function must carry its
-- own `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon` -- as each of the recent migrations here
-- already does. A new RPC that forgets is callable without a session; that is only a hole if
-- the function does not check auth.uid() for itself, which is why all of these do.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ---------------------------------------------------------------------------------------
-- 3. Start the tables this migration governs from nothing.
--
-- Two clean slates, so that what follows is the whole truth about what a signed-in client may
-- do: the grants go back to zero, and every existing policy is dropped. Policies are OR'd
-- together, and six of the ones here read `USING (auth.role() = 'authenticated')` with no
-- command and no WITH CHECK -- every operation, for everybody signed in, including rewriting
-- another person's skills. One of those left in place would quietly re-open everything below.
--
-- Left alone on purpose: access_requests and the three request_form_* tables, whose own
-- migrations granted deliberately and narrowly; mfa_recovery_codes and mfa_recovery_attempts,
-- which no client may touch at all; and users and notifications, handled explicitly further
-- down.
-- ---------------------------------------------------------------------------------------

DO $$
DECLARE
    t text;
    p record;
    v_managed text[] := ARRAY[
        'teams', 'team_members', 'team_skills', 'tasks', 'task_tags', 'task_skills',
        'task_teams', 'task_dependencies', 'comments', 'tags', 'clients', 'regions', 'skills',
        'work_categories', 'work_category_skills', 'work_category_teams', 'user_skills',
        'user_clients', 'user_regions', 'leaves', 'assignments', 'audit_logs'
    ];
BEGIN
    FOREACH t IN ARRAY v_managed LOOP
        IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
            RAISE NOTICE 'no public.% table; skipping', t;
            CONTINUE;
        END IF;

        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);

        FOR p IN
            SELECT polname FROM pg_policy WHERE polrelid = to_regclass('public.' || quote_ident(t))
        LOOP
            EXECUTE format('DROP POLICY %I ON public.%I', p.polname, t);
        END LOOP;
    END LOOP;
END
$$;

-- ---------------------------------------------------------------------------------------
-- 4. public.users, where the privileges live.
--
-- Read is open to any signed-in member -- the whole app is built on knowing who everyone is.
-- Writing is not. Two locks, because they stop different things:
--
--   the policy       which ROW you may touch: your own
--   column grants    which COLUMNS: the ones that describe you, never the ones that decide
--                    what you may do
--
-- Without the second, "update your own row" still means "make yourself super_admin".
-- Role changes go through set_user_role below, deactivation through set_user_active, deletion
-- through delete_user_account -- all of which check who is asking.
-- ---------------------------------------------------------------------------------------

DO $$
DECLARE
    v_editable text[] := ARRAY['name', 'avatar', 'daily_capacity', 'onboarding_completed'];
    -- What Onboarding writes when it creates the row for an invitee who has no profile yet.
    v_insertable text[] := ARRAY['id', 'name', 'email', 'role', 'daily_capacity', 'is_active', 'onboarding_completed', 'avatar'];
    v_cols text;
    p record;
BEGIN
    IF to_regclass('public.users') IS NULL THEN
        RAISE NOTICE 'no public.users table; skipping';
        RETURN;
    END IF;

    REVOKE ALL ON TABLE public.users FROM authenticated;
    GRANT SELECT ON TABLE public.users TO authenticated;

    -- Only the columns that actually exist, so this survives the schema drifting.
    SELECT string_agg(quote_ident(column_name), ', ') INTO v_cols
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = ANY(v_editable);
    IF v_cols IS NOT NULL THEN
        EXECUTE format('GRANT UPDATE (%s) ON TABLE public.users TO authenticated', v_cols);
    END IF;

    SELECT string_agg(quote_ident(column_name), ', ') INTO v_cols
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = ANY(v_insertable);
    IF v_cols IS NOT NULL THEN
        EXECUTE format('GRANT INSERT (%s) ON TABLE public.users TO authenticated', v_cols);
    END IF;

    FOR p IN SELECT polname FROM pg_policy WHERE polrelid = to_regclass('public.users') LOOP
        EXECUTE format('DROP POLICY %I ON public.users', p.polname);
    END LOOP;
END
$$;

CREATE POLICY users_select ON public.users
    FOR SELECT TO authenticated
    -- Own row unconditionally: a deactivated account has to be able to load the profile that
    -- tells it, and the person it belongs to, that it is deactivated.
    USING (id = auth.uid() OR public.is_live_user());

-- Onboarding's fallback when the invite trigger left no row. Their own id, and not at a rank
-- of their choosing: the column grant stops role being edited afterwards, and this stops it
-- being chosen on the way in.
CREATE POLICY users_insert_self ON public.users
    FOR INSERT TO authenticated
    WITH CHECK (
        (id = auth.uid() AND role IN ('team_member', 'requester') AND is_active AND deleted_at IS NULL)
        OR public.is_org_admin()
    );

CREATE POLICY users_update_self ON public.users
    FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

CREATE POLICY users_update_admin ON public.users
    FOR UPDATE TO authenticated
    USING (public.is_org_admin())
    WITH CHECK (public.is_org_admin());

-- No DELETE policy and no DELETE grant: deleting people is delete_user_account's job, and it
-- asks whether you are the super admin, and whether there is any history to lose, first.

-- ---------------------------------------------------------------------------------------
-- 5. Notifications are addressed to one person.
--
-- The client already filters on user_id; that is a query, not a rule. This is the rule.
-- Writing them is notify_reassignment_needed's job, under the definer's rights, so the client
-- gets SELECT and the one UPDATE it needs to mark them read.
-- ---------------------------------------------------------------------------------------

DO $$
DECLARE p record;
BEGIN
    IF to_regclass('public.notifications') IS NULL THEN
        RAISE NOTICE 'no public.notifications table; skipping';
        RETURN;
    END IF;

    REVOKE ALL ON TABLE public.notifications FROM authenticated;
    GRANT SELECT, UPDATE ON TABLE public.notifications TO authenticated;

    FOR p IN SELECT polname FROM pg_policy WHERE polrelid = to_regclass('public.notifications') LOOP
        EXECUTE format('DROP POLICY %I ON public.notifications', p.polname);
    END LOOP;

    EXECUTE $p$
        CREATE POLICY notifications_select_own ON public.notifications
            FOR SELECT TO authenticated
            USING (user_id = auth.uid())
    $p$;

    EXECUTE $p$
        CREATE POLICY notifications_update_own ON public.notifications
            FOR UPDATE TO authenticated
            USING (user_id = auth.uid())
            WITH CHECK (user_id = auth.uid())
    $p$;
END
$$;

-- ---------------------------------------------------------------------------------------
-- 6. Teams.
-- ---------------------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.teams TO authenticated;

CREATE POLICY teams_select ON public.teams
    FOR SELECT TO authenticated USING (public.is_live_user());

CREATE POLICY teams_insert ON public.teams
    FOR INSERT TO authenticated WITH CHECK (public.is_org_admin());

CREATE POLICY teams_update ON public.teams
    FOR UPDATE TO authenticated
    USING (public.can_manage_team(id))
    WITH CHECK (public.can_manage_team(id));

CREATE POLICY teams_delete ON public.teams
    FOR DELETE TO authenticated USING (public.is_org_admin());

-- Onboarding writes its own membership, so `user_id = auth.uid()` has to be allowed; a leader
-- or admin can write anyone's, for their own team. Removal is the same rule, and the
-- demote-and-sign-out trigger fires either way.

GRANT SELECT, INSERT, DELETE ON TABLE public.team_members TO authenticated;

CREATE POLICY team_members_select ON public.team_members
    FOR SELECT TO authenticated USING (public.is_live_user());

CREATE POLICY team_members_insert ON public.team_members
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid() OR public.can_manage_team(team_id));

CREATE POLICY team_members_delete ON public.team_members
    FOR DELETE TO authenticated
    USING (user_id = auth.uid() OR public.can_manage_team(team_id));

GRANT SELECT, INSERT, DELETE ON TABLE public.team_skills TO authenticated;

CREATE POLICY team_skills_select ON public.team_skills
    FOR SELECT TO authenticated USING (public.is_live_user());

CREATE POLICY team_skills_insert ON public.team_skills
    FOR INSERT TO authenticated WITH CHECK (public.can_manage_team(team_id));

CREATE POLICY team_skills_delete ON public.team_skills
    FOR DELETE TO authenticated USING (public.can_manage_team(team_id));

-- ---------------------------------------------------------------------------------------
-- 7. Tasks.
--
-- Anyone signed in may raise a request and edit a task: assignees change status and hours,
-- leaders reassign, requesters correct their own wording. The app has never drawn that line
-- per field, and inventing one here would break screens rather than protect anything.
-- Deletion is drawn, because it is the destructive one: it mirrors canDeleteTask.
-- ---------------------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tasks TO authenticated;

CREATE POLICY tasks_select ON public.tasks
    FOR SELECT TO authenticated USING (public.is_live_user());

CREATE POLICY tasks_insert ON public.tasks
    FOR INSERT TO authenticated WITH CHECK (public.is_live_user());

CREATE POLICY tasks_update ON public.tasks
    FOR UPDATE TO authenticated
    USING (public.is_live_user())
    WITH CHECK (public.is_live_user());

CREATE POLICY tasks_delete ON public.tasks
    FOR DELETE TO authenticated
    USING (
        public.is_org_admin()
        OR requester_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.task_teams tt
            WHERE tt.task_id = tasks.id AND public.leads_team(tt.team_id)
        )
    );

-- The task join tables. Rows here are meaningless without the task they hang off, and editing
-- a task is already open to any member, so they follow the task rather than adding a rule of
-- their own.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['task_tags', 'task_skills', 'task_teams', 'task_dependencies'] LOOP
        EXECUTE format('GRANT SELECT, INSERT, DELETE ON TABLE public.%I TO authenticated', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_live_user())',
            t || '_select', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_live_user())',
            t || '_insert', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_live_user())',
            t || '_delete', t);
    END LOOP;
END
$$;

-- ---------------------------------------------------------------------------------------
-- 8. Comments.
--
-- Readable by the team, writable only as yourself. Editing or deleting somebody else's comment
-- is an admin act -- and the app greys out a departed author's comments rather than removing
-- them, so this is the only path that can touch them at all.
-- ---------------------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.comments TO authenticated;

CREATE POLICY comments_select ON public.comments
    FOR SELECT TO authenticated USING (public.is_live_user());

CREATE POLICY comments_insert ON public.comments
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND public.is_live_user());

CREATE POLICY comments_update ON public.comments
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid() OR public.is_org_admin())
    WITH CHECK (user_id = auth.uid() OR public.is_org_admin());

CREATE POLICY comments_delete ON public.comments
    FOR DELETE TO authenticated
    USING (user_id = auth.uid() OR public.is_org_admin());

-- ---------------------------------------------------------------------------------------
-- 9. Tags, brands, regions, categories.
--
-- A tag is created by whoever first types it on a request, so INSERT is open to members.
-- Renaming or deleting one reaches every task that carries it, so those are not.
-- ---------------------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tags TO authenticated;

CREATE POLICY tags_select ON public.tags
    FOR SELECT TO authenticated USING (public.is_live_user());

CREATE POLICY tags_insert ON public.tags
    FOR INSERT TO authenticated WITH CHECK (public.is_live_user());

CREATE POLICY tags_update ON public.tags
    FOR UPDATE TO authenticated
    USING (public.is_org_admin()) WITH CHECK (public.is_org_admin());

CREATE POLICY tags_delete ON public.tags
    FOR DELETE TO authenticated USING (public.is_org_admin());

-- Org configuration: everybody reads it, admins own it. The one thing a member used to write
-- -- a new department typed into the request form -- is add_client_department() below.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'clients', 'regions', 'work_categories', 'work_category_skills', 'work_category_teams'
    ] LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_live_user())',
            t || '_select', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_org_admin())',
            t || '_insert', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_org_admin()) WITH CHECK (public.is_org_admin())',
            t || '_update', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_org_admin())',
            t || '_delete', t);
    END LOOP;
END
$$;

-- Team leaders curate the skill list alongside admins, since it is their own team's skills they
-- are describing. Deleting one strips it from every person and task that referenced it, so
-- that stays with admins.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.skills TO authenticated;

CREATE POLICY skills_select ON public.skills
    FOR SELECT TO authenticated USING (public.is_live_user());

CREATE POLICY skills_insert ON public.skills
    FOR INSERT TO authenticated WITH CHECK (public.is_team_manager());

CREATE POLICY skills_update ON public.skills
    FOR UPDATE TO authenticated
    USING (public.is_team_manager()) WITH CHECK (public.is_team_manager());

CREATE POLICY skills_delete ON public.skills
    FOR DELETE TO authenticated USING (public.is_org_admin());

-- ---------------------------------------------------------------------------------------
-- 10. A person's own skills, brands, regions and leave.
--
-- These are answers about yourself. Everyone can read them -- assignment is built on knowing
-- who can do what, and capacity on who is away -- but only you or an admin may change yours.
-- The policy that was here let anyone rewrite anyone's.
-- ---------------------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['user_skills', 'user_clients', 'user_regions'] LOOP
        EXECUTE format('GRANT SELECT, INSERT, DELETE ON TABLE public.%I TO authenticated', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_live_user())',
            t || '_select', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR public.is_org_admin())',
            t || '_insert', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (user_id = auth.uid() OR public.is_org_admin())',
            t || '_delete', t);
    END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.leaves TO authenticated;

CREATE POLICY leaves_select ON public.leaves
    FOR SELECT TO authenticated USING (public.is_live_user());

CREATE POLICY leaves_insert ON public.leaves
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR public.is_org_admin());

CREATE POLICY leaves_update ON public.leaves
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid() OR public.is_org_admin())
    WITH CHECK (user_id = auth.uid() OR public.is_org_admin());

CREATE POLICY leaves_delete ON public.leaves
    FOR DELETE TO authenticated
    USING (user_id = auth.uid() OR public.is_org_admin());

-- ---------------------------------------------------------------------------------------
-- 11. Read-only from the client.
--
-- assignments is legacy and empty. audit_logs is a record of what people did, which is exactly
-- the sort of thing that must not be editable by the people it is about; nothing writes to it
-- today, and when something does it will be a definer function, not the browser.
-- ---------------------------------------------------------------------------------------

GRANT SELECT ON TABLE public.assignments TO authenticated;

CREATE POLICY assignments_select ON public.assignments
    FOR SELECT TO authenticated USING (public.is_live_user());

GRANT SELECT ON TABLE public.audit_logs TO authenticated;

CREATE POLICY audit_logs_select ON public.audit_logs
    FOR SELECT TO authenticated USING (public.is_org_admin());

-- ---------------------------------------------------------------------------------------
-- 12. Changing somebody's role, now that the column cannot be written directly.
--
-- Same rule the Team Management screen draws its dropdown from, only here it is enforced.
-- super_admin is left out on purpose in both directions -- there is exactly one, and
-- transfer_super_admin_ownership is what moves it.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_user_role(p_user_id uuid, p_role text)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    v_caller_role text;
    v_target_role text;
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

    SELECT u.role INTO v_target_role FROM public.users u WHERE u.id = p_user_id;
    IF v_target_role IS NULL THEN
        RAISE EXCEPTION 'That person no longer exists.';
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

/**
 * Add a department to a brand, and nothing else.
 *
 * The request form lets a requester type a department that is not on the brand yet and appends
 * it. That single append was the only reason UPDATE on clients was ever open to members; with
 * it here, renaming or repointing a brand stays with admins. Appends only -- existing entries
 * cannot be removed or rewritten through this -- and a duplicate is a no-op.
 */
CREATE OR REPLACE FUNCTION public.add_client_department(p_client_id uuid, p_department text)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

-- ---------------------------------------------------------------------------------------
-- 13. What a signed-out visitor is still allowed to call.
--
-- Functions inherited GRANT ALL to anon the same way tables did, so every RPC in the schema
-- was callable without a session -- including the ones that end sessions or resolve access
-- requests. Postgres also grants EXECUTE on a new function to PUBLIC unless told otherwise,
-- and PUBLIC includes anon. Revoke both, then hand back exactly the four that are meant to be
-- reachable without an account: the public request form reads and submits, and the login
-- screen asks for access or reactivation. Each validates its own input and is
-- enumeration-safe.
--
-- authenticated is then re-granted only the functions the app actually calls, one by one. A
-- blanket GRANT ON ALL FUNCTIONS would undo the deliberate revokes elsewhere in this schema --
-- mfa_recovery_code_hash and notify_reassignment_needed are not meant to be callable by
-- anybody.
-- ---------------------------------------------------------------------------------------

-- Owner-filtered, like the table loop: REVOKE on a function belonging to an extension fails
-- outright, and one of those would take the whole migration down with it.
DO $$
DECLARE
    f record;
BEGIN
    FOR f IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prokind = 'f'
          AND pg_get_userbyid(p.proowner) = current_user
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    END LOOP;
END
$$;

DO $$
DECLARE
    v_fn text;
    v_anon text[] := ARRAY[
        'public.request_access(text, text, text)',
        'public.request_reactivation(text, text)',
        'public.get_public_request_form(text)',
        'public.submit_public_request(text, jsonb)'
    ];
    v_signed_in text[] := ARRAY[
        -- The policy helpers above: a policy expression is evaluated as the querying role, so
        -- without EXECUTE here every table below denies everything.
        'public.is_live_user()',
        'public.is_org_admin()',
        'public.is_team_manager()',
        'public.leads_team(uuid)',
        'public.can_manage_team(uuid)',
        -- Everything the app calls through supabase.rpc().
        'public.set_user_role(uuid, text)',
        'public.add_client_department(uuid, text)',
        'public.set_user_active(uuid, boolean)',
        'public.delete_user_account(uuid)',
        'public.remove_team_member(uuid, uuid)',
        'public.resolve_access_request(uuid, text)',
        'public.transfer_super_admin_ownership(uuid)',
        'public.current_user_has_password()',
        'public.current_user_is_form_admin()',
        'public.list_my_sessions()',
        'public.revoke_my_session(uuid)',
        'public.revoke_my_sessions(boolean)',
        'public.verify_current_password(text)',
        'public.generate_mfa_recovery_codes()',
        'public.my_mfa_recovery_code_status()',
        'public.redeem_mfa_recovery_code(text)',
        'public.get_or_create_request_form_link()',
        'public.update_request_form_link(boolean, boolean)',
        'public.get_request_form_config()',
        'public.save_request_form_config(jsonb)',
        'public.match_skills(extensions.vector, double precision, integer)',
        'public.match_skills(extensions.vector, integer)'
    ];
BEGIN
    FOREACH v_fn IN ARRAY v_anon LOOP
        IF to_regprocedure(v_fn) IS NOT NULL THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', v_fn);
        ELSE
            RAISE NOTICE 'anon: skipped (no such function): %', v_fn;
        END IF;
    END LOOP;

    FOREACH v_fn IN ARRAY v_signed_in LOOP
        IF to_regprocedure(v_fn) IS NOT NULL THEN
            EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_fn);
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);
        ELSE
            RAISE NOTICE 'authenticated: skipped (no such function): %', v_fn;
        END IF;
    END LOOP;
END
$$;
