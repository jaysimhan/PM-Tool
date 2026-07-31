import React, { useState, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Info, Loader2 } from 'lucide-react';

export function CreatePassword() {
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
    const navigate = useNavigate();

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

            // Verify current password first
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: session.user.email,
                password: currentPassword
            });
            if (signInError) throw new Error("Incorrect current password.");

            // Update to new password
            const { error: updateError } = await supabase.auth.updateUser({
                password: newPassword
            });
            if (updateError) throw updateError;
            
            setSuccess("Password updated successfully.");
            setCurrentPassword('');
            setNewPassword('');
            setRetypePassword('');
            
            setTimeout(() => {
                navigate('/');
            }, 2000);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 py-12 px-4 flex justify-center font-sans">
            <div className="max-w-md w-full bg-white md:p-8 md:rounded-xl md:shadow-sm md:border md:border-gray-200 h-fit">
                <h2 className="text-xl font-bold text-gray-900 mb-6">
                    Change password
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

                    {/* Current Password */}
                    <div className="space-y-1">
                        <label className="block text-sm font-medium text-gray-700">
                            Current Password <span className="text-gray-500">*</span>
                        </label>
                        <div className="relative">
                            <input
                                type={showCurrent ? "text" : "password"}
                                required
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
                            disabled={loading || !currentPassword || !newPassword || !retypePassword || strengthScore < 5}
                            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'SAVE'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
