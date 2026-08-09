-- Email addresses identify accounts; they do not prove control of those accounts.
-- The public status probe supported a retired flow that let a caller set an invitee's
-- password by supplying only that address. Onboarding now starts from Supabase's one-time
-- invite/magic-link session, so neither anonymous nor ordinary authenticated clients need
-- an account-enumeration function.

REVOKE ALL ON FUNCTION public.onboarding_email_status(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.onboarding_email_status(text) TO service_role;
