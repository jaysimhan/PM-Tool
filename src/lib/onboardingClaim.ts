import { supabase } from './supabaseClient';

/**
 * The browser half of the onboarding-claim function.
 *
 * Step 1 of /welcome now establishes who somebody is by asking the database whether their
 * address is an un-onboarded invitee, which means there is no session by the time they reach
 * the password box -- and `auth.updateUser` needs one. So the password is set by the Edge
 * Function, which holds the service role key server-side and re-checks the same rule, and the
 * session comes afterwards from signing in with the password it just set.
 */

export type OnboardingEmailStatus =
    | 'invitee'
    | 'member'
    | 'deactivated'
    | 'deleted'
    | 'unknown';

/** Which of the five states an address is in. The only thing the screen is told about it. */
export async function checkOnboardingEmail(email: string): Promise<OnboardingEmailStatus> {
    const { data, error } = await supabase.rpc('onboarding_email_status', { p_email: email });
    if (error) throw new Error(error.message);

    const status = (data as { status?: string } | null)?.status;
    return (status ?? 'unknown') as OnboardingEmailStatus;
}

const messages: Record<string, string> = {
    invalid_email: 'That is not a valid email address.',
    weak_password: 'That password does not meet all the requirements.',
    not_invited:
        'That address has not been approved yet, so there is no account to set up. Ask an admin,'
        + ' or request access.',
    account_not_active:
        'That account is not active. Ask an admin to turn it back on, then set your password.',
    already_set_up:
        'That account is already set up, so it has a password. Sign in with it instead — or use'
        + ' "Forgot password?" if you cannot remember it.',
};

function describe(error: unknown, payload: unknown): string {
    const code = (payload as { error?: string } | null)?.error;
    if (code && messages[code]) return messages[code];
    const detail = (payload as { detail?: string } | null)?.detail;
    if (detail) return detail;
    if (code) return code.replace(/_/g, ' ');
    if (error instanceof Error) return error.message;
    return 'Could not set your password.';
}

/**
 * Sets the first password on an approved-but-unclaimed account. Does not sign anybody in --
 * the caller does that with the password it passed in.
 */
export async function claimInviteeAccount(params: {
    email: string;
    name: string;
    password: string;
}): Promise<void> {
    const { data, error } = await supabase.functions.invoke('onboarding-claim', {
        body: { email: params.email, name: params.name, password: params.password },
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
}
