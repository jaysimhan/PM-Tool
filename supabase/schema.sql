-- Supabase Schema for PM Web
-- This file contains the initial schema for migrating from mockData.ts

-- Users Table
-- role is one of: 'super_admin' | 'admin' | 'manager' | 'team_leader' | 'team_member' | 'requester'
-- (see users_role_check). Exactly one row may have role = 'super_admin', enforced by
-- users_single_super_admin (see "Leadership & ownership" section below).
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  avatar TEXT,
  role TEXT NOT NULL DEFAULT 'team_member',
  location TEXT,
  manager_id UUID REFERENCES users(id),
  designation TEXT,
  department TEXT,
  about TEXT,
  skills TEXT[],
  interests TEXT[],
  languages TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT users_role_check CHECK (role IN ('super_admin', 'admin', 'manager', 'team_leader', 'team_member', 'requester'))
);

-- Teams Table
-- Leadership/adminship is role-based (a team_members row + users.role = 'team_leader'
-- or 'admin'); a team can have any number of leaders/admins, or none. is_home_team
-- marks the one team (General Marketing) the sole super_admin always belongs to.
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,
  is_home_team BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);
CREATE UNIQUE INDEX teams_single_home_team ON teams (is_home_team) WHERE is_home_team = true;

-- Team Members
-- user_id is unique: a person belongs to at most one team.
CREATE TABLE team_members (
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  PRIMARY KEY (team_id, user_id)
);

-- Clients Table
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  industry TEXT,
  status TEXT,
  logo TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Tasks Table
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  priority TEXT,
  assignee_id UUID REFERENCES users(id),
  requester_id UUID REFERENCES users(id),
  client_id UUID REFERENCES clients(id),
  parent_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  due_date TIMESTAMP WITH TIME ZONE,
  proposed_start_date TIMESTAMP WITH TIME ZONE,
  proposed_end_date TIMESTAMP WITH TIME ZONE,
  estimated_hours NUMERIC,
  tags TEXT[],
  is_subtask BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Task Dependencies
CREATE TABLE task_dependencies (
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  blocks_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, blocks_task_id)
);

-- Task Links
CREATE TABLE task_links (
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  linked_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, linked_task_id)
);

-- Comments Table
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- Basic Policies (Allow all for authenticated users temporarily during migration)
CREATE POLICY "Allow all authenticated users access to users" ON users FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all authenticated users access to teams" ON teams FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all authenticated users access to team_members" ON team_members FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all authenticated users access to clients" ON clients FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all authenticated users access to tasks" ON tasks FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all authenticated users access to task_dependencies" ON task_dependencies FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all authenticated users access to task_links" ON task_links FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all authenticated users access to comments" ON comments FOR ALL USING (auth.role() = 'authenticated');

-- Leadership & ownership
-- See supabase/migrations/20260801120000_role_based_leadership_and_ownership.sql for
-- the migration that introduced this on top of the tables above.

-- Exactly one super_admin, app-wide.
CREATE UNIQUE INDEX users_single_super_admin ON users (role) WHERE role = 'super_admin';

-- Whenever a user's role becomes super_admin, move them exclusively onto the home team.
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

CREATE TRIGGER trg_enforce_super_admin_home_team
    AFTER INSERT OR UPDATE OF role ON users
    FOR EACH ROW
    WHEN (NEW.role = 'super_admin')
    EXECUTE FUNCTION enforce_super_admin_home_team();

-- The super admin's membership in the home team can't be deleted directly.
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

CREATE TRIGGER trg_prevent_super_admin_home_team_removal
    BEFORE DELETE ON team_members
    FOR EACH ROW
    EXECUTE FUNCTION prevent_super_admin_home_team_removal();

-- Atomic ownership transfer: only the real caller (via their JWT, not a
-- client-supplied id) can transfer away their own super_admin role.
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
