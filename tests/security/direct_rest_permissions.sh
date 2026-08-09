#!/usr/bin/env bash
set -euo pipefail

eval "$(npx supabase status -o env 2>/dev/null)"
email="rest-rls-$(date +%s)-$RANDOM@example.invalid"
password="Local-test-A7!$(date +%s)"

echo 'creating REST test identity'
auth_response=$(curl -fsS "$API_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$email\",\"password\":\"$password\",\"email_confirm\":true,\"user_metadata\":{\"name\":\"REST RLS Test\"}}")
user_id=$(jq -r '.id' <<<"$auth_response")
[[ "$user_id" =~ ^[0-9a-f-]{36}$ ]]

echo 'activating REST test profile'
curl -fsS "$REST_URL/users" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H 'Content-Type: application/json' -H 'Prefer: resolution=merge-duplicates' \
  -d "{\"id\":\"$user_id\",\"name\":\"REST RLS Test\",\"email\":\"$email\",\"role\":\"team_member\",\"is_active\":true,\"onboarding_completed\":true}" >/dev/null

echo 'signing in REST test identity'
token=$(curl -fsS "$API_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$email\",\"password\":\"$password\"}" | jq -r '.access_token')

echo 'creating REST test task'
task_id=$(curl -fsS "$REST_URL/tasks" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H 'Content-Type: application/json' -H 'Prefer: return=representation' \
  -d "{\"title\":\"REST permission fixture\",\"status\":\"new_request\",\"priority\":\"normal\",\"requester_id\":\"$user_id\"}" | jq -r '.[0].id')

safe_status=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "$REST_URL/tasks?id=eq.$task_id" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $token" \
  -H 'Content-Type: application/json' -d '{"title":"REST safe edit"}')
[[ "$safe_status" == "204" ]]

sensitive_status=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "$REST_URL/tasks?id=eq.$task_id" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $token" \
  -H 'Content-Type: application/json' -d "{\"assignee_id\":\"$user_id\"}")
[[ "$sensitive_status" == "401" || "$sensitive_status" == "403" ]]

anon_status=$(curl -sS -o /dev/null -w '%{http_code}' "$REST_URL/tasks?select=id&limit=1" -H "apikey: $ANON_KEY")
[[ "$anon_status" == "401" || "$anon_status" == "403" ]]

curl -fsS -X DELETE "$REST_URL/tasks?id=eq.$task_id" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" >/dev/null
curl -fsS -X DELETE "$API_URL/auth/v1/admin/users/$user_id" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" >/dev/null
echo 'direct REST permission checks passed'
