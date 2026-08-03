import React, { useState, useEffect } from 'react';
import { User } from '../types/types';
import { X, Save, User as UserIcon, Award, Building2, Globe } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { SkillPicker } from './SkillPicker';
import { PreferenceMultiSelect } from './PreferenceMultiSelect';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    currentUser: User;
}

export function PreferencesModal({ isOpen, onClose, currentUser }: Props) {
    const { updateProfile } = useAuth();
    const { skills, clients, regions, refreshUsers } = useData();
    const [name, setName] = useState(currentUser.name || '');
    const [skillIds, setSkillIds] = useState<string[]>(currentUser.skillIds || []);
    const [clientIds, setClientIds] = useState<string[]>(currentUser.clientIds || []);
    const [regionIds, setRegionIds] = useState<string[]>(currentUser.regionIds || []);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            // Re-seed from the saved profile each time it opens so an abandoned edit
            // does not linger (the modal stays mounted between openings).
            setName(currentUser.name || '');
            setSkillIds(currentUser.skillIds || []);
            setClientIds(currentUser.clientIds || []);
            setRegionIds(currentUser.regionIds || []);
            setError(null);
        }
    }, [isOpen, currentUser]);

    if (!isOpen) return null;

    const sameIds = (left: string[], right: string[]) =>
        left.length === right.length && new Set(left).size === new Set([...left, ...right]).size;

    const handleSave = async () => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            setError('Name is required');
            return;
        }

        setIsSaving(true);
        setError(null);
        try {
            // Only persist fields that changed. A display-name edit should not depend on three
            // unrelated join-table requests succeeding as well.
            const updates: Partial<User> = {};
            if (trimmedName !== (currentUser.name || '').trim()) updates.name = trimmedName;
            if (!sameIds(skillIds, currentUser.skillIds || [])) updates.skillIds = skillIds;
            if (!sameIds(clientIds, currentUser.clientIds || [])) updates.clientIds = clientIds;
            if (!sameIds(regionIds, currentUser.regionIds || [])) updates.regionIds = regionIds;

            if (Object.keys(updates).length > 0) {
                await updateProfile(updates);
                // This refresh only keeps Team Management's shared user list current. The
                // profile itself is already saved and refreshed by updateProfile, so a failure
                // here must not turn a successful save into an error in this modal.
                void refreshUsers().catch(err => console.error('Error refreshing users:', err));
            }
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

                        {/* Skills Section */}
                        <div className="space-y-3">
                            <div>
                                <h3 className="text-md font-semibold text-gray-900 flex items-center gap-2">
                                    <Award className="w-5 h-5" />
                                    Skills
                                </h3>
                                <p className="mt-1 text-xs text-gray-500">
                                    Add any skill you work on. You are not limited to your own team's skills &mdash;
                                    pick anything in the organisation. These show up on your profile in Team Management.
                                </p>
                            </div>

                            <SkillPicker
                                allSkills={skills}
                                selectedIds={skillIds}
                                onChange={setSkillIds}
                                placeholder="Search skills across all teams..."
                            />
                        </div>

                        <hr className="border-gray-200" />

                        {/* Brands and regions -- what new work gets handed to them automatically */}
                        <div className="space-y-3">
                            <div>
                                <h3 className="text-md font-semibold text-gray-900 flex items-center gap-2">
                                    <Building2 className="w-5 h-5" />
                                    Preferred brands
                                </h3>
                                <p className="mt-1 text-xs text-gray-500">
                                    Work for these brands can be assigned to you automatically. Pick as many as you like.
                                </p>
                            </div>

                            <PreferenceMultiSelect
                                options={clients.map(c => ({ id: c.id, name: c.name }))}
                                selectedIds={clientIds}
                                onChange={setClientIds}
                                emptyLabel="No brands have been set up yet."
                                accent="blue"
                                searchPlaceholder="Search brands..."
                            />
                        </div>

                        <div className="space-y-3">
                            <div>
                                <h3 className="text-md font-semibold text-gray-900 flex items-center gap-2">
                                    <Globe className="w-5 h-5" />
                                    Preferred regions
                                </h3>
                                <p className="mt-1 text-xs text-gray-500">
                                    The regions you want to cover. Leaving both of these empty means new work is only
                                    ever assigned to you by hand.
                                </p>
                            </div>

                            <PreferenceMultiSelect
                                options={regions.map(r => ({ id: r.id, name: r.name, prefix: r.flag }))}
                                selectedIds={regionIds}
                                onChange={setRegionIds}
                                emptyLabel="No regions have been set up yet."
                                accent="teal"
                                searchPlaceholder="Search regions..."
                            />
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
