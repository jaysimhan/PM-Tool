import { Client } from 'pg';

const client = new Client({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
});

async function main() {
  await client.connect();
  console.log('Connected');

  try {
    await client.query('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;');
    await client.query('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;');
    console.log('Granted privileges');
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
