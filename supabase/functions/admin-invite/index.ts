// Inviting somebody, without shipping the keys to the kingdom to do it.
//
// Creating Auth users and issuing onboarding credentials need the service role key, and
// the service role key bypasses every policy in the database and can mint a session for any
// account. Team Management used to call them straight from the browser, which meant that key
// was in the JavaScript bundle -- readable by anyone who loaded the page, signed in or not.
//
// So the key stays here, on the server, and the browser asks this function instead. The
// request carries the caller's own access token, and the function decides for itself whether
// that person may invite anyone:
//
//   super_admin / admin   any invite, with or without a team
//   team_leader           only into a team they are a member of
//   everyone else         no
//
// which is the same rule the UI draws its buttons from (canManageTeam in TeamManagement).
// Deciding it here is what makes it a rule rather than a suggestion.
//
// Nothing about the *caller* is taken from the request body -- only the email being invited.
// The token identifies them, and their role comes out of the database under the service role.

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

const deny = (reason: string, status: number) => {
    console.warn(JSON.stringify({ event: 'edge_authorization_denied', function: 'admin-invite', reason, status }));
    return json({ error: reason }, status);
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CREDENTIAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** High entropy, readable, and guaranteed to satisfy the permanent-password character rules. */
function temporaryPassword(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    const random = Array.from(bytes, (byte) => CREDENTIAL_ALPHABET[byte % CREDENTIAL_ALPHABET.length]).join('');
    return `T!7a-${random}`;
}

/** Never returned. It prevents the Auth account itself from using the temporary credential. */
function unreachableAuthPassword(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return `R!8z-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) return deny('not_signed_in', 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Two clients on purpose: one to find out who is asking, one to act.
    const asCaller = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
    });
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const { data: caller, error: callerError } = await asCaller.auth.getUser();
    if (callerError || !caller?.user) return deny('not_signed_in', 401);

    const { data: profile, error: profileError } = await admin
        .from('users')
        .select('id, role, is_active, deleted_at')
        .eq('id', caller.user.id)
        .maybeSingle();

    if (profileError) return json({ error: 'lookup_failed', detail: profileError.message }, 500);
    if (!profile || profile.is_active === false || profile.deleted_at) {
        return deny('account_not_active', 403);
    }

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'invalid_json' }, 400);
    }

    const action = body.action === 'setup-password' ? 'setup-password' : 'invite';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    const teamId = typeof body.teamId === 'string' && UUID_RE.test(body.teamId) ? body.teamId : null;

    if (!EMAIL_RE.test(email)) return json({ error: 'invalid_email' }, 400);

    const isAdmin = profile.role === 'super_admin' || profile.role === 'admin';
    if (action === 'setup-password' && !isAdmin) return deny('not_allowed', 403);
    if (!isAdmin) {
        // A leader may only invite into their own team, so an invite with no team attached --
        // which is what the access-request queue sends -- is out of their reach entirely.
        if (profile.role !== 'team_leader') return deny('not_allowed', 403);
        if (!teamId) return deny('team_required', 403);

        const { data: membership, error: membershipError } = await admin
            .from('team_members')
            .select('team_id')
            .eq('team_id', teamId)
            .eq('user_id', profile.id)
            .maybeSingle();

        if (membershipError) return json({ error: 'lookup_failed', detail: membershipError.message }, 500);
        if (!membership) return deny('not_your_team', 403);
    }

    // The team rides along in user_metadata: team_members.user_id references public.users, and
    // an invitee has no row there until onboarding creates one, which is where this is applied.
    const metadata: Record<string, unknown> = {};
    if (name) metadata.name = name;
    if (teamId) metadata.team_id = teamId;

    let userId: string;

    if (action === 'setup-password') {
        const { data: existing, error: existingError } = await admin
            .from('users')
            .select('id, onboarding_completed, is_active, deleted_at')
            .ilike('email', email)
            .maybeSingle();
        if (existingError) return json({ error: 'lookup_failed', detail: existingError.message }, 500);
        if (!existing || existing.onboarding_completed || !existing.is_active || existing.deleted_at) {
            return json({ error: 'not_waiting_for_setup' }, 409);
        }
        userId = existing.id;

        // Invalidate any password that may have been set during an abandoned setup attempt.
        const { error: rotateError } = await admin.auth.admin.updateUserById(userId, {
            password: unreachableAuthPassword(),
        });
        if (rotateError) return json({ error: 'credential_failed', detail: rotateError.message }, 502);
    } else {
        const { data: created, error: createError } = await admin.auth.admin.createUser({
            email,
            password: unreachableAuthPassword(),
            email_confirm: true,
            user_metadata: metadata,
        });
        if (createError || !created?.user) {
            return json({ error: 'invite_failed', detail: createError?.message ?? 'unknown error' }, 502);
        }
        userId = created.user.id;

        // The Auth trigger normally creates this row in the same transaction. Keep the Edge
        // Function resilient to a missing/disabled trigger without overwriting a row it did
        // create: the credential RPC intentionally refuses an identity that is not an invitee.
        const { error: profileInsertError } = await admin.from('users').upsert({
            id: userId,
            name: name || email,
            email,
            role: 'invitee',
            daily_capacity: 8,
            is_active: true,
            onboarding_completed: false,
        }, { onConflict: 'id', ignoreDuplicates: true });
        if (profileInsertError) {
            await admin.auth.admin.deleteUser(userId);
            return json({ error: 'invite_failed', detail: profileInsertError.message }, 502);
        }
    }

    const credential = temporaryPassword();
    const { data: issued, error: issueError } = await admin.rpc('issue_onboarding_temp_password', {
        p_user_id: userId,
        p_temp_password: credential,
        p_generated_by: profile.id,
    });
    if (issueError || !issued?.ok) {
        // A new identity without a usable credential is misleading and blocks a retry by email.
        if (action === 'invite') await admin.auth.admin.deleteUser(userId);
        return json({ error: 'credential_failed', detail: issueError?.message ?? 'unknown error' }, 502);
    }

    return json({
        ok: true,
        sent: false,
        userId,
        temporaryPassword: credential,
        expiresAt: issued.expiresAt,
    });
});
