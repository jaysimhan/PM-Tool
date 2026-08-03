// Inviting somebody, without shipping the keys to the kingdom to do it.
//
// inviteUserByEmail and generateLink are admin endpoints: they need the service role key, and
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where the invitee lands. An invite link is a bearer credential -- follow it and you are
 * signed in as that address -- so a caller does not get to aim it at a host of their choosing.
 * The path is fixed here, and the origin has to be one we allow: whatever is in
 * ALLOWED_REDIRECT_ORIGINS, or localhost when that is unset for local development.
 *
 * GoTrue independently refuses any redirect that is not on the project's Redirect URLs list,
 * so this is the second lock rather than the only one.
 */
function resolveRedirect(requested: unknown): { url: string } | { error: string } {
    const configured = (Deno.env.get('ALLOWED_REDIRECT_ORIGINS') ?? '')
        .split(',')
        .map((o) => o.trim().replace(/\/$/, ''))
        .filter(Boolean);

    if (typeof requested !== 'string' || !requested) return { error: 'missing_redirect' };

    let parsed: URL;
    try {
        parsed = new URL(requested);
    } catch {
        return { error: 'invalid_redirect' };
    }

    const origin = parsed.origin.replace(/\/$/, '');
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const allowed = configured.length > 0 ? configured.includes(origin) || isLocal : isLocal;

    // Unset ALLOWED_REDIRECT_ORIGINS leaves localhost as the only permitted origin, which is the
    // right default -- but it means every invite from the deployed site is refused while every
    // invite from a dev machine works, and the two are indistinguishable under one error code.
    // That cost us a round of "invites are broken and the logs just say not allowed", so the
    // empty list gets to say it is empty. Nothing is permitted that was not permitted before.
    if (!allowed && configured.length === 0) return { error: 'redirect_not_configured' };
    if (!allowed) return { error: 'redirect_not_allowed' };
    if (parsed.protocol !== 'https:' && !isLocal) return { error: 'redirect_not_https' };

    // Onboarding is the only place an invite has ever needed to land.
    return { url: `${origin}/welcome` };
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) return json({ error: 'not_signed_in' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Two clients on purpose: one to find out who is asking, one to act.
    const asCaller = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
    });
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const { data: caller, error: callerError } = await asCaller.auth.getUser();
    if (callerError || !caller?.user) return json({ error: 'not_signed_in' }, 401);

    const { data: profile, error: profileError } = await admin
        .from('users')
        .select('id, role, is_active, deleted_at')
        .eq('id', caller.user.id)
        .maybeSingle();

    if (profileError) return json({ error: 'lookup_failed', detail: profileError.message }, 500);
    if (!profile || profile.is_active === false || profile.deleted_at) {
        return json({ error: 'account_not_active' }, 403);
    }

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'invalid_json' }, 400);
    }

    const action = body.action === 'setup-link' ? 'setup-link' : 'invite';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    const teamId = typeof body.teamId === 'string' && UUID_RE.test(body.teamId) ? body.teamId : null;

    if (!EMAIL_RE.test(email)) return json({ error: 'invalid_email' }, 400);

    const isAdmin = profile.role === 'super_admin' || profile.role === 'admin';
    if (!isAdmin) {
        // A leader may only invite into their own team, so an invite with no team attached --
        // which is what the access-request queue sends -- is out of their reach entirely.
        if (profile.role !== 'team_leader') return json({ error: 'not_allowed' }, 403);
        if (!teamId) return json({ error: 'team_required' }, 403);

        const { data: membership, error: membershipError } = await admin
            .from('team_members')
            .select('team_id')
            .eq('team_id', teamId)
            .eq('user_id', profile.id)
            .maybeSingle();

        if (membershipError) return json({ error: 'lookup_failed', detail: membershipError.message }, 500);
        if (!membership) return json({ error: 'not_your_team' }, 403);
    }

    const redirect = resolveRedirect(body.redirectTo);
    if ('error' in redirect) return json({ error: redirect.error }, 400);

    // The team rides along in user_metadata: team_members.user_id references public.users, and
    // an invitee has no row there until onboarding creates one, which is where this is applied.
    const metadata: Record<string, unknown> = {};
    if (name) metadata.name = name;
    if (teamId) metadata.team_id = teamId;

    if (action === 'setup-link') {
        // Their auth identity exists but they never finished setup, so an invite would be
        // refused as a duplicate. A magic link puts them back on the same screen.
        const { data, error } = await admin.auth.admin.generateLink({
            type: 'magiclink',
            email,
            options: { redirectTo: redirect.url },
        });
        if (error || !data?.user) {
            return json({ error: 'link_failed', detail: error?.message ?? 'unknown error' }, 502);
        }
        return json({ ok: true, userId: data.user.id, actionLink: data.properties?.action_link ?? null });
    }

    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: redirect.url,
        data: metadata,
    });

    if (invited?.user) {
        return json({ ok: true, sent: true, userId: invited.user.id, actionLink: null });
    }

    // Supabase only delivers invite mail once custom SMTP is configured. Mint the same link so
    // the admin can pass it on by hand instead of the invite being lost.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { redirectTo: redirect.url, data: metadata },
    });

    if (linkError || !link?.user) {
        return json(
            {
                error: 'invite_failed',
                detail: inviteError?.message ?? linkError?.message ?? 'unknown error',
            },
            502,
        );
    }

    return json({
        ok: true,
        sent: false,
        userId: link.user.id,
        actionLink: link.properties?.action_link ?? null,
    });
});
