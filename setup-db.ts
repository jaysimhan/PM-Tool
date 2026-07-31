import { Client } from 'pg';
import fs from 'fs';

const client = new Client({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
});

async function main() {
  await client.connect();
  console.log('Connected');

  try {
    const schema = fs.readFileSync('supabase/schema.sql', 'utf8');
    await client.query(schema);
    console.log('Schema applied');

    const seed = fs.readFileSync('supabase/seed.sql.bak', 'utf8');
    const statements = seed.split(';');
    
    for (const stmt of statements) {
      if (!stmt.trim()) continue;
      try {
        await client.query(stmt);
      } catch (err) {
        console.error('Error in statement:', stmt);
        console.error(err);
        break;
      }
    }
    console.log('Seed applied');
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
