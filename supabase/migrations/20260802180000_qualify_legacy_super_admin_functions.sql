-- Remove, Deactivate and Delete all died with `relation "users" does not exist`, and none of
-- the functions behind those buttons is at fault -- they are schema-qualified throughout.
--
-- The three functions below predate that convention. They say `FROM users`, not
-- `FROM public.users`, and they carry no `SET search_path` of their own, so they resolve
-- names against whatever search_path happens to be active when they run.
--
-- On their own that was fine: PostgREST leaves `public` on the path, so the bare name found
-- the table. What changed is who calls them. remove_team_member() and delete_user_account()
-- are `SET search_path TO ''`, and a trigger fired inside a function inherits that empty
-- path. Every DELETE on team_members now runs prevent_super_admin_home_team_removal() with
-- nothing on the search_path, and `users` resolves to nothing at all.
--
-- Which is why the error named a table the caller never mentioned, and why it appeared on
-- buttons whose own SQL was correct: the failure is one level below them, in the trigger.
--
-- The fix is the convention the rest of the schema already follows -- qualify every name and
-- pin search_path to empty -- so these behave the same however they are reached. For
-- transfer_super_admin_ownership, a SECURITY DEFINER function, the pin is also what stops a
-- caller-controlled search_path from deciding which `users` it writes to.

-- Trigger on public.users: when someone becomes super_admin, move them onto the home team.
CREATE OR REPLACE FUNCTION public.enforce_super_admin_home_team()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO ''
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

-- Trigger on public.team_members: the super admin cannot leave the home team. This is the one
-- that broke Remove and Delete -- both delete a team_members row from inside an empty-path
-- function, and this fired underneath them.
CREATE OR REPLACE FUNCTION public.prevent_super_admin_home_team_removal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO ''
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

-- Called straight from the browser, so it has been running with `public` on the path and
-- working. Qualified here for the same reason as the others, and because a SECURITY DEFINER
-- function that trusts the caller's search_path is a way in.
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
    IF auth.uid() = new_super_admin_id THEN
        RAISE EXCEPTION 'That user is already the super admin.';
    END IF;

    UPDATE public.users SET role = 'admin' WHERE id = auth.uid();
    UPDATE public.users SET role = 'super_admin' WHERE id = new_super_admin_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_super_admin_ownership(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_super_admin_ownership(UUID) TO authenticated;
