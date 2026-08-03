// Setting the first password on an account that nobody is signed in to.
//
// With the one-time code parked, /welcome has no session to work with: somebody who opens the
// shared link and types the address they were approved under is, as far as GoTrue is concerned,
// a stranger. `updateUser` needs a session, and there is none, so the password has to be set by
// something holding the service role -- which is this, and not the browser.
//
// The rule it enforces is the whole of the authorisation now:
//
//   there is a public.users row for this address, it is active, and onboarding_completed is
//   false -- an account an admin created and nobody has ever set up.
//
// Anything else is refused: a member has a password already and wants the sign-in page, and an
// address with no row was never approved by anyone.
//
// Be clear-eyed about what that means. Between an admin inviting somebody and that person
// finishing setup, their address is the only thing standing between a stranger and their
// account -- knowing it is enough to set the password and walk in as them. The one-time code
// was precisely the thing that closed that window, and parking it opens it. The window is
// narrow (un-onboarded invitees only, and it shuts the moment they finish) but it is real, and
// re-introducing the code is what closes it again.
//
// After this returns, the browser signs in with the password it just set. That is what produces
// the session that complete_onboarding_step_one() then runs under.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The same four classes and the same length the password box on /welcome insists on. The UI
 * disables its own button until they are met; a request that skips the UI does not get an
 * easier password than the person sitting in front of it was given.
 */
function passwordIsWeak(password: string): boolean {
    return (
        password.length < 8
        || !/[A-Z]/.test(password)
        || !/[a-z]/.test(password)
        || !/[0-9]/.test(password)
        || !/[!@#$%^&*(),.?":{}|<>]/.test(password)
    );
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'invalid_json' }, 400);
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!EMAIL_RE.test(email)) return json({ error: 'invalid_email' }, 400);
    if (passwordIsWeak(password)) return json({ error: 'weak_password' }, 400);

    const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false } },
    );

    // The same call the screen made to decide it could show a password box at all, so the two
    // cannot disagree about who is an invitee. It also confirms the auth identity exists, which
    // is the thing a password actually goes on.
    const { data: state, error: lookupError } = await admin.rpc('onboarding_account_state', {
        p_email: email,
    });

    if (lookupError) return json({ error: 'lookup_failed', detail: lookupError.message }, 500);

    const status = (state as { status?: string } | null)?.status;
    const userId = (state as { user_id?: string } | null)?.user_id;

    if (status === 'member') return json({ error: 'already_set_up' }, 409);
    if (status === 'deleted' || status === 'deactivated') return json({ error: 'account_not_active' }, 403);
    if (status !== 'invitee' || !userId) return json({ error: 'not_invited' }, 403);

    const { data: identity, error: identityError } = await admin.auth.admin.getUserById(userId);
    if (identityError || !identity?.user) return json({ error: 'not_invited' }, 403);

    // email_confirm as well as the password: an invited address is unconfirmed until the invite
    // link is followed, and nobody followed one. Without this, signing in with the password we
    // just set is refused as an unconfirmed email -- and the address has in any case just been
    // shown to be one an admin chose to invite.
    //
    // The name rides in user_metadata, where an invite already puts it, and is merged onto what
    // is there rather than sent alone -- a bare { name } would take the invite's team_id with it,
    // and that team is where step 1 is about to put them.
    const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        ...(name ? { user_metadata: { ...(identity.user.user_metadata ?? {}), name } } : {}),
    });

    if (updateError) return json({ error: 'password_failed', detail: updateError.message }, 502);

    return json({ ok: true });
});
