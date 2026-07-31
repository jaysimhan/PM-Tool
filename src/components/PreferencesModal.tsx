import React, { useState } from 'react';
import { User } from '../types/types';
import { X, Save, User as UserIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4">
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

                    <div className="space-y-4">
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
                </div>

                <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3 sticky bottom-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                        disabled={isSaving}
                    >
                        Cancel
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
