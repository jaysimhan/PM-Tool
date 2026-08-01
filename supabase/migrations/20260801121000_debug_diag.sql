CREATE OR REPLACE FUNCTION _debug_users_info()
RETURNS TABLE(conname text, contype text, definition text) AS $$
  SELECT conname, contype::text, pg_get_constraintdef(oid)
  FROM pg_constraint
  WHERE conrelid = 'public.users'::regclass;
$$ LANGUAGE sql;
