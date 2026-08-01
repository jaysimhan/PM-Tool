import { Client } from 'pg';

const client = new Client({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
});

async function run() {
  await client.connect();
  try {
    const sql = `
-- Create Regions table
CREATE TABLE IF NOT EXISTS regions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  flag TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Enable RLS
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users access to regions
DROP POLICY IF EXISTS "Allow all authenticated users access to regions" ON regions;
CREATE POLICY "Allow all authenticated users access to regions" ON regions FOR ALL USING (auth.role() = 'authenticated');

-- Insert initial regions
INSERT INTO regions (name, code, flag) VALUES
('USA', 'USA', '🇺🇸'),
('UK', 'UK', '🇬🇧'),
('AU', 'AU', '🇦🇺')
ON CONFLICT (code) DO NOTHING;

-- Add region_id to tasks table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tasks' AND column_name='region_id') THEN
    ALTER TABLE tasks ADD COLUMN region_id UUID REFERENCES regions(id);
  END IF;
END
$$;
    `;
    await client.query(sql);
    console.log('Migration applied successfully.');
  } catch (err) {
    console.error('Error applying migration:', err);
  } finally {
    await client.end();
  }
}

run();
