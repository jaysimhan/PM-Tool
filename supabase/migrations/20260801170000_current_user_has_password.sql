-- Onboarding is two steps, and someone can close the tab between them. To put them back
-- where they stopped rather than at the start, the screen has to know whether step 1 is
-- already done -- and the only honest answer to that lives in auth.users.encrypted_password,
-- which the client cannot read.
--
-- A user_metadata flag would be the cheap alternative, but it is client-writable and, more
-- to the point, absent for everyone who half-onboarded before this shipped. The password
-- itself is the fact; this exposes exactly that one bit about the caller and nothing else.
--
-- Why it matters beyond convenience: Supabase rejects updateUser() when the new password
-- matches the current one, so a returning invitee sent back through step 1 who types the
-- password they already chose gets an error and no way forward.

CREATE OR REPLACE FUNCTION public.current_user_has_password() RETURNS boolean
    LANGUAGE sql SECURITY DEFINER STABLE
    SET search_path TO ''
    AS $$
    SELECT COALESCE(a.encrypted_password, '') <> ''
    FROM auth.users a
    WHERE a.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.current_user_has_password() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_password() TO authenticated;
