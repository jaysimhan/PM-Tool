import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';

const PageLoader = () => (
    <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
);

export function ProtectedRoute() {
    const { session, profile: currentUser, loading: authLoading, mfaRequired, signOut } = useAuth();
    const { loading: dataLoading } = useData();

    if (authLoading || (session && dataLoading)) {
        return <PageLoader />;
    }

    if (!session || mfaRequired) {
        return <Navigate to="/login" replace />;
    }

    if (!currentUser) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen text-center p-6 bg-gray-50">
                <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 max-w-md w-full">
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Profile Missing</h2>
                    <p className="text-gray-500 mb-6">
                        You have successfully authenticated, but your user profile could not be found in the database. 
                    </p>
                    <button 
                        onClick={async () => {
                            await signOut();
                            window.location.href = '/login';
                        }} 
                        className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                    >
                        Log Out
                    </button>
                </div>
            </div>
        );
    }

    return <Outlet context={{ currentUser }} />;
}
