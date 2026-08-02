// Local development helper: hands the Data API roles the access the app expects.
//
// This used to read
//
//     GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
//
// and the same statement was evidently run against the live project, because the anon key --
// which is published inside the JavaScript bundle and is supposed to carry no authority of
// its own -- could read public.users and delete rows from it. Every "only an admin may…"
// check in this schema lives inside a SECURITY DEFINER function, and none of them apply to a
// request that goes straight to the table instead.
//
// So anon is off the list, and actively revoked. The signed-out screens reach the database
// through four SECURITY DEFINER functions (request_access, request_reactivation,
// get_public_request_form, submit_public_request) and need nothing else.
//
// supabase/migrations/20260802170000_lock_down_data_api.sql is the authoritative version of
// this and covers RLS as well; prefer `supabase db reset` over running this by hand.

import { Client } from 'pg';

const client = new Client({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
});

async function main() {
  await client.connect();
  console.log('Connected');

  try {
    await client.query('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO authenticated, service_role;');
    await client.query('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;');
    await client.query('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;');
    await client.query('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;');
    console.log('Granted privileges (anon excluded, and revoked if it had any)');
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
