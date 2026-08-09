import React, { useMemo } from 'react';
import { User } from '../types/types';
import { useData } from '../contexts/DataContext';
import { Clock, CheckCircle, AlertCircle, Calendar } from 'lucide-react';
import { getStatusBadgeColor, formatStatusLabel, getPriorityColor, startOfToday, isTaskOverdue } from '../utils/capacityCalculations';
import { PageSkeleton } from './Skeleton';
import { useOpenTask } from '../lib/appNav';

interface Props {
    currentUser: User;
}

export default function PersonalDashboard({ currentUser }: Props) {
    const openTask = useOpenTask();
    // This page used to read src/data/mockData, whose arrays are empty in every build. It
    // therefore said "No tasks scheduled for today" to everybody, every day, no matter what
    // they actually had on -- and the capacity bar it leads with was permanently 0%.
    const { tasks, clients, workCategories, loading } = useData();

    const today = startOfToday();

    const view = useMemo(() => {
        const myTasks = tasks.filter(t => t.assignedToId === currentUser.id);

        const isOpen = (t: typeof myTasks[number]) => t.status !== 'completed' && t.status !== 'cancelled';

        const todayTasks = myTasks.filter(t => {
            if (!isOpen(t) || !t.proposedStartDate) return false;
            return new Date(t.proposedStartDate) <= today
                && (t.status === 'in_progress' || t.status === 'accepted' || t.status === 'scheduled');
        });

        const upcomingTasks = myTasks.filter(t => {
            if (!isOpen(t) || !t.proposedStartDate) return false;
            return new Date(t.proposedStartDate) > today;
        });

        // Shares the one definition of overdue with the dashboards and the calendar, so a task
        // cannot be late here and on time there.
        const overdueTasks = myTasks.filter(t => isTaskOverdue(t, today));

        // A task spanning several days only costs today its share of the estimate.
        const todayHours = todayTasks.reduce((sum, task) => {
            if (!task.proposedStartDate || !task.proposedEndDate) return sum;
            const start = new Date(task.proposedStartDate);
            const end = new Date(task.proposedEndDate);
            const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
            return sum + (task.estimatedHours / days);
        }, 0);

        return {
            todayTasks,
            upcomingTasks,
            completedTasks: myTasks.filter(t => t.status === 'completed'),
            overdueTasks,
            todayHours,
        };
    }, [tasks, currentUser.id, today.getTime()]);

    const { todayTasks, upcomingTasks, completedTasks, overdueTasks, todayHours } = view;

    // A capacity of zero would otherwise render Infinity% and a bar of NaN width.
    const utilizationPercent = currentUser.dailyCapacity > 0
        ? (todayHours / currentUser.dailyCapacity) * 100
        : 0;

    if (loading) return <PageSkeleton variant="personal" />;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-semibold text-gray-900">My Tasks</h1>
                <p className="text-sm text-gray-600 mt-1">Your personal task dashboard and schedule</p>
            </div>

            {/* Capacity Overview */}
            <div className="bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg p-6 text-white">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-lg font-semibold">Today's Capacity</h2>
                        <p className="text-sm opacity-90 mt-1">
                            {startOfToday().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                        </p>
                    </div>
                    <div className="text-right">
                        <div className="text-3xl font-bold">{todayHours.toFixed(1)}h</div>
                        <div className="text-sm opacity-90">of {currentUser.dailyCapacity}h</div>
                    </div>
                </div>

                <div className="h-3 bg-white/20 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-white rounded-full transition-all"
                        style={{ width: `${Math.min(100, utilizationPercent)}%` }}
                    ></div>
                </div>

                <div className="flex items-center justify-between mt-2 text-sm">
                    <span>{utilizationPercent.toFixed(0)}% utilized</span>
                    <span>{todayTasks.length} tasks today</span>
                </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-4 gap-4">
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                            <Calendar className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                            <div className="text-sm text-gray-600">Today</div>
                            <div className="text-xl font-semibold text-gray-900">{todayTasks.length}</div>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                            <Clock className="w-5 h-5 text-purple-600" />
                        </div>
                        <div>
                            <div className="text-sm text-gray-600">Upcoming</div>
                            <div className="text-xl font-semibold text-gray-900">{upcomingTasks.length}</div>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                            <CheckCircle className="w-5 h-5 text-green-600" />
                        </div>
                        <div>
                            <div className="text-sm text-gray-600">Completed</div>
                            <div className="text-xl font-semibold text-gray-900">{completedTasks.length}</div>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                            <AlertCircle className="w-5 h-5 text-red-600" />
                        </div>
                        <div>
                            <div className="text-sm text-gray-600">Overdue</div>
                            <div className="text-xl font-semibold text-gray-900">{overdueTasks.length}</div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
                {/* Today's Tasks */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Today's Tasks</h2>
                    <div className="space-y-3">
                        {todayTasks.length === 0 ? (
                            <div className="text-center py-8 text-gray-500 text-sm">
                                No tasks scheduled for today
                            </div>
                        ) : (
                            todayTasks.map(task => {
                                const client = clients.find(c => c.id === task.clientId);
                                const category = workCategories.find(c => c.id === task.categoryId);

                                return (
                                    <div key={task.id} className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <div
                                                        className="w-2 h-2 rounded-full"
                                                        style={{ backgroundColor: getPriorityColor(task.priority) }}
                                                    ></div>
                                                    <h3 className="text-sm font-medium text-gray-900">{task.title}</h3>
                                                </div>
                                                <p className="text-xs text-gray-500 line-clamp-2">{task.description}</p>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between mt-3">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs px-2 py-1 rounded ${getStatusBadgeColor(task.status)}`}>
                                                    {formatStatusLabel(task.status)}
                                                </span>
                                                <span className="text-xs text-gray-500">{category?.name}</span>
                                            </div>
                                            <div className="text-xs text-gray-600">
                                                {task.estimatedHours}h
                                            </div>
                                        </div>

                                        <div className="mt-2 text-xs text-gray-500">
                                            <span>{client?.name}</span>
                                            <span className="mx-2">•</span>
                                            <span>Due {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Upcoming Tasks */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Upcoming Tasks</h2>
                    <div className="space-y-3">
                        {upcomingTasks.length === 0 ? (
                            <div className="text-center py-8 text-gray-500 text-sm">
                                No upcoming tasks
                            </div>
                        ) : (
                            upcomingTasks.slice(0, 5).map(task => {
                                const client = clients.find(c => c.id === task.clientId);
                                const category = workCategories.find(c => c.id === task.categoryId);

                                return (
                                    <div key={task.id} className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <div
                                                        className="w-2 h-2 rounded-full"
                                                        style={{ backgroundColor: getPriorityColor(task.priority) }}
                                                    ></div>
                                                    <h3 className="text-sm font-medium text-gray-900">{task.title}</h3>
                                                </div>
                                                <p className="text-xs text-gray-500 line-clamp-1">{task.description}</p>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between mt-3">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs px-2 py-1 rounded ${getStatusBadgeColor(task.status)}`}>
                                                    {formatStatusLabel(task.status)}
                                                </span>
                                            </div>
                                            <div className="text-xs text-gray-600">
                                                {task.estimatedHours}h
                                            </div>
                                        </div>

                                        <div className="mt-2 text-xs text-gray-500">
                                            <span>Starts {new Date(task.proposedStartDate!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                            <span className="mx-2">•</span>
                                            <span>Due {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>

            {/* Overdue Tasks (if any) */}
            {overdueTasks.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-6">
                    <h2 className="text-lg font-semibold text-red-900 mb-4 flex items-center gap-2">
                        <AlertCircle className="w-5 h-5" />
                        Overdue Tasks ({overdueTasks.length})
                    </h2>
                    <div className="space-y-3">
                        {overdueTasks.map(task => {
                            const client = clients.find(c => c.id === task.clientId);

                            return (
                                <div key={task.id} className="bg-white border border-red-300 rounded-lg p-4">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <h3 className="text-sm font-medium text-gray-900">{task.title}</h3>
                                            <div className="mt-2 text-xs text-gray-500">
                                                <span>{client?.name}</span>
                                                <span className="mx-2">•</span>
                                                <span className="text-red-600 font-medium">
                                                    Due {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                                </span>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => openTask(task.id)}
                                            className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                                        >
                                            Update
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
