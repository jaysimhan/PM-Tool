// The "Send Confirmation Email" toggle in Share Request Form, made real.
//
// Postgres cannot send mail, and the public form's submitter is anonymous, so the send is
// triggered from the browser right after submit_public_request() returns. That would be an
// open relay if the caller got to choose the recipient or the body, so it chooses neither:
// it passes a submission id and the share token, and everything that ends up in the email
// is read back out of the database under the service role. The worst an attacker can do
// with a stolen (submissionId, token) pair is deliver one email that was already owed to
// the address that submitted the request -- confirmation_sent_at makes it exactly one.
//
// Delivery goes through Resend. With no RESEND_API_KEY set the function says so (501,
// 'email_not_configured') instead of reporting a success it did not achieve; the share
// modal reads that back through {action:'status'} and refuses to arm the toggle until the
// key exists. Set it with:
//   supabase secrets set RESEND_API_KEY=re_...
//   supabase secrets set REQUEST_CONFIRMATION_FROM="Marketing Requests <requests@yourdomain.com>"
// The From address must be on a domain verified in Resend; the default below is Resend's
// own sandbox sender, which only delivers to the address that owns the Resend account.

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

const escapeHtml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const formatDate = (value: string | null) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const apiKey = Deno.env.get('RESEND_API_KEY');
    const fromAddress = Deno.env.get('REQUEST_CONFIRMATION_FROM') ?? 'onboarding@resend.dev';
    const replyTo = Deno.env.get('REQUEST_CONFIRMATION_REPLY_TO') ?? undefined;

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'invalid_json' }, 400);
    }

    // What the share modal asks before it lets an admin turn the toggle on.
    if (body.action === 'status') {
        return json({ configured: Boolean(apiKey), from: apiKey ? fromAddress : null });
    }

    const submissionId = typeof body.submissionId === 'string' ? body.submissionId : null;
    const token = typeof body.token === 'string' ? body.token : null;
    if (!submissionId || !token) return json({ error: 'missing_submission_or_token' }, 400);

    const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false } },
    );

    const { data: submission, error: submissionError } = await admin
        .from('request_form_submissions')
        .select('id, link_id, task_id, requester_name, requester_email, request_ref, confirmation_sent_at')
        .eq('id', submissionId)
        .maybeSingle();

    if (submissionError) return json({ error: 'lookup_failed', detail: submissionError.message }, 500);
    if (!submission) return json({ error: 'submission_not_found' }, 404);
    if (submission.confirmation_sent_at) return json({ ok: true, alreadySent: true });

    // The token is what proves the caller submitted through this link, so it has to match
    // the link the submission was actually recorded against.
    const { data: link, error: linkError } = await admin
        .from('request_form_links')
        .select('id, token, send_confirmation')
        .eq('id', submission.link_id)
        .maybeSingle();

    if (linkError) return json({ error: 'lookup_failed', detail: linkError.message }, 500);
    if (!link || link.token !== token) return json({ error: 'token_mismatch' }, 403);
    if (!link.send_confirmation) return json({ ok: false, skipped: 'confirmation_disabled' });

    if (!apiKey) {
        await admin
            .from('request_form_submissions')
            .update({ confirmation_error: 'RESEND_API_KEY is not set on the send-request-confirmation function.' })
            .eq('id', submission.id);
        return json({ error: 'email_not_configured' }, 501);
    }

    const { data: task } = await admin
        .from('tasks')
        .select('title, due_date, priority')
        .eq('id', submission.task_id)
        .maybeSingle();

    const title = task?.title ?? 'your request';
    const dueDate = formatDate(task?.due_date ?? null);
    const priority = task?.priority ?? 'normal';
    const firstName = submission.requester_name.split(' ')[0] || submission.requester_name;

    const lines = [
        `Hi ${firstName},`,
        '',
        `We've received your request and it's now in the marketing team's queue.`,
        '',
        `Reference: ${submission.request_ref}`,
        `Request: ${title}`,
        dueDate ? `Requested by: ${dueDate}` : null,
        `Priority: ${priority}`,
        '',
        `Someone from the team will review it and confirm the timeline with you. Please keep`,
        `the reference above if you need to follow up.`,
        '',
        'Thanks,',
        'Marketing Team',
    ].filter((line) => line !== null) as string[];

    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#111827;line-height:1.6">
  <p>Hi ${escapeHtml(firstName)},</p>
  <p>We've received your request and it's now in the marketing team's queue.</p>
  <table style="border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Reference</td><td style="padding:4px 0"><strong>${escapeHtml(submission.request_ref)}</strong></td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Request</td><td style="padding:4px 0">${escapeHtml(title)}</td></tr>
    ${dueDate ? `<tr><td style="padding:4px 16px 4px 0;color:#6b7280">Requested by</td><td style="padding:4px 0">${escapeHtml(dueDate)}</td></tr>` : ''}
    <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Priority</td><td style="padding:4px 0">${escapeHtml(priority)}</td></tr>
  </table>
  <p>Someone from the team will review it and confirm the timeline with you. Please keep the reference above if you need to follow up.</p>
  <p style="color:#6b7280">Thanks,<br/>Marketing Team</p>
</div>`;

    let providerResponse: Response;
    try {
        providerResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: fromAddress,
                to: [submission.requester_email],
                subject: `We got your request (${submission.request_ref})`,
                text: lines.join('\n'),
                html,
                ...(replyTo ? { reply_to: replyTo } : {}),
            }),
        });
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        await admin
            .from('request_form_submissions')
            .update({ confirmation_error: `Could not reach Resend: ${detail}` })
            .eq('id', submission.id);
        return json({ error: 'provider_unreachable', detail }, 502);
    }

    if (!providerResponse.ok) {
        const detail = await providerResponse.text();
        await admin
            .from('request_form_submissions')
            .update({ confirmation_error: `Resend returned ${providerResponse.status}: ${detail}`.slice(0, 1000) })
            .eq('id', submission.id);
        return json({ error: 'provider_rejected', status: providerResponse.status, detail }, 502);
    }

    await admin
        .from('request_form_submissions')
        .update({ confirmation_sent_at: new Date().toISOString(), confirmation_error: null })
        .eq('id', submission.id);

    return json({ ok: true, sent: true });
});
