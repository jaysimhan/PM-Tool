import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Info, Loader2, Shield, ShieldCheck, ShieldAlert, KeyRound, Copy, Download, RefreshCw } from 'lucide-react';
import { ActiveSessions } from './ActiveSessions';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import {
    RecoveryCodeStatus,
    generateRecoveryCodes,
    getRecoveryCodeStatus,
    recoveryCodesAsText,
    redeemRecoveryCode,
    verifyCurrentPassword,
    verifyTotpCode,
} from '../lib/mfa';

export function SecuritySettings() {
    const navigate = useNavigate();
    const { user, mfaRequired, recoveryMode, clearRecoveryMode, checkMfa } = useAuth();

    // MFA state
    const [isMfaEnabled, setIsMfaEnabled] = useState(false);
    const [mfaLoading, setMfaLoading] = useState(false);
    const [mfaError, setMfaError] = useState<string | null>(null);
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [factorId, setFactorId] = useState<string | null>(null);
    const [verifyCode, setVerifyCode] = useState('');

    // Recovery codes. `freshCodes` is the one moment they exist in the clear -- once this
    // screen is left there is nothing but hashes, by design.
    const [freshCodes, setFreshCodes] = useState<string[] | null>(null);
    const [codeStatus, setCodeStatus] = useState<RecoveryCodeStatus | null>(null);
    const [codesLoading, setCodesLoading] = useState(false);

    // The challenge this screen puts up for itself when a reset link lands on an account
    // that has 2FA. Separate state from the enrolment box above, which is a different job.
    const [challengeCode, setChallengeCode] = useState('');
    const [challengeUsesRecovery, setChallengeUsesRecovery] = useState(false);
    const [challengeLoading, setChallengeLoading] = useState(false);
    const [challengeError, setChallengeError] = useState<string | null>(null);

    useEffect(() => {
        checkMfaStatus();
    }, []);

    const checkMfaStatus = async () => {
        try {
            const { data, error } = await supabase.auth.mfa.listFactors();
            if (error) throw error;
            const totp = data.all.find(f => f.factor_type === 'totp' && f.status === 'verified');
            setIsMfaEnabled(!!totp);
            setCodeStatus(totp ? await getRecoveryCodeStatus() : null);
        } catch (err) {
            console.error('Error checking MFA status:', err);
        }
    };

    const handleEnableMfa = async () => {
        setMfaLoading(true);
        setMfaError(null);
        try {
            const { data, error } = await supabase.auth.mfa.enroll({
                factorType: 'totp'
            });
            if (error) throw error;

            setFactorId(data.id);
            setQrCode(data.totp.qr_code);
        } catch (err: any) {
            setMfaError(err.message || 'Failed to enroll in 2FA');
        } finally {
            setMfaLoading(false);
        }
    };

    const handleVerifyMfa = async () => {
        if (!factorId || !verifyCode) return;
        setMfaLoading(true);
        setMfaError(null);
        try {
            const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
            if (challengeError) throw challengeError;

            const { error: verifyError } = await supabase.auth.mfa.verify({
                factorId,
                challengeId: challengeData.id,
                code: verifyCode
            });
            if (verifyError) throw verifyError;

            setIsMfaEnabled(true);
            setQrCode(null);
            setFactorId(null);
            setVerifyCode('');

            // Straight after enrolling, while the person is still here to write them down.
            // Handing out no codes at all is how an account becomes unreachable later.
            const codes = await generateRecoveryCodes();
            setFreshCodes(codes);
            setCodeStatus(await getRecoveryCodeStatus());
            await checkMfa();
        } catch (err: any) {
            setMfaError(err.message || 'Failed to verify 2FA code');
        } finally {
            setMfaLoading(false);
        }
    };

    const handleRegenerateCodes = async () => {
        setCodesLoading(true);
        setMfaError(null);
        try {
            const codes = await generateRecoveryCodes();
            setFreshCodes(codes);
            setCodeStatus(await getRecoveryCodeStatus());
            toast.success('New recovery codes generated. The old ones no longer work.');
        } catch (err: any) {
            setMfaError(err.message || 'Failed to generate recovery codes');
        } finally {
            setCodesLoading(false);
        }
    };

    const copyCodes = async (codes: string[]) => {
        try {
            await navigator.clipboard.writeText(codes.join('\n'));
            toast.success('Recovery codes copied.');
        } catch {
            toast.error('Could not copy. Select the codes and copy them by hand.');
        }
    };

    const downloadCodes = (codes: string[]) => {
        const blob = new Blob([recoveryCodesAsText(codes, user?.email)], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'workflow-pro-recovery-codes.txt';
        a.click();
        URL.revokeObjectURL(url);
    };

    // Only reachable on a reset link for an account with 2FA: prove the second factor before
    // the password can be rewritten, with the recovery code as the way through if the
    // authenticator is what went missing.
    const handleChallenge = async (e: React.FormEvent) => {
        e.preventDefault();
        setChallengeLoading(true);
        setChallengeError(null);
        try {
            if (challengeUsesRecovery) {
                await redeemRecoveryCode(challengeCode);
                toast.success('Two-factor authentication has been turned off. Set it up again below once your password is saved.');
            } else {
                await verifyTotpCode(challengeCode);
            }
            await checkMfa();
            await checkMfaStatus();
            setChallengeCode('');
        } catch (err: any) {
            setChallengeError(err.message || 'That code was not accepted.');
            setChallengeCode('');
        } finally {
            setChallengeLoading(false);
        }
    };

    const handleDisableMfa = async () => {
        setMfaLoading(true);
        setMfaError(null);
        try {
            const { data, error } = await supabase.auth.mfa.listFactors();
            if (error) throw error;

            const totp = data.all.find(f => f.factor_type === 'totp' && f.status === 'verified');
            if (totp) {
                const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: totp.id });
                if (unenrollError) throw unenrollError;
                setIsMfaEnabled(false);
                // The codes only ever unlocked that factor.
                setFreshCodes(null);
                setCodeStatus(null);
                await checkMfa();
            }
        } catch (err: any) {
            setMfaError(err.message || 'Failed to disable 2FA');
        } finally {
            setMfaLoading(false);
        }
    };

    // Password state
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [retypePassword, setRetypePassword] = useState('');

    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showRetype, setShowRetype] = useState(false);

    const [showTooltip, setShowTooltip] = useState(false);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const calculateStrength = (pass: string) => {
        if (!pass) return 0;
        let score = 0;
        if (pass.length >= 8) score += 1;
        if (/[A-Z]/.test(pass)) score += 1;
        if (/[a-z]/.test(pass)) score += 1;
        if (/[0-9]/.test(pass)) score += 1;
        if (/[!@#$%^&*(),.?":{}|<>]/.test(pass)) score += 1;
        return score;
    };

    const strengthScore = useMemo(() => calculateStrength(newPassword), [newPassword]);

    const getStrengthDetails = (score: number) => {
        switch(score) {
            case 0: return { label: '', color: 'bg-gray-200', text: 'text-gray-500' };
            case 1: return { label: 'Very Weak', color: 'bg-red-500', text: 'text-red-500' };
            case 2: return { label: 'Weak', color: 'bg-orange-500', text: 'text-orange-500' };
            case 3: return { label: 'Fair', color: 'bg-yellow-500', text: 'text-yellow-600' };
            case 4: return { label: 'Good', color: 'bg-blue-500', text: 'text-blue-500' };
            case 5: return { label: 'Strong', color: 'bg-green-500', text: 'text-green-500' };
            default: return { label: '', color: 'bg-gray-200', text: 'text-gray-500' };
        }
    };

    const strengthDetails = getStrengthDetails(strengthScore);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (newPassword !== retypePassword) {
            setError("New passwords do not match.");
            return;
        }

        if (strengthScore < 5) {
            setError("Password does not meet all requirements.");
            return;
        }

        setLoading(true);
        setError(null);
        setSuccess(null);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.user?.email) throw new Error("No active session found.");

            // Someone who arrived on a reset link does not know the old password -- that is
            // the entire reason they are here. Everybody else proves it first, and proves it
            // against the stored hash rather than by signing in again: a password sign-in
            // mints a fresh aal1 session, which would throw away the 2FA this one has already
            // passed and bounce them back to the code prompt mid-save.
            if (!recoveryMode) {
                const passwordOk = await verifyCurrentPassword(currentPassword);
                if (!passwordOk) throw new Error("Incorrect current password.");
            }

            // Update to new password
            const { error: updateError } = await supabase.auth.updateUser({
                password: newPassword
            });
            if (updateError) throw updateError;

            setSuccess("Password updated successfully.");
            setCurrentPassword('');
            setNewPassword('');
            setRetypePassword('');
            clearRecoveryMode();

            setTimeout(() => {
                navigate('/');
            }, 2000);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // A reset link is the one way onto this screen without having passed 2FA, and an email
    // inbox on its own should not be enough to rewrite the password of an account that has a
    // second factor. So the screen asks for it here. Someone whose authenticator is what went
    // missing spends a recovery code instead and carries on to the form behind this.
    if (recoveryMode && mfaRequired) {
        const challengeReady = challengeUsesRecovery
            ? challengeCode.replace(/[^0-9a-zA-Z]/g, '').length >= 12
            : challengeCode.length === 6;

        return (
            <div className="min-h-screen bg-gray-50 py-12 px-4 flex justify-center font-sans">
                <div className="max-w-md w-full">
                    <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
                        <h1 className="text-xl font-bold text-gray-900 mb-1 flex items-center gap-2">
                            <Shield className="w-5 h-5" />
                            Two-Factor Authentication
                        </h1>
                        <p className="text-sm text-gray-500 mb-6">
                            This account has 2FA switched on. Confirm it before choosing a new password.
                        </p>

                        {challengeError && (
                            <div className="mb-4 bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm border border-red-100">
                                {challengeError}
                            </div>
                        )}

                        <form onSubmit={handleChallenge} className="space-y-4">
                            {challengeUsesRecovery && (
                                <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-sm">
                                    Using a recovery code switches two-factor authentication off. You can
                                    set it up again from this screen once your password is saved.
                                </div>
                            )}

                            <input
                                type="text"
                                required
                                autoFocus
                                autoComplete="one-time-code"
                                maxLength={challengeUsesRecovery ? 20 : 6}
                                placeholder={challengeUsesRecovery ? 'a1b2c3-d4e5f6' : '123456'}
                                value={challengeCode}
                                onChange={(e) => setChallengeCode(
                                    challengeUsesRecovery ? e.target.value : e.target.value.replace(/\D/g, '')
                                )}
                                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all tracking-widest font-mono text-center text-lg"
                            />

                            <button
                                type="submit"
                                disabled={challengeLoading || !challengeReady}
                                className="w-full px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                            >
                                {challengeLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                                Continue
                            </button>
                        </form>

                        <div className="mt-5 flex flex-col items-center gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setChallengeUsesRecovery(v => !v);
                                    setChallengeCode('');
                                    setChallengeError(null);
                                }}
                                className="text-sm font-medium text-blue-600 hover:underline"
                            >
                                {challengeUsesRecovery
                                    ? 'Use my authenticator app instead'
                                    : 'Lost your authenticator? Use a recovery code'}
                            </button>
                            <button
                                type="button"
                                onClick={() => { clearRecoveryMode(); navigate('/login'); }}
                                className="text-sm text-gray-500 hover:text-gray-700"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 py-12 px-4 flex justify-center font-sans">
            <div className="max-w-xl w-full space-y-6">
                <div className="flex items-center justify-between gap-4">
                    <h1 className="text-2xl font-bold text-gray-900">Security Settings</h1>
                    {/* Back to wherever they came from. This screen is also the landing page
                        for a password-reset link, where there is no history to go back to --
                        hence the fallback rather than a bare navigate(-1). */}
                    <button
                        type="button"
                        onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
                        className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 shadow-sm flex items-center gap-1.5"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Cancel
                    </button>
                </div>

                {/* Two-Factor Authentication */}
                <div className="bg-white md:p-8 md:rounded-xl md:shadow-sm md:border md:border-gray-200">
                    <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
                        <Shield className="w-5 h-5" />
                        Two-Factor Authentication
                    </h2>

                    {mfaError && (
                        <div className="mb-4 bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm border border-red-100">
                            {mfaError}
                        </div>
                    )}

                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-4">
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 flex flex-col gap-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="text-sm font-medium text-gray-900">
                                        Two-Factor Authentication (2FA)
                                    </h4>
                                    {isMfaEnabled ? (
                                        <span className="inline-flex whitespace-nowrap items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                            <ShieldCheck className="w-3 h-3" />
                                            Enabled
                                        </span>
                                    ) : (
                                        <span className="inline-flex whitespace-nowrap items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-600">
                                            <ShieldAlert className="w-3 h-3" />
                                            Disabled
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-gray-500">
                                    Secure your account with an Authenticator app (like Google Authenticator).
                                </p>
                            </div>
                            {!qrCode && (
                                <button
                                    onClick={isMfaEnabled ? handleDisableMfa : handleEnableMfa}
                                    disabled={mfaLoading}
                                    className={`px-3 py-1.5 whitespace-nowrap flex-shrink-0 text-sm font-medium rounded-lg transition-colors border shadow-sm ${
                                        isMfaEnabled
                                            ? 'bg-white border-red-200 text-red-600 hover:bg-red-50'
                                            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                                    }`}
                                >
                                    {mfaLoading ? '...' : isMfaEnabled ? 'Disable 2FA' : 'Enable 2FA'}
                                </button>
                            )}
                        </div>

                        {qrCode && (
                            <div className="mt-4 pt-4 border-t border-gray-200">
                                <p className="text-sm text-gray-700 font-medium mb-3">Scan this QR Code in your Authenticator app:</p>
                                <div className="bg-white p-3 rounded-xl inline-block shadow-sm border border-gray-200">
                                    <img src={qrCode} alt="2FA QR Code" className="w-48 h-48 object-contain" />
                                </div>

                                <div className="mt-6">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Verification Code
                                    </label>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="text"
                                            maxLength={6}
                                            value={verifyCode}
                                            onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                                            placeholder="123456"
                                            className="block w-40 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 sm:text-sm tracking-widest font-mono text-center text-lg"
                                        />
                                        <button
                                            onClick={handleVerifyMfa}
                                            disabled={mfaLoading || verifyCode.length !== 6}
                                            className="px-6 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                        >
                                            {mfaLoading ? 'Verifying...' : 'Verify'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Recovery codes. Only meaningful once there is a factor to recover
                            from, so the whole block stays out of the way until then. */}
                        {isMfaEnabled && !qrCode && (
                            <div className="pt-4 border-t border-gray-200 space-y-3">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1">
                                        <h4 className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                                            <KeyRound className="w-4 h-4" />
                                            Recovery codes
                                        </h4>
                                        <p className="text-xs text-gray-500 mt-1">
                                            {codeStatus && codeStatus.total > 0
                                                ? `${codeStatus.unused} of ${codeStatus.total} still unused. Each one signs you in once if your authenticator is gone, and switches 2FA off when it is used.`
                                                : 'None saved. Without one, a lost authenticator locks you out of this account.'}
                                        </p>
                                    </div>
                                    <button
                                        onClick={handleRegenerateCodes}
                                        disabled={codesLoading}
                                        className="px-3 py-1.5 whitespace-nowrap flex-shrink-0 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                                    >
                                        {codesLoading
                                            ? <Loader2 className="w-4 h-4 animate-spin" />
                                            : <RefreshCw className="w-3.5 h-3.5" />}
                                        {codeStatus && codeStatus.total > 0 ? 'Regenerate' : 'Generate codes'}
                                    </button>
                                </div>

                                {freshCodes && (
                                    <div className="bg-white border border-amber-200 rounded-lg p-4">
                                        <p className="text-sm font-medium text-amber-800 mb-1">
                                            Save these now — this is the only time they are shown.
                                        </p>
                                        <p className="text-xs text-gray-500 mb-3">
                                            Only the hashes are kept, so nobody, including an admin, can read them
                                            back to you later. Keep them somewhere other than the phone with the
                                            authenticator on it.
                                        </p>
                                        <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm text-gray-800 mb-3">
                                            {freshCodes.map(code => <span key={code}>{code}</span>)}
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                onClick={() => copyCodes(freshCodes)}
                                                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
                                            >
                                                <Copy className="w-3.5 h-3.5" />
                                                Copy
                                            </button>
                                            <button
                                                onClick={() => downloadCodes(freshCodes)}
                                                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
                                            >
                                                <Download className="w-3.5 h-3.5" />
                                                Download
                                            </button>
                                            <button
                                                onClick={() => setFreshCodes(null)}
                                                className="px-3 py-1.5 text-sm font-medium rounded-lg text-gray-500 hover:text-gray-700"
                                            >
                                                I've saved them
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Change Password */}
                <div className="bg-white md:p-8 md:rounded-xl md:shadow-sm md:border md:border-gray-200">
                    <h2 className="text-lg font-semibold text-gray-900 mb-6">
                        Change Password
                    </h2>

                    <form onSubmit={handleSubmit} className="space-y-5">
                        {error && (
                            <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm border border-red-100">
                                {error}
                            </div>
                        )}
                        {success && (
                            <div className="bg-green-50 text-green-700 px-4 py-3 rounded-lg text-sm border border-green-100">
                                {success}
                            </div>
                        )}

                        {/* Current Password. Not asked for on a reset link -- not knowing it is
                            what sent them to their email in the first place. Left out of the
                            DOM entirely rather than hidden, so `required` cannot block a submit
                            on a field nobody can see. */}
                        {recoveryMode ? (
                            <div className="bg-blue-50 text-blue-800 px-4 py-3 rounded-lg text-sm border border-blue-100">
                                You followed a password reset link, so there is no need to enter your
                                old password. Choose a new one below.
                            </div>
                        ) : (
                            <div className="space-y-1">
                                <label className="block text-sm font-medium text-gray-700">
                                    Current Password <span className="text-gray-500">*</span>
                                </label>
                                {/* Declared, like the two below it. An undeclared password box is
                                    one a browser fills on its own guess about what the form is,
                                    and a set of boxes filled as one group is a set it then keeps
                                    in step -- which is how a character typed into a new-password
                                    field turns up in the retype field as well. current-password
                                    here is the one that should be offered from the manager. */}
                                <div className="relative">
                                    <input
                                        type={showCurrent ? "text" : "password"}
                                        required
                                        name="current-password"
                                        autoComplete="current-password"
                                        value={currentPassword}
                                        onChange={(e) => setCurrentPassword(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowCurrent(!showCurrent)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 rounded-md"
                                    >
                                        {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* New Password */}
                        <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                                <label className="block text-sm font-medium text-gray-700">
                                    New Password <span className="text-gray-500">*</span>
                                </label>
                                <div
                                    className="relative flex items-center"
                                    onMouseEnter={() => setShowTooltip(true)}
                                    onMouseLeave={() => setShowTooltip(false)}
                                    onClick={() => setShowTooltip(!showTooltip)}
                                >
                                    <Info className="w-4 h-4 text-gray-400 hover:text-gray-500 cursor-help transition-colors" />

                                    {showTooltip && (
                                        <div className="absolute left-6 top-1/2 -translate-y-1/2 w-[300px] bg-white border border-gray-200 shadow-xl rounded-xl p-4 z-50 text-sm text-gray-700">
                                            <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-l border-b border-gray-200 transform rotate-45" />
                                            <div className="relative z-10">
                                                <p className="font-semibold text-gray-900 mb-2 leading-snug">
                                                    Your password should have atleast 8 characters containing a minimum of :
                                                </p>
                                                <ol className="space-y-1 text-gray-600 text-[13px]">
                                                    <li>1. 1 Upper case letter (A-Z)</li>
                                                    <li>2. 1 small case letter (a-z)</li>
                                                    <li>3. 1 numerical character (0..9)</li>
                                                    <li>4. 1 special character(s)(#,$,@...)</li>
                                                </ol>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="relative">
                                <input
                                    type={showNew ? "text" : "password"}
                                    required
                                    name="new-password"
                                    autoComplete="new-password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowNew(!showNew)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 rounded-md"
                                >
                                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>

                            {/* Password Strength Meter */}
                            {newPassword.length > 0 && (
                                <div className="pt-1 space-y-1">
                                    <div className="flex gap-1 h-1.5 w-full">
                                        {[1, 2, 3, 4, 5].map((level) => (
                                            <div
                                                key={level}
                                                className={`h-full flex-1 rounded-full ${strengthScore >= level ? strengthDetails.color : 'bg-gray-200'} transition-colors duration-300`}
                                            />
                                        ))}
                                    </div>
                                    <p className={`text-xs font-medium text-right ${strengthDetails.text}`}>
                                        {strengthDetails.label}
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Retype New Password */}
                        <div className="space-y-1">
                            <label className="block text-sm font-medium text-gray-700">
                                Retype New Password <span className="text-gray-500">*</span>
                            </label>
                            <div className="relative">
                                <input
                                    type={showRetype ? "text" : "password"}
                                    required
                                    name="confirm-password"
                                    autoComplete="new-password"
                                    value={retypePassword}
                                    onChange={(e) => setRetypePassword(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowRetype(!showRetype)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 rounded-md"
                                >
                                    {showRetype ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        <div className="pt-2 flex justify-end">
                            <button
                                type="submit"
                                disabled={loading || (!recoveryMode && !currentPassword) || !newPassword || !retypePassword || strengthScore < 5}
                                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                            >
                                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'SAVE'}
                            </button>
                        </div>
                    </form>
                </div>

                <ActiveSessions />
            </div>
        </div>
    );
}
