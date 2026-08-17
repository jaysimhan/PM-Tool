// Exchange an administrator-issued three-day temporary password for the invitee's permanent
// password. The database performs the hash comparison, expiry check, one-time consumption and
// rate limiting. This endpoint never accepts an email address as sufficient proof by itself.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const strongPassword = (password: string) =>
    password.length >= 8
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /[0-9]/.test(password)
    && /[!@#$%^&*(),.?":{}|<>]/.test(password);

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'invalid_request' }, 400);
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    // Trimmed like the email. The credential is copied out of a dialog and relayed through a chat
    // client, so it arrives with a trailing space often enough to matter, and a generated one holds
    // no whitespace of its own for this to eat. Trimmed here rather than only in the browser so it
    // is true of every caller, and before the hash comparison so the restore below re-issues the
    // same string the database just checked.
    const temporaryPassword = typeof body.temporaryPassword === 'string' ? body.temporaryPassword.trim() : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';

    if (!EMAIL_RE.test(email) || !temporaryPassword || !name || !strongPassword(newPassword)) {
        return json({ error: 'invalid_request' }, 400);
    }

    const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false } },
    );

    const { data: claim, error: claimError } = await admin.rpc('consume_onboarding_temp_password', {
        p_email: email,
        p_temp_password: temporaryPassword,
    });

    // Identical response for unknown email, wrong credential, expiry, reuse and temporary lock.
    if (claimError || !claim?.ok || !claim?.userId) {
        return json({ error: 'invalid_or_expired_temporary_password' }, 401);
    }

    const { data: existing } = await admin.auth.admin.getUserById(claim.userId);
    const currentMetadata = existing?.user?.user_metadata ?? {};
    const { error: updateError } = await admin.auth.admin.updateUserById(claim.userId, {
        password: newPassword,
        user_metadata: { ...currentMetadata, name },
    });

    if (updateError) {
        // Restore the same credential if Auth rejected the update after the atomic DB claim.
        // It remains hashed and receives a fresh three-day expiry rather than leaving the user
        // permanently stranded by a transient Auth failure.
        await admin.rpc('issue_onboarding_temp_password', {
            p_user_id: claim.userId,
            p_temp_password: temporaryPassword,
            p_generated_by: null,
        });
        return json({ error: 'password_update_failed' }, 502);
    }

    return json({
        ok: true,
        email: claim.email,
        teamId: claim.teamId ?? null,
    });
});
