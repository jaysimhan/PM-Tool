# Deployment and rollback runbook

## Release gates

The release owner records approval for database backup/restore, migrations, Edge Functions, frontend smoke tests, and token rotation. Production changes require a tested staging copy and a named rollback operator.

Required frontend variables are `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; `VITE_OBSERVABILITY_ENDPOINT` is optional. Edge Function secrets include the project URL, service-role key, site URL, and configured email provider values. Never put service-role keys or temporary passwords in frontend variables.

## Order

1. Take and verify a production database backup.
2. Apply migrations in filename order to staging.
3. Deploy `admin-invite`, then `onboarding-claim`. The supported flow is email check → temporary password → password set; it does not use magic links or OTPs.
4. Run clean replay, database lint, role/RLS and concurrency tests, unit tests, build, and performance budgets.
5. Smoke-test onboarding, assignments, task edits/subtasks, cached public dashboard, public requests, and admin restrictions.
6. Apply the same versions to production and deploy the frontend.
7. Rotate public-dashboard and invitation credentials and invalidate superseded links.

## Baseline transition

Legacy migrations are retained in `supabase/migrations_legacy` for audit. Before the first production push from the squashed chain, compare `supabase migration list --linked`, mark archived versions reverted in migration history, and mark `20260809205000` applied. This changes history only; do it after backup and staging rehearsal. Never run the baseline SQL over the existing production schema.

## Rollback

Stop on any failed gate. Roll back frontend and Edge Functions to the prior artifact first. Database migrations are forward-repaired when safe; for destructive or incompatible failures, place the app in maintenance mode and restore the verified backup. Re-test authentication and RLS before reopening traffic. Rotate any credential that may have been exposed regardless of code rollback.

## Post-deployment checks

Verify login/logout/session expiry, temporary-password expiry (72 hours), one-time consumption and lockout; role visibility; assignment races; direct protected-column denial; subtask refresh/order; yesterday-only cached dashboard; notifications; sanitized monitoring; and mobile/keyboard focus paths.
