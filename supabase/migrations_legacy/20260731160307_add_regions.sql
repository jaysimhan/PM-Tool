-- Create Regions table
CREATE TABLE regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  flag TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Enable RLS
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users access to regions
CREATE POLICY "Allow all authenticated users access to regions" ON regions FOR ALL USING (auth.role() = 'authenticated');

-- Insert initial regions
INSERT INTO regions (name, code, flag) VALUES
('USA', 'USA', '🇺🇸'),
('UK', 'UK', '🇬🇧'),
('AU', 'AU', '🇦🇺');

-- Add region_id to tasks table
ALTER TABLE tasks ADD COLUMN region_id UUID REFERENCES regions(id);
