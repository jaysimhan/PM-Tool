import React from 'react';
import { User } from '../types/types';
import { tasks, teams, users, clients } from '../data/mockData';
import { AlertCircle, CheckCircle, Clock, TrendingUp, Users as UsersIcon, Briefcase } from 'lucide-react';
import { getStatusBadgeColor, formatStatusLabel, getPriorityColor } from '../utils/capacityCalculations';

interface Props {
    currentUser: User;
}

export default function OrganizationDashboard({ currentUser }: Props) {
    // Calculate statistics
    const stats = {
        totalRequests: tasks.length,
        newRequests: tasks.filter(t => t.status === 'new_request' || t.status === 'awaiting_assignment').length,
        activeTasks: tasks.filter(t =>
            t.status === 'in_progress' ||
            t.status === 'scheduled' ||
            t.status === 'accepted'
        ).length,
        unassignedTasks: tasks.filter(t => !t.assignedToId).length,
        managerReviewRequired: tasks.filter(t => t.status === 'manager_review_required').length,
        overdueTasks: tasks.filter(t => {
            if (t.status === 'completed' || t.status === 'cancelled') return false;
            return new Date(t.dueDate) < new Date('2026-07-28');
        }).length,
        dueSoon: tasks.filter(t => {
            if (t.status === 'completed' || t.status === 'cancelled') return false;
            const dueDate = new Date(t.dueDate);
            const today = new Date('2026-07-28');
            const threeDaysFromNow = new Date(today);
            threeDaysFromNow.setDate(today.getDate() + 3);
            return dueDate >= today && dueDate <= threeDaysFromNow;
        }).length,
        completed: tasks.filter(t => t.status === 'completed').length
    };

    // Team workload summary
    const teamWorkload = teams.map(team => {
        const teamTasks = tasks.filter(t =>
            t.teamIds.includes(team.id) &&
            (t.status === 'in_progress' || t.status === 'scheduled' || t.status === 'accepted')
        );
        const teamMembers = users.filter(u => team.memberIds.includes(u.id));
        const totalCapacity = teamMembers.reduce((sum, u) => sum + u.dailyCapacity, 0);
        const scheduledHours = teamTasks.reduce((sum, t) => sum + (t.estimatedHours - (t.actualHours || 0)), 0);

        return {
            team,
            taskCount: teamTasks.length,
            memberCount: teamMembers.length,
            utilization: totalCapacity > 0 ? (scheduledHours / (totalCapacity * 5)) * 100 : 0 // Rough weekly estimate
        };
    });

    // Recent tasks requiring attention
    const tasksRequiringAttention = tasks
        .filter(t =>
            t.status === 'manager_review_required' ||
            t.status === 'awaiting_employee_approval' ||
            (t.status !== 'completed' && new Date(t.dueDate) < new Date('2026-07-28'))
        )
        .slice(0, 5);

    // Work by category
    const categoryStats = tasks.reduce((acc, task) => {
        const category = task.categoryId;
        if (!acc[category]) {
            acc[category] = { total: 0, active: 0, completed: 0 };
        }
        acc[category].total++;
        if (task.status === 'in_progress' || task.status === 'scheduled' || task.status === 'accepted') {
            acc[category].active++;
        }
        if (task.status === 'completed') {
            acc[category].completed++;
        }
        return acc;
    }, {} as Record<string, { total: number; active: number; completed: number }>);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-semibold text-gray-900">Organization Dashboard</h1>
                <p className="text-sm text-gray-600 mt-1">Overview of all teams, tasks, and capacity</p>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-4 gap-4">
                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-gray-600">Total Requests</div>
                            <div className="text-2xl font-semibold text-gray-900 mt-1">{stats.totalRequests}</div>
                        </div>
                        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                            <Briefcase className="w-6 h-6 text-blue-600" />
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-gray-600">Active Tasks</div>
                            <div className="text-2xl font-semibold text-blue-600 mt-1">{stats.activeTasks}</div>
                        </div>
                        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                            <TrendingUp className="w-6 h-6 text-blue-600" />
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-gray-600">Manager Review</div>
                            <div className="text-2xl font-semibold text-orange-600 mt-1">{stats.managerReviewRequired}</div>
                        </div>
                        <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                            <AlertCircle className="w-6 h-6 text-orange-600" />
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-gray-600">Overdue</div>
                            <div className="text-2xl font-semibold text-red-600 mt-1">{stats.overdueTasks}</div>
                        </div>
                        <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                            <Clock className="w-6 h-6 text-red-600" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Additional Stats Row */}
            <div className="grid grid-cols-4 gap-4">
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="text-sm text-gray-600">New Requests</div>
                    <div className="text-xl font-semibold text-gray-900 mt-1">{stats.newRequests}</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="text-sm text-gray-600">Unassigned</div>
                    <div className="text-xl font-semibold text-gray-900 mt-1">{stats.unassignedTasks}</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="text-sm text-gray-600">Due Soon (3 days)</div>
                    <div className="text-xl font-semibold text-yellow-600 mt-1">{stats.dueSoon}</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="text-sm text-gray-600">Completed</div>
                    <div className="text-xl font-semibold text-green-600 mt-1">{stats.completed}</div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
                {/* Team Capacity Overview */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Team Capacity Overview</h2>
                    <div className="space-y-4">
                        {teamWorkload.map(({ team, taskCount, memberCount, utilization }) => (
                            <div key={team.id}>
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <div
                                            className="w-3 h-3 rounded"
                                            style={{ backgroundColor: team.color }}
                                        ></div>
                                        <span className="text-sm font-medium text-gray-900">{team.name}</span>
                                        <span className="text-xs text-gray-500">({memberCount} members)</span>
                                    </div>
                                    <div className="text-sm text-gray-600">{taskCount} active tasks</div>
                                </div>
                                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                        className="h-full rounded-full"
                                        style={{
                                            width: `${Math.min(100, utilization)}%`,
                                            backgroundColor: utilization >= 80 ? '#EF4444' : utilization >= 50 ? '#F59E0B' : '#10B981'
                                        }}
                                    ></div>
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                    {utilization.toFixed(0)}% utilized
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Tasks Requiring Attention */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Tasks Requiring Attention</h2>
                    <div className="space-y-3">
                        {tasksRequiringAttention.length === 0 ? (
                            <div className="text-sm text-gray-500 text-center py-8">
                                No tasks requiring immediate attention
                            </div>
                        ) : (
                            tasksRequiringAttention.map(task => {
                                const client = clients.find(c => c.id === task.clientId);
                                const isOverdue = new Date(task.dueDate) < new Date('2026-07-28') && task.status !== 'completed';

                                return (
                                    <div key={task.id} className="border border-gray-200 rounded-lg p-3">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <div
                                                        className="w-1 h-1 rounded-full"
                                                        style={{ backgroundColor: getPriorityColor(task.priority) }}
                                                    ></div>
                                                    <h3 className="text-sm font-medium text-gray-900 truncate">{task.title}</h3>
                                                </div>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-xs text-gray-500">{client?.name}</span>
                                                    <span className="text-xs text-gray-400">•</span>
                                                    <span className={`text-xs px-2 py-0.5 rounded ${getStatusBadgeColor(task.status)}`}>
                                                        {formatStatusLabel(task.status)}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="text-xs text-gray-500 ml-2">
                                                {isOverdue ? (
                                                    <span className="text-red-600 font-medium">Overdue</span>
                                                ) : (
                                                    new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>

            {/* Work Distribution by Client */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Work Distribution by Client</h2>
                <div className="grid grid-cols-4 gap-4">
                    {clients.slice(0, 8).map(client => {
                        const clientTasks = tasks.filter(t => t.clientId === client.id);
                        const activeTasks = clientTasks.filter(t =>
                            t.status === 'in_progress' || t.status === 'scheduled' || t.status === 'accepted'
                        );

                        return (
                            <div key={client.id} className="border border-gray-200 rounded-lg p-4">
                                <div className="text-sm font-medium text-gray-900 mb-2">{client.name}</div>
                                <div className="text-2xl font-semibold text-blue-600">{activeTasks.length}</div>
                                <div className="text-xs text-gray-500 mt-1">
                                    {clientTasks.length} total requests
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
