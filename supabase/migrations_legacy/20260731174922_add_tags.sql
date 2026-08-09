-- Create Tags table
CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Enable RLS
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users access to tags
CREATE POLICY "Allow all authenticated users access to tags" ON tags FOR ALL USING (auth.role() = 'authenticated');

-- Create Task Tags junction table
CREATE TABLE task_tags (
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, tag_id)
);

-- Enable RLS
ALTER TABLE task_tags ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users access to task_tags
CREATE POLICY "Allow all authenticated users access to task_tags" ON task_tags FOR ALL USING (auth.role() = 'authenticated');
