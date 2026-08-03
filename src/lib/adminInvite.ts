import { supabase } from './supabaseClient';

/**
 * The browser half of the admin-invite function.
 *
 * Inviting somebody needs the service role key, and that key can read every table and sign in
 * as anyone, so it does not belong in a bundle the whole internet can download. These calls go
 * to an Edge Function that holds the key server-side and re-checks the caller's role there --
 * the buttons in Team Management decide what to show, but the function decides what happens.
 */

export interface InviteResult {
    /** Supabase delivered the mail itself. False means there is a link to pass on by hand. */
    sent: boolean;
    /** Present when the mail could not be sent, or for a re-sent setup link. */
    actionLink: string | null;
    userId: string | null;
}

const messages: Record<string, string> = {
    not_signed_in: 'Your session has expired. Sign in again and retry.',
    account_not_active: 'Your account is not active.',
    not_allowed: 'You do not have permission to invite people.',
    team_required: 'Team leaders can only invite people into their own team.',
    not_your_team: 'You can only invite people into a team you belong to.',
    invalid_email: 'That is not a valid email address.',
    redirect_not_allowed: 'This site is not on the allowed redirect list for invites.',
    redirect_not_https: 'Invites can only be sent from a secure (https) site.',
};

/** Anything that comes back from the function unhappy, turned into one sentence. */
function describe(error: unknown, payload: unknown): string {
    const code = (payload as { error?: string } | null)?.error;
    if (code && messages[code]) return messages[code];
    const detail = (payload as { detail?: string } | null)?.detail;
    if (detail) return detail;
    if (code) return code.replace(/_/g, ' ');
    if (error instanceof Error) return error.message;
    return 'Unknown error';
}

async function call(body: Record<string, unknown>): Promise<InviteResult> {
    const { data, error } = await supabase.functions.invoke('admin-invite', {
        body: { ...body, redirectTo: `${window.location.origin}/welcome` },
    });

    // A non-2xx reply arrives as an error with the body attached, so the reason the function
    // gave has to be dug out of the response rather than reported as "non-2xx status code".
    if (error) {
        let payload: unknown = data;
        const response = (error as { context?: Response }).context;
        if (response && typeof response.json === 'function') {
            try {
                payload = await response.clone().json();
            } catch {
                /* Keep whatever data we already have. */
            }
        }
        throw new Error(describe(error, payload));
    }

    if (!data?.ok) throw new Error(describe(null, data));

    return {
        sent: Boolean(data.sent),
        actionLink: (data.actionLink as string | null) ?? null,
        userId: (data.userId as string | null) ?? null,
    };
}

/** A brand new person. `teamId` omitted means they pick their own team during onboarding. */
export const inviteUser = (params: { email: string; name?: string; teamId?: string | null }) =>
    call({ action: 'invite', email: params.email, name: params.name ?? '', teamId: params.teamId ?? null });

// There is no sendSetupLink any more. A setup link used to be minted per person and expired,
// which is what kept breaking between the mail going out and the person clicking it. The link
// is now one permanent public URL (/welcome) that grants nothing on its own -- what gets somebody
// in is the one-time code that page mails to an approved address. The Edge Function still
// implements the 'setup-link' action; nothing in the app asks for it.
