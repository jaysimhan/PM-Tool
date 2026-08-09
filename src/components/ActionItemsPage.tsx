import React, { useState } from 'react';
import { User } from '../types/types';
import TaskApproval from './TaskApproval';
import ManagerReview from './ManagerReview';

interface Props {
    currentUser: User;
}

export default function ActionItemsPage({ currentUser }: Props) {
    const [activeTab, setActiveTab] = useState<'approval' | 'review'>('approval');
    const isManagerOrAdmin = ['team_leader', 'manager', 'admin', 'super_admin'].includes(currentUser.role);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-gray-200 pb-4">
                <div>
                    <h1 className="text-2xl font-semibold text-gray-900">Action Items</h1>
                    <p className="text-sm text-gray-600 mt-1">Manage your pending approvals and review tasks needing assignment</p>
                </div>
            </div>

            {isManagerOrAdmin && (
                <div className="flex border-b border-gray-200">
                    <button
                        onClick={() => setActiveTab('approval')}
                        className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                            activeTab === 'approval'
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        Task Approvals
                    </button>
                    <button
                        onClick={() => setActiveTab('review')}
                        className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                            activeTab === 'review'
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        Manager Review
                    </button>
                </div>
            )}

            <div className="mt-6">
                {activeTab === 'approval' ? (
                    <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                        <TaskApproval currentUser={currentUser} hideHeader />
                    </div>
                ) : (
                    <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                        <ManagerReview currentUser={currentUser} hideHeader />
                    </div>
                )}
            </div>
        </div>
    );
}
