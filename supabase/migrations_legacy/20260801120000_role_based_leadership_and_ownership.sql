-- Team leadership/adminship becomes role-based: any number of team_members can hold
-- the 'team_leader' or 'admin' role, and a team may have none of either. The old
-- single teams.leader_id pointer is replaced by that model.
--
-- App-wide invariants enforced here:
--   1. A person belongs to at most one team (team_members.user_id is unique).
--   2. There is exactly one 'super_admin' in the whole app.
--   3. The super_admin always belongs to exactly one team: the designated "home" team
--      (General Marketing). Promoting a user to super_admin moves them there and off
--      any other team; their home-team membership cannot be deleted while they hold
--      the role.
--   4. Ownership transfer (demote current super_admin to admin, promote a new one) is
--      an atomic operation via transfer_super_admin_ownership(), not a plain role edit.

-- 1. One team per person.
ALTER TABLE team_members ADD CONSTRAINT team_members_user_id_key UNIQUE (user_id);

-- 2. Mark the home team that the super admin must always belong to.
ALTER TABLE teams ADD COLUMN is_home_team BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX teams_single_home_team ON teams (is_home_team) WHERE is_home_team = true;
UPDATE teams SET is_home_team = true WHERE name = 'General Marketing';

-- 3. Exactly one super_admin, app-wide.
CREATE UNIQUE INDEX users_single_super_admin ON users (role) WHERE role = 'super_admin';

-- 4. Align the column default with the roles the app understands (was the stray
--    'user'). A CHECK constraint restricting role to those values (users_role_check)
--    already exists on this table, so it isn't recreated here.
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'team_member';

-- 5. Whenever a user's role becomes super_admin (insert or update), move them
--    exclusively onto the home team.
CREATE OR REPLACE FUNCTION enforce_super_admin_home_team()
RETURNS TRIGGER AS $$
DECLARE
    home_team_id UUID;
BEGIN
    SELECT id INTO home_team_id FROM teams WHERE is_home_team = true LIMIT 1;
    IF home_team_id IS NOT NULL THEN
        DELETE FROM team_members WHERE user_id = NEW.id AND team_id <> home_team_id;
        INSERT INTO team_members (team_id, user_id)
        VALUES (home_team_id, NEW.id)
        ON CONFLICT (user_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_super_admin_home_team ON users;
CREATE TRIGGER trg_enforce_super_admin_home_team
    AFTER INSERT OR UPDATE OF role ON users
    FOR EACH ROW
    WHEN (NEW.role = 'super_admin')
    EXECUTE FUNCTION enforce_super_admin_home_team();

-- 6. The super admin's membership in the home team can't be deleted directly
--    (moving them elsewhere only happens via role change, handled above).
CREATE OR REPLACE FUNCTION prevent_super_admin_home_team_removal()
RETURNS TRIGGER AS $$
DECLARE
    member_role TEXT;
    left_team_is_home BOOLEAN;
BEGIN
    SELECT role INTO member_role FROM users WHERE id = OLD.user_id;
    SELECT is_home_team INTO left_team_is_home FROM teams WHERE id = OLD.team_id;
    IF member_role = 'super_admin' AND left_team_is_home THEN
        RAISE EXCEPTION 'Cannot remove the super admin from the home team.';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_super_admin_home_team_removal ON team_members;
CREATE TRIGGER trg_prevent_super_admin_home_team_removal
    BEFORE DELETE ON team_members
    FOR EACH ROW
    EXECUTE FUNCTION prevent_super_admin_home_team_removal();

-- 7. Backfill: membership used to be implied by teams.leader_id; make it explicit
--    for whoever currently holds super_admin before that column is dropped.
INSERT INTO team_members (team_id, user_id)
SELECT t.id, u.id
FROM users u
JOIN teams t ON t.is_home_team = true
WHERE u.role = 'super_admin'
ON CONFLICT (user_id) DO NOTHING;

-- 8. Leadership/adminship is now derived from team_members + users.role. Drop the
--    legacy single-leader pointer.
ALTER TABLE teams DROP COLUMN leader_id;

-- 9. Atomic ownership transfer: only the real caller (via their JWT, not a
--    client-supplied id) can transfer away their own super_admin role.
CREATE OR REPLACE FUNCTION transfer_super_admin_ownership(new_super_admin_id UUID)
RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only the current super admin can transfer ownership.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = new_super_admin_id) THEN
        RAISE EXCEPTION 'Target user does not exist.';
    END IF;
    IF auth.uid() = new_super_admin_id THEN
        RAISE EXCEPTION 'That user is already the super admin.';
    END IF;

    UPDATE users SET role = 'admin' WHERE id = auth.uid();
    UPDATE users SET role = 'super_admin' WHERE id = new_super_admin_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION transfer_super_admin_ownership(UUID) TO authenticated;
