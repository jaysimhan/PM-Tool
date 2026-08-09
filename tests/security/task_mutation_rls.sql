\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(value boolean, message text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %', message; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_denied(statement text, message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'assertion failed: %', message;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

SELECT pg_temp.assert_true(NOT EXISTS (
  SELECT 1
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE')
    AND p.proname NOT IN (
      'get_public_dashboard_cached', 'get_public_request_form', 'request_access',
      'request_reactivation', 'submit_public_request'
    )
), 'anonymous SECURITY DEFINER surface matches the reviewed allowlist');

INSERT INTO public.users (id, name, email, role, is_active, onboarding_completed) VALUES
('10000000-0000-0000-0000-000000000001', 'Admin', 'rls-admin@example.invalid', 'admin', true, true),
('10000000-0000-0000-0000-000000000002', 'Employee', 'rls-employee@example.invalid', 'team_member', true, true),
('10000000-0000-0000-0000-000000000003', 'Other', 'rls-other@example.invalid', 'team_member', true, true),
('10000000-0000-0000-0000-000000000004', 'Invitee', 'rls-invitee@example.invalid', 'invitee', true, false);

INSERT INTO public.tasks (id, title, status, priority, requester_id)
VALUES ('20000000-0000-0000-0000-000000000001', 'RLS fixture', 'new_request', 'normal', '10000000-0000-0000-0000-000000000002');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
UPDATE public.tasks SET title = 'Safe edit' WHERE id = '20000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true((SELECT title = 'Safe edit' FROM public.tasks WHERE id = '20000000-0000-0000-0000-000000000001'), 'requester safe-column update');
SELECT pg_temp.expect_denied($q$UPDATE public.tasks SET assignee_id = '10000000-0000-0000-0000-000000000003' WHERE id = '20000000-0000-0000-0000-000000000001'$q$, 'direct assignee update must be denied');

SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
UPDATE public.tasks SET title = 'Forbidden edit' WHERE id = '20000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true((SELECT title = 'Safe edit' FROM public.tasks WHERE id = '20000000-0000-0000-0000-000000000001'), 'unrelated employee update filtered by RLS');

SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.tasks), 'invitee cannot read organisation tasks');
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000099","role":"authenticated"}', true);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.tasks), 'JWT without a live profile cannot read organisation tasks');

SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT public.set_task_status('20000000-0000-0000-0000-000000000001', 'in_progress');
SELECT pg_temp.assert_true((SELECT status = 'in_progress' FROM public.tasks WHERE id = '20000000-0000-0000-0000-000000000001'), 'admin status RPC');
SELECT public.create_subtask('20000000-0000-0000-0000-000000000001', 'Persisted child');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.tasks WHERE parent_task_id = '20000000-0000-0000-0000-000000000001' AND sort_order = 0), 'subtask persisted with order');

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT pg_temp.expect_denied($q$SELECT public.set_task_status('20000000-0000-0000-0000-000000000001', 'completed')$q$, 'anonymous status RPC must be denied');
SELECT pg_temp.expect_denied($q$SELECT count(*) FROM public.tasks$q$, 'anonymous task select must be denied');

ROLLBACK;
