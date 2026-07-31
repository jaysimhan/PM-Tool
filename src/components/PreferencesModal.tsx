import React, { useState, useEffect } from 'react';
import { User } from '../types/types';
import { X, Save, User as UserIcon, Shield, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabaseClient';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    currentUser: User;
}

export function PreferencesModal({ isOpen, onClose, currentUser }: Props) {
    const { updateProfile } = useAuth();
    const [name, setName] = useState(currentUser.name || '');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // MFA State
    const [isMfaEnabled, setIsMfaEnabled] = useState(false);
    const [mfaLoading, setMfaLoading] = useState(false);
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [factorId, setFactorId] = useState<string | null>(null);
    const [verifyCode, setVerifyCode] = useState('');

    useEffect(() => {
        if (isOpen) {
            checkMfaStatus();
        }
    }, [isOpen]);

    const checkMfaStatus = async () => {
        try {
            const { data, error } = await supabase.auth.mfa.listFactors();
            if (error) throw error;
            const totp = data.all.find(f => f.factor_type === 'totp' && f.status === 'verified');
            setIsMfaEnabled(!!totp);
        } catch (err) {
            console.error('Error checking MFA status:', err);
        }
    };

    const handleEnableMfa = async () => {
        setMfaLoading(true);
        setError(null);
        try {
            const { data, error } = await supabase.auth.mfa.enroll({
                factorType: 'totp'
            });
            if (error) throw error;
            
            setFactorId(data.id);
            setQrCode(data.totp.qr_code);
        } catch (err: any) {
            setError(err.message || 'Failed to enroll in 2FA');
        } finally {
            setMfaLoading(false);
        }
    };

    const handleVerifyMfa = async () => {
        if (!factorId || !verifyCode) return;
        setMfaLoading(true);
        setError(null);
        try {
            const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
            if (challengeError) throw challengeError;

            const { data: verifyData, error: verifyError } = await supabase.auth.mfa.verify({
                factorId,
                challengeId: challengeData.id,
                code: verifyCode
            });
            if (verifyError) throw verifyError;

            setIsMfaEnabled(true);
            setQrCode(null);
            setFactorId(null);
            setVerifyCode('');
        } catch (err: any) {
            setError(err.message || 'Failed to verify 2FA code');
        } finally {
            setMfaLoading(false);
        }
    };

    const handleDisableMfa = async () => {
        setMfaLoading(true);
        setError(null);
        try {
            const { data, error } = await supabase.auth.mfa.listFactors();
            if (error) throw error;
            
            const totp = data.all.find(f => f.factor_type === 'totp' && f.status === 'verified');
            if (totp) {
                const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: totp.id });
                if (unenrollError) throw unenrollError;
                setIsMfaEnabled(false);
            }
        } catch (err: any) {
            setError(err.message || 'Failed to disable 2FA');
        } finally {
            setMfaLoading(false);
        }
    };

    if (!isOpen) return null;

    const handleSave = async () => {
        if (!name.trim()) {
            setError('Name is required');
            return;
        }

        setIsSaving(true);
        setError(null);
        try {
            await updateProfile({ name: name.trim() });
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to update preferences');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
                    <h2 className="text-lg font-semibold text-gray-900">Preferences</h2>
                    <button
                        onClick={onClose}
                        className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto">
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
                            {error}
                        </div>
                    )}

                    <div className="space-y-6">
                        {/* Profile Section */}
                        <div className="space-y-4">
                            <h3 className="text-md font-semibold text-gray-900">Profile Settings</h3>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Display Name
                                </label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <UserIcon className="h-5 w-5 text-gray-400" />
                                    </div>
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                        placeholder="Enter your display name"
                                    />
                                </div>
                                <p className="mt-1 text-xs text-gray-500">
                                    This name will be displayed across the application and used for your avatar initials.
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Email Address
                                </label>
                                <input
                                    type="text"
                                    value={currentUser.email}
                                    disabled
                                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 sm:text-sm cursor-not-allowed"
                                />
                                <p className="mt-1 text-xs text-gray-500">
                                    Email address cannot be changed.
                                </p>
                            </div>
                        </div>

                        <hr className="border-gray-200" />

                        {/* Security Section */}
                        <div className="space-y-4">
                            <h3 className="text-md font-semibold text-gray-900 flex items-center gap-2">
                                <Shield className="w-5 h-5" />
                                Security Settings
                            </h3>
                            
                            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-4">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2">
                                            Two-Factor Authentication (2FA)
                                            {isMfaEnabled ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                                    <ShieldCheck className="w-3 h-3" />
                                                    Enabled
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-600">
                                                    <ShieldAlert className="w-3 h-3" />
                                                    Disabled
                                                </span>
                                            )}
                                        </h4>
                                        <p className="mt-1 text-xs text-gray-500 max-w-[250px]">
                                            Secure your account with an Authenticator app (like Google Authenticator).
                                        </p>
                                    </div>
                                    {!qrCode && (
                                        <button
                                            onClick={isMfaEnabled ? handleDisableMfa : handleEnableMfa}
                                            disabled={mfaLoading}
                                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                                                isMfaEnabled
                                                    ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                                    : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
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
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3 sticky bottom-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                        disabled={isSaving}
                    >
                        Close
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSaving ? (
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <Save className="w-4 h-4" />
                        )}
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
}
