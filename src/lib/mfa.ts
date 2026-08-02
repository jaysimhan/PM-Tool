// Everything the two 2FA screens need to agree on. Login and Security Settings both put a
// six-digit box in front of the user and both accept a recovery code instead, but they look
// nothing alike -- so the shared part is the behaviour, not the markup.

import { supabase } from './supabaseClient';

export interface RecoveryCodeStatus {
    total: number;
    unused: number;
    generatedAt: string | null;
}

/** The enrolled authenticator, or null if there isn't one. */
export async function getVerifiedTotpFactor() {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;
    return data.all.find(f => f.factor_type === 'totp' && f.status === 'verified') ?? null;
}

/**
 * Trade six digits for an aal2 session. Throws with GoTrue's own message on a wrong code,
 * which is already the right thing to show someone.
 */
export async function verifyTotpCode(code: string) {
    const factor = await getVerifiedTotpFactor();
    if (!factor) throw new Error('No authenticator app is set up on this account.');

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id });
    if (challengeError) throw challengeError;

    const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.id,
        code,
    });
    if (verifyError) throw verifyError;
}

/**
 * Spend a recovery code. This does not get past the authenticator -- it removes it, which is
 * the only thing that can be done without GoTrue's cooperation, and leaves the account with
 * 2FA switched off until it is set up again.
 *
 * The session is refreshed on the way out: the token in hand still lists the factor that was
 * just deleted, and until it is reissued the app goes on believing a code is owed.
 */
export async function redeemRecoveryCode(code: string) {
    const { data, error } = await supabase.rpc('redeem_mfa_recovery_code', { p_code: code });
    if (error) throw error;
    if (!data?.ok) throw new Error('That recovery code is not valid, or has already been used.');

    await supabase.auth.refreshSession();
    return (data.factorsRemoved ?? 0) as number;
}

/** Ten fresh codes, in the clear, this once. Any previous set stops working. */
export async function generateRecoveryCodes(): Promise<string[]> {
    const { data, error } = await supabase.rpc('generate_mfa_recovery_codes');
    if (error) throw error;
    return (data ?? []) as string[];
}

export async function getRecoveryCodeStatus(): Promise<RecoveryCodeStatus> {
    const { data, error } = await supabase.rpc('my_mfa_recovery_code_status');
    if (error) throw error;
    return {
        total: data?.total ?? 0,
        unused: data?.unused ?? 0,
        generatedAt: data?.generatedAt ?? null,
    };
}

/** Confirms the caller's existing password without signing in again, which would cost the
 *  session its aal2 and send them back to the code prompt. */
export async function verifyCurrentPassword(password: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('verify_current_password', { p_password: password });
    if (error) throw error;
    return data === true;
}

/** What the user saves or prints. */
export function recoveryCodesAsText(codes: string[], email?: string | null) {
    return [
        'WorkFlow Pro — two-factor recovery codes',
        email ? `Account: ${email}` : null,
        `Generated: ${new Date().toLocaleString()}`,
        '',
        'Each code works once, and using one switches two-factor authentication off',
        'until you set it up again. Keep them somewhere other than your phone.',
        '',
        ...codes,
        '',
    ].filter(Boolean).join('\n');
}
