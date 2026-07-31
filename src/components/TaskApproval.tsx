import React, { useState } from 'react';
import { User } from '../types/types';
import { tasks, assignments, clients, workCategories } from '../data/mockData';
import { CheckCircle, XCircle, Clock, Calendar } from 'lucide-react';
import { getPriorityColor, getStatusBadgeColor, formatStatusLabel } from '../utils/capacityCalculations';

interface Props {
    currentUser: User;
}

export default function TaskApproval({ currentUser }: Props) {
    const [selectedTask, setSelectedTask] = useState<string | null>(null);

    // Get pending assignments for current user
    const pendingAssignments = assignments.filter(a =>
        a.userId === currentUser.id &&
        a.status === 'pending'
    );

    const pendingTasks = tasks.filter(t =>
        pendingAssignments.some(a => a.taskId === t.id)
    );

    const handleAccept = (taskId: string) => {
        console.log('Accepting task:', taskId);
        // In real app, this would update the backend
    };

    const handleReject = (taskId: string) => {
        console.log('Rejecting task:', taskId);
        // In real app, this would update the backend
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-semibold text-gray-900">Task Approvals</h1>
                <p className="text-sm text-gray-600 mt-1">Review and approve tasks assigned to you</p>
            </div>

            {/* Pending Count */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-yellow-600" />
                    <span className="text-sm font-medium text-yellow-900">
                        You have {pendingTasks.length} task{pendingTasks.length !== 1 ? 's' : ''} waiting for your approval
                    </span>
                </div>
            </div>

            {/* Pending Tasks List */}
            {pendingTasks.length === 0 ? (
                <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle className="w-8 h-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">All caught up!</h3>
                    <p className="text-sm text-gray-500">You don't have any pending task assignments</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {pendingTasks.map(task => {
                        const client = clients.find(c => c.id === task.clientId);
                        const category = workCategories.find(c => c.id === task.categoryId);
                        const assignment = pendingAssignments.find(a => a.taskId === task.id);
                        const isExpanded = selectedTask === task.id;

                        return (
                            <div key={task.id} className="bg-white rounded-lg border-2 border-yellow-300 shadow-sm">
                                <div className="p-6">
                                    {/* Header */}
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-2">
                                                <div
                                                    className="w-3 h-3 rounded-full"
                                                    style={{ backgroundColor: getPriorityColor(task.priority || 'normal') }}
                                                ></div>
                                                <h3 className="text-lg font-semibold text-gray-900">{task.title}</h3>
                                                <span className={`text-xs px-2 py-1 rounded ${getStatusBadgeColor(task.status)}`}>
                                                    {formatStatusLabel(task.status)}
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-600">{task.description}</p>
                                        </div>
                                    </div>

                                    {/* Task Details */}
                                    <div className="grid grid-cols-4 gap-4 mb-6 p-4 bg-gray-50 rounded-lg">
                                        <div>
                                            <div className="text-xs text-gray-500 mb-1">Client</div>
                                            <div className="text-sm font-medium text-gray-900">{client?.name}</div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500 mb-1">Category</div>
                                            <div className="text-sm font-medium text-gray-900">{category?.name}</div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500 mb-1">Estimated Hours</div>
                                            <div className="text-sm font-medium text-gray-900">{task.estimatedHours} hours</div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500 mb-1">Due Date</div>
                                            <div className="text-sm font-medium text-gray-900">
                                                {new Date(task.dueDate).toLocaleDateString('en-US', {
                                                    month: 'short',
                                                    day: 'numeric',
                                                    year: 'numeric'
                                                })}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Proposed Schedule */}
                                    {assignment?.proposedStartDate && assignment?.proposedEndDate && (
                                        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Calendar className="w-4 h-4 text-blue-600" />
                                                <span className="text-sm font-medium text-blue-900">Proposed Schedule</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <div className="text-xs text-blue-700 mb-1">Start Date</div>
                                                    <div className="text-sm font-medium text-blue-900">
                                                        {new Date(assignment.proposedStartDate).toLocaleDateString('en-US', {
                                                            weekday: 'short',
                                                            month: 'short',
                                                            day: 'numeric'
                                                        })}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-xs text-blue-700 mb-1">End Date</div>
                                                    <div className="text-sm font-medium text-blue-900">
                                                        {new Date(assignment.proposedEndDate).toLocaleDateString('en-US', {
                                                            weekday: 'short',
                                                            month: 'short',
                                                            day: 'numeric'
                                                        })}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Priority Badge */}
                                    <div className="mb-6">
                                        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium" style={{
                                            backgroundColor: `${getPriorityColor(task.priority || 'normal')}20`,
                                            color: getPriorityColor(task.priority || 'normal')
                                        }}>
                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getPriorityColor(task.priority || 'normal') }}></div>
                                            {(task.priority || 'normal').toUpperCase()} PRIORITY
                                        </span>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => handleAccept(task.id)}
                                            className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 flex items-center justify-center gap-2 transition-colors"
                                        >
                                            <CheckCircle className="w-5 h-5" />
                                            Accept Assignment
                                        </button>
                                        <button
                                            onClick={() => handleReject(task.id)}
                                            className="flex-1 px-4 py-3 bg-white border-2 border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 flex items-center justify-center gap-2 transition-colors"
                                        >
                                            <XCircle className="w-5 h-5" />
                                            Request Reassignment
                                        </button>
                                    </div>

                                    {/* Additional Actions */}
                                    <div className="mt-3 flex items-center justify-center">
                                        <button className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                                            Request Clarification
                                        </button>
                                        <span className="mx-3 text-gray-300">|</span>
                                        <button className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                                            View Full Details
                                        </button>
                                    </div>
                                </div>

                                {/* Assignment Info Footer */}
                                <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
                                    Assigned on {new Date(assignment!.assignedDate).toLocaleDateString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
