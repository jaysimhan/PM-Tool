import React from 'react';
import OrganizationDashboard from './OrganizationDashboard';
import { useData } from '../contexts/DataContext';

export default function PublicDashboard() {
    const { loading } = useData();

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-7xl mx-auto">
                <OrganizationDashboard currentUser={null as any} isPublic={true} />
            </div>
        </div>
    );
}
