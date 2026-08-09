-- Onboarding needs a way to tell "invited, hasn't set up their account yet" from
-- "fully set up". It used to infer that from the absence of a public.users row, but
-- the on_auth_user_created trigger creates that row the moment the invite is issued --
-- before the invitee has even clicked the link -- so the profile was always there and
-- the setup screens were always skipped. Make the state explicit instead.

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false;

-- Everyone who already has a password has been through login on their own and is set
-- up; an invitee who never finished has no password yet. That is the precise signal,
-- and this project authenticates by password only, so nobody legitimate lacks one.
UPDATE public.users u
SET onboarding_completed = true
WHERE EXISTS (
    SELECT 1 FROM auth.users a
    WHERE a.id = u.id
      AND COALESCE(a.encrypted_password, '') <> ''
);

-- New auth identities start un-onboarded. Also read 'name' from the invite metadata:
-- the app sends 'name', so invitees were all landing with their email as their name.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
    INSERT INTO public.users (id, name, email, role, daily_capacity, is_active, onboarding_completed)
    VALUES (
        new.id,
        COALESCE(
            NULLIF(new.raw_user_meta_data->>'name', ''),
            NULLIF(new.raw_user_meta_data->>'full_name', ''),
            new.email
        ),
        new.email,
        'requester',
        8,
        true,
        false
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN new;
END;
$$;
