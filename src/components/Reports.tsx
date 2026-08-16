import React, { useState, useMemo } from 'react';
import { User } from '../types/types';
import { useData } from '../contexts/DataContext';
import { BarChart3, Download, Calendar, TrendingUp, Users as UsersIcon, CheckCircle } from 'lucide-react';
import TeamDashboard from './TeamDashboard';
import { isTaskOverdue } from '../utils/capacityCalculations';
import { PageSkeleton } from './Skeleton';
import { useVirtualWindow } from '../lib/useVirtualWindow';

interface Props {
    currentUser: User;
}

const dateBounds = (range: string, now = new Date()): [Date | null, Date | null] => {
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    if (range === 'all-time') return [null, null];
    if (range === 'this-week') {
        const start = startOfDay(now);
        start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
        const end = endOfDay(new Date(start));
        end.setDate(end.getDate() + 6);
        return [start, end];
    }
    if (range === 'last-month') {
        return [new Date(now.getFullYear(), now.getMonth() - 1, 1), endOfDay(new Date(now.getFullYear(), now.getMonth(), 0))];
    }
    if (range === 'this-quarter') {
        const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
        return [new Date(now.getFullYear(), quarterMonth, 1), endOfDay(new Date(now.getFullYear(), quarterMonth + 3, 0))];
    }
    return [new Date(now.getFullYear(), now.getMonth(), 1), endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
};

export default function Reports({ currentUser }: Props) {
    const { tasks, teams, users, clients, workCategories, loading } = useData();
    const [dateRange, setDateRange] = useState('this-month');
    const [activeTab, setActiveTab] = useState<'reports' | 'team'>('reports');

    const hasTeam = useMemo(() => {
        return teams.some(t => t.memberIds.includes(currentUser.id));
    }, [teams, currentUser.id]);

    const report = useMemo(() => {
        const [start, end] = dateBounds(dateRange);
        // Reports are cohort reports: a request belongs to the period in which it was created.
        // Completed/on-time figures are then calculated for that same cohort, avoiding a mix
        // of old requests and new completions when the selector changes.
        const filteredTasks = tasks.filter(t => {
            if (!start || !end) return true;
            const created = new Date(t.createdDate);
            return !Number.isNaN(created.getTime()) && created >= start && created <= end;
        });
        const stats = {
        totalTasks: filteredTasks.length,
        completed: filteredTasks.filter(t => t.status === 'completed').length,
        active: filteredTasks.filter(t =>
            t.status === 'in_progress' ||
            t.status === 'scheduled' ||
            t.status === 'accepted'
        ).length,
        onTime: filteredTasks.filter(t =>
            t.status === 'completed' &&
            t.completedDate &&
            new Date(t.completedDate) <= new Date(t.dueDate)
        ).length,
        overdue: filteredTasks.filter(t => isTaskOverdue(t)).length
        };

        const completionRate = stats.completed > 0 ? (stats.onTime / stats.completed) * 100 : 0;

    // Work by category
    const categoryStats = workCategories.map(category => {
        const categoryTasks = filteredTasks.filter(t => t.categoryId === category.id);
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
        const clientTasks = filteredTasks.filter(t => t.clientId === client.id);
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
        const teamTasks = filteredTasks.filter(t => t.teamIds.includes(team.id));
        const completed = teamTasks.filter(t => t.status === 'completed').length;
        const active = teamTasks.filter(t =>
            t.status === 'in_progress' || t.status === 'scheduled' || t.status === 'accepted'
        ).length;
        const teamMembers = users.filter(u => team.memberIds.includes(u.id));
        const totalCapacity = teamMembers.reduce((sum, u) => sum + u.dailyCapacity, 0) * 5;
        const scheduledHours = teamTasks
            .filter(t => t.status === 'in_progress' || t.status === 'scheduled' || t.status === 'accepted')
            .reduce((sum, t) => sum + t.estimatedHours, 0);

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
            const userTasks = filteredTasks.filter(t => t.assignedToId === user.id);
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
        .slice(0, 100);

        return { stats, completionRate, categoryStats, clientStats, teamPerformance, userProductivity };
    }, [dateRange, tasks, teams, users, clients, workCategories]);

    const teamRows = useVirtualWindow(report.teamPerformance.length, 49, 420, 5);
    const memberRows = useVirtualWindow(report.userProductivity.length, 49, 420, 5);

    if (loading) return <PageSkeleton variant="reports" />;

    const { stats, completionRate, categoryStats, clientStats, teamPerformance, userProductivity } = report;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-semibold text-gray-900">Reports & Analytics</h1>
                        <p className="text-sm text-gray-600 mt-1">Insights into team performance and capacity</p>
                    </div>

                    <div className="flex items-center gap-3">
                        <select
                            value={dateRange}
                            onChange={(e) => setDateRange(e.target.value)}
                            className="pl-3 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer"
                        >
                            <option value="this-week">This Week</option>
                            <option value="this-month">This Month</option>
                            <option value="last-month">Last Month</option>
                            <option value="this-quarter">This Quarter</option>
                            <option value="all-time">All Time</option>
                        </select>
                    </div>
                </div>

                {hasTeam && (
                    <div className="border-b border-gray-200">
                        <nav className="-mb-px flex space-x-8">
                            <button
                                onClick={() => setActiveTab('reports')}
                                className={`${
                                    activeTab === 'reports'
                                        ? 'border-blue-500 text-blue-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors`}
                            >
                                Organization Reports
                            </button>
                            <button
                                onClick={() => setActiveTab('team')}
                                className={`${
                                    activeTab === 'team'
                                        ? 'border-blue-500 text-blue-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors`}
                            >
                                My Team Dashboard
                            </button>
                        </nav>
                    </div>
                )}
            </div>

            {activeTab === 'team' ? (
                <TeamDashboard currentUser={currentUser} />
            ) : (
                <>
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
                <div className="overflow-auto" style={{ maxHeight: teamRows.viewportHeight }} onScroll={teamRows.onScroll}>
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
                            {teamRows.paddingTop > 0 && <tr aria-hidden="true"><td colSpan={6} style={{ height: teamRows.paddingTop, padding: 0 }} /></tr>}
                            {teamPerformance.slice(teamRows.start, teamRows.end).map((team, index) => (
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
                            {teamRows.paddingBottom > 0 && <tr aria-hidden="true"><td colSpan={6} style={{ height: teamRows.paddingBottom, padding: 0 }} /></tr>}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Top Performers */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Team Member Activity</h2>
                <div className="overflow-auto" style={{ maxHeight: memberRows.viewportHeight }} onScroll={memberRows.onScroll}>
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
                            {memberRows.paddingTop > 0 && <tr aria-hidden="true"><td colSpan={6} style={{ height: memberRows.paddingTop, padding: 0 }} /></tr>}
                            {userProductivity.slice(memberRows.start, memberRows.end).map((user, index) => (
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
                            {memberRows.paddingBottom > 0 && <tr aria-hidden="true"><td colSpan={6} style={{ height: memberRows.paddingBottom, padding: 0 }} /></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
            </>
            )}
        </div>
    );
}
