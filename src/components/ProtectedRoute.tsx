import React, { useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { AccessRequestModal } from './AccessRequestModal';

const PageLoader = () => (
    <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
);

export function ProtectedRoute() {
    const { session, profile: currentUser, loading: authLoading, mfaRequired, signOut } = useAuth();
    const { teams, loading: dataLoading } = useData();
    const [showReactivation, setShowReactivation] = useState(false);

    if (authLoading || (session && dataLoading)) {
        return <PageLoader />;
    }

    if (!session || mfaRequired) {
        return <Navigate to="/login" replace />;
    }

    // Deactivated accounts can still authenticate -- Supabase knows nothing about this flag --
    // so the app is what has to turn them away. Ahead of the redirects below, or a deactivated
    // person with no team would be sent to pick one forever.
    if (currentUser && !currentUser.isActive) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen text-center p-6 bg-gray-50">
                <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 max-w-md w-full">
                    <h2 className="text-xl font-bold text-gray-900 mb-2">Your account is deactivated</h2>
                    <p className="text-gray-500 mb-6 text-sm">
                        An administrator has turned off access for {currentUser.email}. Ask for it back
                        if you think this is a mistake — the admins will be notified.
                    </p>
                    <button
                        onClick={() => setShowReactivation(true)}
                        className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                    >
                        Request reactivation
                    </button>
                    <button
                        onClick={signOut}
                        className="w-full mt-2 py-2 px-4 border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium rounded-lg transition-colors"
                    >
                        Sign out
                    </button>
                </div>

                {showReactivation && (
                    <AccessRequestModal
                        kind="reactivation"
                        defaultEmail={currentUser.email}
                        onClose={() => setShowReactivation(false)}
                    />
                )}
            </div>
        );
    }

    // An invited user who hasn't finished setting up their account yet. The profile row
    // is created by a database trigger when the invite is issued, so its presence proves
    // nothing -- onboarding_completed is the flag that does.
    if (!currentUser || !currentUser.onboardingCompleted) {
        return <Navigate to="/welcome" replace />;
    }

    // Someone an admin has taken off their team picks a new one before going any further.
    // Gated on teams existing at all, otherwise an org with no teams yet would bounce
    // everyone to a picker with nothing in it and no way back.
    if (teams.length > 0 && currentUser.teamIds.length === 0) {
        return <Navigate to="/welcome" replace />;
    }

    return <Outlet context={{ currentUser }} />;
}
