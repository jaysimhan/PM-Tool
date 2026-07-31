import React, { useState } from 'react';
import { User } from '../types/types';
import { tasks, teams, users, clients, workCategories } from '../data/mockData';
import { BarChart3, Download, Calendar, TrendingUp, Users as UsersIcon, CheckCircle } from 'lucide-react';

interface Props {
    currentUser: User;
}

export default function Reports({ currentUser }: Props) {
    const [dateRange, setDateRange] = useState('this-month');

    // Calculate statistics
    const stats = {
        totalTasks: tasks.length,
        completed: tasks.filter(t => t.status === 'completed').length,
        active: tasks.filter(t =>
            t.status === 'in_progress' ||
            t.status === 'scheduled' ||
            t.status === 'accepted'
        ).length,
        onTime: tasks.filter(t =>
            t.status === 'completed' &&
            t.completedDate &&
            new Date(t.completedDate) <= new Date(t.dueDate)
        ).length,
        overdue: tasks.filter(t => {
            if (t.status === 'completed' || t.status === 'cancelled') return false;
            return new Date(t.dueDate) < new Date('2026-07-28');
        }).length
    };

    const completionRate = stats.completed > 0 ? (stats.onTime / stats.completed) * 100 : 0;

    // Work by category
    const categoryStats = workCategories.map(category => {
        const categoryTasks = tasks.filter(t => t.categoryId === category.id);
        const completed = categoryTasks.filter(t => t.status === 'completed').length;
        const active = categoryTasks.filter(t =>
            t.status === 'in_progress' || t.status === 'scheduled' || t.status === 'accepted'
        ).length;

        return {
            category: category.name,
            total: categoryTasks.length,
            active,
            completed,
            hours: categoryTasks.reduce((sum, t) => sum + t.estimatedHours, 0)
        };
    }).filter(s => s.total > 0).sort((a, b) => b.total - a.total);

    // Work by client
    const clientStats = clients.map(client => {
        const clientTasks = tasks.filter(t => t.clientId === client.id);
        const completed = clientTasks.filter(t => t.status === 'completed').length;
        const active = clientTasks.filter(t =>
            t.status === 'in_progress' || t.status === 'scheduled' || t.status === 'accepted'
        ).length;

        return {
            client: client.name,
            total: clientTasks.length,
            active,
            completed
        };
    }).filter(s => s.total > 0).sort((a, b) => b.total - a.total);

    // Team performance
    const teamPerformance = teams.map(team => {
        const teamTasks = tasks.filter(t => t.teamIds.includes(team.id));
        const completed = teamTasks.filter(t => t.status === 'completed').length;
        const active = teamTasks.filter(t =>
            t.status === 'in_progress' || t.status === 'scheduled' || t.status === 'accepted'
        ).length;
        const teamMembers = users.filter(u => team.memberIds.includes(u.id));
        const totalCapacity = teamMembers.reduce((sum, u) => sum + u.dailyCapacity, 0) * 5;
        const scheduledHours = active * 10; // Rough estimate

        return {
            team: team.name,
            color: team.color,
            total: teamTasks.length,
            active,
            completed,
            members: teamMembers.length,
            utilization: totalCapacity > 0 ? (scheduledHours / totalCapacity) * 100 : 0
        };
    }).sort((a, b) => b.total - a.total);

    // User productivity
    const userProductivity = users
        .filter(u => u.role === 'team_member' || u.role === 'team_leader')
        .map(user => {
            const userTasks = tasks.filter(t => t.assignedToId === user.id);
            const completed = userTasks.filter(t => t.status === 'completed').length;
            const active = userTasks.filter(t =>
                t.status === 'in_progress' || t.status === 'scheduled' || t.status === 'accepted'
            ).length;
            const onTime = userTasks.filter(t =>
                t.status === 'completed' &&
                t.completedDate &&
                new Date(t.completedDate) <= new Date(t.dueDate)
            ).length;

            return {
                user: user.name,
                team: teams.find(t => t.memberIds.includes(user.id))?.name || 'Unassigned',
                total: userTasks.length,
                active,
                completed,
                onTimeRate: completed > 0 ? (onTime / completed) * 100 : 0
            };
        })
        .filter(u => u.total > 0)
        .sort((a, b) => b.completed - a.completed)
        .slice(0, 10);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-gray-900">Reports & Analytics</h1>
                    <p className="text-sm text-gray-600 mt-1">Insights into team performance and capacity</p>
                </div>

                <div className="flex items-center gap-3">
                    <select
                        value={dateRange}
                        onChange={(e) => setDateRange(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    >
                        <option value="this-week">This Week</option>
                        <option value="this-month">This Month</option>
                        <option value="last-month">Last Month</option>
                        <option value="this-quarter">This Quarter</option>
                        <option value="all-time">All Time</option>
                    </select>

                </div>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-5 gap-4">
                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="text-sm text-gray-600 mb-1">Total Requests</div>
                    <div className="text-2xl font-semibold text-gray-900">{stats.totalTasks}</div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="text-sm text-gray-600 mb-1">Completed</div>
                    <div className="text-2xl font-semibold text-green-600">{stats.completed}</div>
                    <div className="text-xs text-gray-500 mt-1">
                        {stats.totalTasks > 0 ? ((stats.completed / stats.totalTasks) * 100).toFixed(0) : 0}% of total
                    </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="text-sm text-gray-600 mb-1">Active</div>
                    <div className="text-2xl font-semibold text-blue-600">{stats.active}</div>
                    <div className="text-xs text-gray-500 mt-1">In progress</div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="text-sm text-gray-600 mb-1">On-Time Rate</div>
                    <div className="text-2xl font-semibold text-green-600">{completionRate.toFixed(0)}%</div>
                    <div className="text-xs text-gray-500 mt-1">{stats.onTime} on time</div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="text-sm text-gray-600 mb-1">Overdue</div>
                    <div className="text-2xl font-semibold text-red-600">{stats.overdue}</div>
                    <div className="text-xs text-gray-500 mt-1">Needs attention</div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
                {/* Work by Category */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Work by Category</h2>
                    <div className="space-y-3">
                        {categoryStats.map((stat, index) => {
                            const maxTotal = Math.max(...categoryStats.map(s => s.total));
                            const barWidth = (stat.total / maxTotal) * 100;

                            return (
                                <div key={index}>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm font-medium text-gray-900">{stat.category}</span>
                                        <span className="text-sm text-gray-600">{stat.total} tasks</span>
                                    </div>
                                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-blue-500 rounded-full"
                                            style={{ width: `${barWidth}%` }}
                                        ></div>
                                    </div>
                                    <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                                        <span>{stat.active} active</span>
                                        <span>•</span>
                                        <span>{stat.completed} completed</span>
                                        <span>•</span>
                                        <span>{stat.hours}h total</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Work by Client */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Work by Client</h2>
                    <div className="space-y-3">
                        {clientStats.slice(0, 8).map((stat, index) => {
                            const maxTotal = Math.max(...clientStats.map(s => s.total));
                            const barWidth = (stat.total / maxTotal) * 100;

                            return (
                                <div key={index}>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm font-medium text-gray-900">{stat.client}</span>
                                        <span className="text-sm text-gray-600">{stat.total} tasks</span>
                                    </div>
                                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-purple-500 rounded-full"
                                            style={{ width: `${barWidth}%` }}
                                        ></div>
                                    </div>
                                    <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                                        <span>{stat.active} active</span>
                                        <span>•</span>
                                        <span>{stat.completed} completed</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Team Performance */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Team Performance</h2>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Members</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total Tasks</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Active</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Completed</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Utilization</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {teamPerformance.map((team, index) => (
                                <tr key={index} className="hover:bg-gray-50">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <div
                                                className="w-3 h-3 rounded"
                                                style={{ backgroundColor: team.color }}
                                            ></div>
                                            <span className="text-sm font-medium text-gray-900">{team.team}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-600">{team.members}</td>
                                    <td className="px-4 py-3 text-sm text-gray-900 font-medium">{team.total}</td>
                                    <td className="px-4 py-3 text-sm text-blue-600">{team.active}</td>
                                    <td className="px-4 py-3 text-sm text-green-600">{team.completed}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden max-w-[100px]">
                                                <div
                                                    className="h-full rounded-full"
                                                    style={{
                                                        width: `${Math.min(100, team.utilization)}%`,
                                                        backgroundColor: team.utilization >= 80 ? '#EF4444' : team.utilization >= 50 ? '#F59E0B' : '#10B981'
                                                    }}
                                                ></div>
                                            </div>
                                            <span className="text-sm text-gray-600">{team.utilization.toFixed(0)}%</span>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Top Performers */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Team Member Activity</h2>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Member</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total Tasks</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Active</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Completed</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">On-Time Rate</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {userProductivity.map((user, index) => (
                                <tr key={index} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{user.user}</td>
                                    <td className="px-4 py-3 text-sm text-gray-600">{user.team}</td>
                                    <td className="px-4 py-3 text-sm text-gray-900">{user.total}</td>
                                    <td className="px-4 py-3 text-sm text-blue-600">{user.active}</td>
                                    <td className="px-4 py-3 text-sm text-green-600">{user.completed}</td>
                                    <td className="px-4 py-3">
                                        <span className={`text-sm font-medium ${user.onTimeRate >= 90 ? 'text-green-600' :
                                                user.onTimeRate >= 70 ? 'text-yellow-600' :
                                                    'text-red-600'
                                            }`}>
                                            {user.onTimeRate.toFixed(0)}%
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
