-- 'requester' is what someone is *before* they belong to a team: handle_new_user() gives
-- every new auth identity that role, since an invite carries no role of its own. The
-- promotion out of it was missing, so invitees who finished setup and picked a team stayed
-- requesters forever - excluded from workload planning and stuck with a role the Team
-- Management dropdown could not even display.
--
-- Joining a team is the promotion. Doing it in a trigger rather than in Onboarding covers
-- every path into team_members: finishing setup, an admin adding an existing person to a
-- team, and a removed member re-picking one.
--
-- Only 'requester' is touched. Anyone who already holds a real role keeps it, so adding a
-- team_leader or an admin to a team never quietly demotes them. The reverse is deliberately
-- not automatic: taking someone off a team leaves their role alone, matching the re-pick
-- flow that keeps their name, role and skills.

CREATE OR REPLACE FUNCTION public.promote_requester_on_team_join() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
    UPDATE public.users
    SET role = 'team_member'
    WHERE id = NEW.user_id
      AND role = 'requester';
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_team_member_added_promote_requester ON public.team_members;
CREATE TRIGGER on_team_member_added_promote_requester
    AFTER INSERT ON public.team_members
    FOR EACH ROW
    EXECUTE FUNCTION public.promote_requester_on_team_join();

-- Everyone the missing promotion already stranded.
UPDATE public.users u
SET role = 'team_member'
WHERE u.role = 'requester'
  AND EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.user_id = u.id);
