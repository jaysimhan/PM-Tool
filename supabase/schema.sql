-- Supabase Schema for PM Web
-- This file contains the initial schema for migrating from mockData.ts

-- Users Table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  avatar TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  location TEXT,
  manager_id UUID REFERENCES users(id),
  designation TEXT,
  department TEXT,
  about TEXT,
  skills TEXT[],
  interests TEXT[],
  languages TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Teams Table
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  leader_id UUID REFERENCES users(id),
  color TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Team Members
CREATE TABLE team_members (
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
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
