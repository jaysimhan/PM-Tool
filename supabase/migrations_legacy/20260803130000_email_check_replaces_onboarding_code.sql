-- Step 1 asks the database a question instead of mailing a code.
--
-- The one-time code is parked. It was doing two jobs -- proving the visitor reads mail at the
-- address, and refusing addresses nobody approved -- and it was only ever the first of those
-- that needed mail. The refusal is a fact the database already holds, so step 1 now reads it
-- directly: an address gets past the first screen if there is an account behind it waiting for
-- a password, and is sent to the sign-in page if there is not.
--
--   invitee       an admin approved them and the account has never been set up. Straight on to
--                 the password screen.
--   member        setup is behind them. Nothing here to do -- they want to sign in.
--   deactivated
--   deleted       an account, but not a usable one. Sign-in page, where reactivation is asked
--                 for.
--   unknown       no account. Sign-in page, where Request access is.
--
-- What this gives up, and it is worth writing down: the screen now answers "does this address
-- have an account here, and has it been set up" to anyone who asks, and /welcome is public. The
-- code deliberately refused to answer that -- every address got the same reply and no code
-- arrived for the ones nobody had approved. This is a decision to trade that property for a
-- setup flow that does not depend on mail arriving. Nothing beyond the status is returned: no
-- name, no role, no team.
--
-- Also note this is the fifth function `anon` may execute; the four named in
-- 20260802170000_lock_down_data_api.sql were all of them until now.

-- ---------------------------------------------------------------------------------------
-- 1. The classification, once.
--
-- Two callers need it and they must agree: the screen, to decide where to send somebody, and
-- the onboarding-claim Edge Function, to decide whether it may set a password. If they ever
-- disagreed, the screen would offer a password box the function then refuses. So they read the
-- same function, and this one hands back the id as well because the claim needs something to
-- act on.
--
-- Matching is lower(email) equality, like everywhere else in this schema. Doing it in the Data
-- API instead would mean `ilike`, and `_` is a wildcard there -- ordinary in an address, and it
-- would let one address match another account's row.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.onboarding_account_state(p_email text)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER STABLE
    SET search_path TO ''
    AS $$
DECLARE
    v_email text := lower(nullif(btrim(p_email), ''));
    v_user public.users;
BEGIN
    IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$' THEN
        RAISE EXCEPTION 'A valid email address is required.';
    END IF;

    -- deleted_email as well as email: deleting an account moves the address aside, and the
    -- address the person types is the one they always had.
    SELECT * INTO v_user FROM public.users u
    WHERE lower(u.email) = v_email OR lower(u.deleted_email) = v_email
    LIMIT 1;

    IF v_user.id IS NULL THEN
        RETURN jsonb_build_object('status', 'unknown');
    END IF;

    IF v_user.deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'deleted', 'user_id', v_user.id);
    END IF;

    IF NOT v_user.is_active THEN
        RETURN jsonb_build_object('status', 'deactivated', 'user_id', v_user.id);
    END IF;

    IF v_user.onboarding_completed THEN
        RETURN jsonb_build_object('status', 'member', 'user_id', v_user.id);
    END IF;

    -- A profile row with no auth identity behind it cannot have a password set on it, so it is
    -- not an invitation waiting to be claimed however much it looks like one. Rare, and only
    -- reachable by removing an auth user without its profile, but 'invitee' here would send
    -- somebody to a password screen that could never work.
    IF NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = v_user.id) THEN
        RETURN jsonb_build_object('status', 'unknown');
    END IF;

    RETURN jsonb_build_object('status', 'invitee', 'user_id', v_user.id);
END;
$$;

-- The id is nobody's business but the claim's, and the claim runs under the service role.
REVOKE ALL ON FUNCTION public.onboarding_account_state(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.onboarding_account_state(text) TO service_role;

-- ---------------------------------------------------------------------------------------
-- 2. What the screen may ask.
--
-- The status and nothing else. Same answer as above with the id taken off, so there is no
-- second copy of the rule to drift.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.onboarding_email_status(p_email text)
    RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER STABLE
    SET search_path TO ''
    AS $$
    SELECT jsonb_build_object('status', public.onboarding_account_state(p_email) ->> 'status');
$$;

REVOKE ALL ON FUNCTION public.onboarding_email_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_email_status(text) TO anon, authenticated;
