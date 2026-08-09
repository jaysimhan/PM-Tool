import React, { useMemo } from 'react';
import { User } from '../types/types';
import { useData } from '../contexts/DataContext';
import { Users as UsersIcon, TrendingUp, Clock, CheckCircle } from 'lucide-react';
import { getStatusBadgeColor, formatStatusLabel, getPriorityColor } from '../utils/capacityCalculations';
import { PageSkeleton } from './Skeleton';
import { useOpenTask } from '../lib/appNav';

interface Props {
    currentUser: User;
}

export default function TeamDashboard({ currentUser }: Props) {
    const openTask = useOpenTask();
    const { users, teams, tasks, clients, loading } = useData();
    // Get user's team(s)
    const userTeams = useMemo(() => {
        return teams.filter(t => t.memberIds.includes(currentUser.id));
    }, [teams, currentUser.id]);

    const selectedTeam = userTeams[0]; // For simplicity, show first team

    const view = useMemo(() => {
        if (!selectedTeam) return null;
        const teamMembers = users.filter(u => selectedTeam.memberIds.includes(u.id));
        const teamTasks = tasks.filter(t => t.teamIds.includes(selectedTeam.id));
        const activeTasks = teamTasks.filter(t =>
            t.status === 'in_progress' || t.status === 'scheduled' || t.status === 'accepted'
        );
        const completedTasks = teamTasks.filter(t => t.status === 'completed');
        const unassignedTasks = teamTasks.filter(t => !t.assignedToId);
        const totalCapacity = teamMembers.reduce((sum, u) => sum + u.dailyCapacity, 0);
        const scheduledHours = activeTasks.reduce((sum, t) => sum + Math.max(0, t.estimatedHours - (t.actualHours || 0)), 0);
        const weeklyCapacity = totalCapacity * 5;
        const utilization = weeklyCapacity > 0 ? (scheduledHours / weeklyCapacity) * 100 : 0;
        const memberWorkload = teamMembers.map(member => {
            const memberTasks = activeTasks.filter(t => t.assignedToId === member.id);
            const hours = memberTasks.reduce((sum, t) => sum + Math.max(0, t.estimatedHours - (t.actualHours || 0)), 0);
            const capacity = member.dailyCapacity * 5;
            return { member, tasks: memberTasks, hours, capacity, utilization: capacity > 0 ? (hours / capacity) * 100 : 0 };
        }).sort((a, b) => b.utilization - a.utilization);
        return { teamMembers, teamTasks, activeTasks, completedTasks, unassignedTasks, scheduledHours, weeklyCapacity, utilization, memberWorkload };
    }, [selectedTeam, users, tasks]);

    if (loading) return <PageSkeleton variant="team" />;

    if (!selectedTeam || !view) {
        return (
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
                <div className="text-gray-500">You are not assigned to any team</div>
            </div>
        );
    }

    const { teamMembers, activeTasks, completedTasks, unassignedTasks, scheduledHours, weeklyCapacity, utilization, memberWorkload } = view;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-semibold text-gray-900">{selectedTeam.name} Team</h1>
                <p className="text-sm text-gray-600 mt-1">{selectedTeam.description}</p>
            </div>

            {/* Team Stats */}
            <div className="grid grid-cols-4 gap-4">
                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-gray-600">Team Members</div>
                            <div className="text-2xl font-semibold text-gray-900 mt-1">{teamMembers.length}</div>
                        </div>
                        <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${selectedTeam.color}20` }}>
                            <UsersIcon className="w-6 h-6" style={{ color: selectedTeam.color }} />
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-gray-600">Active Tasks</div>
                            <div className="text-2xl font-semibold text-blue-600 mt-1">{activeTasks.length}</div>
                        </div>
                        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                            <TrendingUp className="w-6 h-6 text-blue-600" />
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-gray-600">Team Utilization</div>
                            <div className="text-2xl font-semibold text-orange-600 mt-1">{utilization.toFixed(0)}%</div>
                        </div>
                        <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                            <Clock className="w-6 h-6 text-orange-600" />
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-gray-600">Completed</div>
                            <div className="text-2xl font-semibold text-green-600 mt-1">{completedTasks.length}</div>
                        </div>
                        <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                            <CheckCircle className="w-6 h-6 text-green-600" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Team Capacity Overview */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Team Capacity</h2>
                <div className="grid grid-cols-3 gap-6">
                    <div>
                        <div className="text-sm text-gray-600 mb-2">Weekly Capacity</div>
                        <div className="text-2xl font-semibold text-gray-900">{weeklyCapacity}h</div>
                    </div>
                    <div>
                        <div className="text-sm text-gray-600 mb-2">Scheduled Hours</div>
                        <div className="text-2xl font-semibold text-blue-600">{scheduledHours.toFixed(1)}h</div>
                    </div>
                    <div>
                        <div className="text-sm text-gray-600 mb-2">Available Hours</div>
                        <div className="text-2xl font-semibold text-green-600">{(weeklyCapacity - scheduledHours).toFixed(1)}h</div>
                    </div>
                </div>

                <div className="mt-4 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div
                        className="h-full rounded-full"
                        style={{
                            width: `${Math.min(100, utilization)}%`,
                            backgroundColor: utilization >= 80 ? '#EF4444' : utilization >= 50 ? '#F59E0B' : '#10B981'
                        }}
                    ></div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
                {/* Member Workload */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Member Workload</h2>
                    <div className="space-y-4">
                        {memberWorkload.map(({ member, tasks: memberTasks, hours, capacity, utilization }) => (
                            <div key={member.id}>
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <div
                                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium"
                                            style={{ backgroundColor: selectedTeam.color }}
                                        >
                                            {member.name.split(' ').map(n => n[0]).join('')}
                                        </div>
                                        <div>
                                            <div className="text-sm font-medium text-gray-900">{member.name}</div>
                                            <div className="text-xs text-gray-500">{memberTasks.length} tasks</div>
                                        </div>
                                    </div>
                                    <div className="text-sm text-gray-600">
                                        {hours.toFixed(1)}h / {capacity}h
                                    </div>
                                </div>
                                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                        className="h-full rounded-full"
                                        style={{
                                            width: `${Math.min(100, utilization)}%`,
                                            backgroundColor: utilization >= 100 ? '#EF4444' : utilization >= 80 ? '#F59E0B' : '#10B981'
                                        }}
                                    ></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Active Tasks */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Active Team Tasks</h2>
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                        {activeTasks.slice(0, 10).map(task => {
                            const assignedUser = task.assignedToId ? users.find(u => u.id === task.assignedToId) : null;
                            const client = clients.find(c => c.id === task.clientId);

                            return (
                                <div key={task.id} className="border border-gray-200 rounded-lg p-3">
                                    <div className="flex items-start justify-between mb-2">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <div
                                                    className="w-2 h-2 rounded-full"
                                                    style={{ backgroundColor: getPriorityColor(task.priority) }}
                                                ></div>
                                                <h3 className="text-sm font-medium text-gray-900 line-clamp-1">{task.title}</h3>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {assignedUser && (
                                                    <div className="flex items-center gap-1">
                                                        <div
                                                            className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-medium"
                                                            style={{ backgroundColor: selectedTeam.color }}
                                                        >
                                                            {assignedUser.name.split(' ').map(n => n[0]).join('')}
                                                        </div>
                                                        <span className="text-xs text-gray-600">{assignedUser.name.split(' ')[0]}</span>
                                                    </div>
                                                )}
                                                <span className={`text-xs px-2 py-0.5 rounded ${getStatusBadgeColor(task.status)}`}>
                                                    {formatStatusLabel(task.status)}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-xs text-gray-500 ml-2">
                                            {task.estimatedHours}h
                                        </div>
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {client?.name} • Due {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Unassigned Tasks */}
            {unassignedTasks.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
                    <h2 className="text-lg font-semibold text-yellow-900 mb-4">
                        Unassigned Tasks ({unassignedTasks.length})
                    </h2>
                    <div className="space-y-2">
                        {unassignedTasks.map(task => (
                            <div key={task.id} className="bg-white border border-yellow-300 rounded-lg p-3 flex items-center justify-between">
                                <div>
                                    <div className="text-sm font-medium text-gray-900">{task.title}</div>
                                    <div className="text-xs text-gray-500 mt-1">
                                        {task.estimatedHours}h • Due {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    </div>
                                </div>
                                <button
                                    onClick={() => openTask(task.id)}
                                    className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                                >
                                    Assign
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
