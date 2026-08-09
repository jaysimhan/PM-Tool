#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_PM_Web}"
fixture_sql() {
  docker exec -i "$db_container" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres
}
as_user() {
  local user_id="$1" statement="$2"
  docker exec "$db_container" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
    "SET role authenticated; SELECT set_config('request.jwt.claims', '{\"sub\":\"$user_id\",\"role\":\"authenticated\"}', false); $statement" >/dev/null
}
expect_one_success() {
  local user_a="$1" sql_a="$2" user_b="$3" sql_b="$4"
  set +e
  as_user "$user_a" "$sql_a" 2>/dev/null & local first=$!
  as_user "$user_b" "$sql_b" 2>/dev/null & local second=$!
  wait "$first"; local first_status=$?
  wait "$second"; local second_status=$?
  set -e
  echo "concurrent exit statuses: $first_status, $second_status"
  if [[ $(( (first_status == 0) + (second_status == 0) )) -ne 1 ]]; then
    echo "expected exactly one concurrent transition to succeed" >&2
    exit 1
  fi
}

admin='30000000-0000-0000-0000-000000000001'
employee='30000000-0000-0000-0000-000000000002'
other='30000000-0000-0000-0000-000000000003'

fixture_sql <<SQL
DELETE FROM public.tasks WHERE id::text LIKE '40000000-0000-0000-0000-0000000000%';
DELETE FROM public.users WHERE id IN ('$admin', '$employee', '$other');
INSERT INTO public.users (id,name,email,role,is_active,onboarding_completed) VALUES
('$admin','Race Admin','race-admin@example.invalid','admin',true,true),
('$employee','Race Employee','race-employee@example.invalid','team_member',true,true),
('$other','Race Other','race-other@example.invalid','team_member',true,true);
SQL

make_offer() {
  local suffix="$1"
  fixture_sql <<SQL
INSERT INTO public.tasks (id,title,status,priority,requester_id,assignee_id,assigned_by_id,estimated_hours,due_date)
VALUES ('40000000-0000-0000-0000-0000000000$suffix','Race task','awaiting_employee_approval','normal','$admin','$employee','$admin',8,'2026-08-20');
INSERT INTO public.assignments (id,task_id,user_id,assigned_by_id,status,assigned_date,estimated_hours)
VALUES ('50000000-0000-0000-0000-0000000000$suffix','40000000-0000-0000-0000-0000000000$suffix','$employee','$admin','pending',now(),8);
SQL
}

make_offer 01
accept="SELECT public.accept_assignment('50000000-0000-0000-0000-000000000001','2026-08-20',8,NULL,NULL);"
expect_one_success "$employee" "$accept" "$employee" "$accept"
as_user "$employee" "$accept" 2>/dev/null && { echo 'retry unexpectedly succeeded' >&2; exit 1; } || true

make_offer 02
accept2="SELECT public.accept_assignment('50000000-0000-0000-0000-000000000002','2026-08-20',8,NULL,NULL);"
reject2="SELECT public.reject_assignment('50000000-0000-0000-0000-000000000002','Not available');"
expect_one_success "$employee" "$accept2" "$employee" "$reject2"

make_offer 03
accept3="SELECT public.accept_assignment('50000000-0000-0000-0000-000000000003','2026-08-20',8,NULL,NULL);"
reassign3="SELECT public.assign_task_checked('40000000-0000-0000-0000-000000000003','$other',false,'50000000-0000-0000-0000-000000000003','pending');"
expect_one_success "$employee" "$accept3" "$admin" "$reassign3"

make_offer 04
as_user "$admin" "SELECT public.assign_task_checked('40000000-0000-0000-0000-000000000004','$other',false,'50000000-0000-0000-0000-000000000004','pending');"
old_accept="SELECT public.accept_assignment('50000000-0000-0000-0000-000000000004','2026-08-20',8,NULL,NULL);"
as_user "$employee" "$old_accept" 2>/dev/null && { echo 'stale assignment unexpectedly succeeded' >&2; exit 1; } || true

fixture_sql <<SQL
DELETE FROM public.tasks WHERE id::text LIKE '40000000-0000-0000-0000-0000000000%';
DELETE FROM public.users WHERE id IN ('$admin', '$employee', '$other');
SQL
echo 'assignment concurrency checks passed'
