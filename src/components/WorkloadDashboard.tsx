import React, { useState, useMemo } from 'react';
import { User, Task } from '../types/types';
import { users, teams, tasks, leaves, clients, workCategories } from '../data/mockData';
import { calculateDailyCapacity, getDatesInRange, formatDate, getWorkloadColor, getStatusBadgeColor, formatStatusLabel, getPriorityColor } from '../utils/capacityCalculations';
import { Filter, Download, Calendar, List, LayoutGrid, GanttChart, ArrowUpDown } from 'lucide-react';
import TaskDetailsPanel from './TaskDetailsPanel';
import { TimelineContainer } from './TimelineContainer';

interface Props {
    currentUser: User;
}

type ViewMode = 'calendar' | 'list' | 'board' | 'timeline';
type CalendarView = 'day' | 'week' | 'month';
type SortOption = 'dueDate' | 'priority' | 'assignee' | 'status' | 'hours' | 'employee';

export default function WorkloadDashboard({ currentUser }: Props) {
    const [localTasks, setLocalTasks] = useState(tasks);
    const [selectedTeamId, setSelectedTeamId] = useState<string>('all');
    const [startDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [hoveredCell, setHoveredCell] = useState<{ userId: string; date: string } | null>(null);
    const [clickedCell, setClickedCell] = useState<{ userId: string; date: string } | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('calendar');
    const [calendarView, setCalendarView] = useState<CalendarView>('week');
    const [showWeekends, setShowWeekends] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(false);
    const [sortBy, setSortBy] = useState<SortOption>('employee');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

    // Filter states
    const [filterPriority, setFilterPriority] = useState<string[]>([]);
    const [filterStatus, setFilterStatus] = useState<string[]>([]);
    const [filterCategory, setFilterCategory] = useState<string[]>([]);

    // Get dates to display
    const dates = useMemo(() => {
        let baseDate = new Date(startDate);
        
        // Align baseDate based on view
        if (calendarView === 'week') {
            // Start of week (Sunday)
            const day = baseDate.getDay();
            baseDate.setDate(baseDate.getDate() - day);
        } else if (calendarView === 'month') {
            // Start of month
            baseDate.setDate(1);
        }

        // Determine how many calendar days to fetch
        const targetDays = calendarView === 'day' ? 1 
                         : calendarView === 'week' ? 7 
                         : new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0).getDate();

        const allDates = getDatesInRange(baseDate.toISOString().split('T')[0], targetDays);

        if (!showWeekends && calendarView !== 'day') {
            return allDates.filter(date => {
                const day = new Date(date).getDay();
                return day !== 0 && day !== 6;
            });
        }
        return allDates;
    }, [startDate, calendarView, showWeekends]);

    // Get team members based on selected team
    const teamMembers = useMemo(() => {
        if (selectedTeamId === 'all') {
            return users.filter(u =>
                u.role !== 'requester' &&
                u.isActive &&
                (u.teamIds.length > 0 || tasks.some(t => t.assignedToId === u.id))
            );
        }

        const team = teams.find(t => t.id === selectedTeamId);
        return team ? users.filter(u => team.memberIds.includes(u.id)) : [];
    }, [selectedTeamId]);

    // Calculate capacity for each user and date
    const capacityData = useMemo(() => {
        const data: Record<string, Record<string, any>> = {};

        teamMembers.forEach(user => {
            data[user.id] = {};
            dates.forEach(date => {
                const capacity = calculateDailyCapacity(user, date, tasks, leaves);
                const tasksForDay = tasks.filter(task =>
                    task.assignedToId === user.id &&
                    task.proposedStartDate &&
                    task.proposedEndDate &&
                    new Date(task.proposedStartDate) <= new Date(date) &&
                    new Date(task.proposedEndDate) >= new Date(date) &&
                    (task.status === 'accepted' || task.status === 'in_progress' || task.status === 'scheduled')
                );

                data[user.id][date] = {
                    ...capacity,
                    tasks: tasksForDay
                };
            });
        });

        return data;
    }, [teamMembers, dates]);

    // Memoized user-to-team lookup map for O(1) access
    const userTeamMap = useMemo(() => {
        const map = new Map<string, typeof teams[0] | null>();
        users.forEach(user => {
            if (user.teamIds.length === 0) {
                map.set(user.id, null);
            } else {
                map.set(user.id, teams.find(t => t.id === user.teamIds[0]) || null);
            }
        });
        return map;
    }, []);

    const getUserTeam = (userId: string) => userTeamMap.get(userId) || null;

    // Visible teams based on user role
    const visibleTeams = useMemo(() => {
        if (currentUser.role === 'super_admin' || currentUser.role === 'admin' || currentUser.role === 'manager') {
            return teams;
        }
        if (currentUser.role === 'team_leader') {
            return teams.filter(t => t.leaderId === currentUser.id);
        }
        return teams.filter(t => t.memberIds.includes(currentUser.id));
    }, [currentUser]);

    // Get all active tasks for board/list views with filters
    const activeTasks = useMemo(() => {
        let filtered = localTasks.filter(t =>
            (t.status === 'in_progress' || t.status === 'scheduled' || t.status === 'accepted' || t.status === 'on_hold') &&
            (selectedTeamId === 'all' || t.teamIds.includes(selectedTeamId))
        );

        // Apply filters
        if (filterPriority.length > 0) {
            filtered = filtered.filter(t => t.priority && filterPriority.includes(t.priority));
        }
        if (filterStatus.length > 0) {
            filtered = filtered.filter(t => filterStatus.includes(t.status));
        }
        if (filterCategory.length > 0) {
            filtered = filtered.filter(t => filterCategory.includes(t.categoryId));
        }

        // Apply sorting for list view
        if (viewMode === 'list') {
            filtered.sort((a, b) => {
                let comparison = 0;

                switch (sortBy) {
                    case 'dueDate':
                        comparison = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
                        break;
                    case 'priority':
                        const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
                        comparison = priorityOrder[a.priority as keyof typeof priorityOrder] - priorityOrder[b.priority as keyof typeof priorityOrder];
                        break;
                    case 'assignee':
                        const assigneeA = a.assignedToId ? users.find(u => u.id === a.assignedToId)?.name || '' : '';
                        const assigneeB = b.assignedToId ? users.find(u => u.id === b.assignedToId)?.name || '' : '';
                        comparison = assigneeA.localeCompare(assigneeB);
                        break;
                    case 'status':
                        comparison = a.status.localeCompare(b.status);
                        break;
                    case 'hours':
                        comparison = a.estimatedHours - b.estimatedHours;
                        break;
                    case 'employee':
                        const employeeA = a.assignedToId ? users.find(u => u.id === a.assignedToId)?.name || '' : '';
                        const employeeB = b.assignedToId ? users.find(u => u.id === b.assignedToId)?.name || '' : '';
                        comparison = employeeA.localeCompare(employeeB);
                        break;
                }

                return sortDirection === 'asc' ? comparison : -comparison;
            });
        }

        return filtered;
    }, [selectedTeamId, filterPriority, filterStatus, filterCategory, sortBy, sortDirection, viewMode]);

    const handleTaskClick = (task: Task) => {
        setSelectedTask(task);
        setIsTaskPanelOpen(true);
    };

    const handleStatusChange = (taskId: string, newStatus: string) => {
        console.log('Updating task', taskId, 'to status', newStatus);
        // In a real app, this would update the backend        // We might want to add a toast notification here later instead of an alert
    };

    const membersByTeam = useMemo(() => {
        return teamMembers.reduce((acc, user) => {
            const team = getUserTeam(user.id);
            const teamName = team?.name || 'Unassigned';
            if (!acc[teamName]) {
                acc[teamName] = { team, members: [] };
            }
            acc[teamName].members.push(user);
            return acc;
        }, {} as Record<string, { team: typeof teams[0] | null, members: typeof teamMembers }>);
    }, [teamMembers]);

    const renderUserRoleTag = (user: typeof users[0]) => {
        if (user.role === 'super_admin') {
            return <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700">Super Admin</span>;
        }
        if (user.role === 'admin') {
            return <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700">Admin</span>;
        }
        if (user.role === 'team_leader') {
            return <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">Lead</span>;
        }
        return null;
    };

    const renderCalendarView = () => (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="sticky left-0 z-20 bg-gray-50 px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48 border-r border-gray-200">
                                Team Member
                            </th>
                            {dates.map(date => {
                                const dateObj = new Date(date);
                                const isToday = date === new Date().toISOString().split('T')[0];
                                return (
                                <th key={date} className="px-4 py-3 text-center border-r border-gray-200 min-w-[120px]">
                                    <div className="text-xs font-semibold text-gray-500 uppercase">
                                        {dateObj.toLocaleDateString('en-US', { weekday: 'short' })}
                                    </div>
                                    <div className={`text-lg font-semibold mt-1 mx-auto w-8 h-8 flex items-center justify-center ${
                                        isToday 
                                            ? 'bg-blue-600 text-white rounded-md' 
                                            : 'text-gray-900'
                                    }`}>
                                        {dateObj.getDate()}
                                    </div>
                                </th>
                            )})}
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {Object.entries(membersByTeam).map(([teamName, { team, members }]) => (
                            <React.Fragment key={teamName}>
                                <tr className="bg-gray-50/80">
                                    <td colSpan={dates.length + 1} className="sticky left-0 z-20 bg-gray-50 border-b border-gray-200 px-6 py-2.5 font-medium text-sm text-gray-900 flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: team?.color || '#9CA3AF' }}></div>
                                        {teamName}
                                    </td>
                                </tr>
                                {members.map(user => {
                                    const userTeam = team;

                                    return (
                                <tr key={user.id} className="hover:bg-gray-50">
                                    <td className="sticky left-0 z-10 bg-white px-6 py-4 whitespace-nowrap border-r border-gray-200">
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium"
                                                style={{ backgroundColor: userTeam?.color || '#6B7280' }}
                                            >
                                                {user.name.split(' ').map(n => n[0]).join('')}
                                            </div>
                                            <div>
                                                <div className="text-sm font-medium text-gray-900 flex items-center">
                                                    {user.name}
                                                    {renderUserRoleTag(user)}
                                                </div>
                                                <div className="text-xs text-gray-500">{userTeam?.name || 'Unassigned'}</div>
                                            </div>
                                        </div>
                                    </td>

                                    {dates.map(date => {
                                        const dayData = capacityData[user.id]?.[date];
                                        if (!dayData) return <td key={date} className="px-4 py-4"></td>;

                                        const isHovered = (hoveredCell?.userId === user.id && hoveredCell?.date === date) || 
                                                          (clickedCell?.userId === user.id && clickedCell?.date === date);

                                        return (
                                            <td
                                                key={date}
                                                className="px-2 py-2 relative"
                                                onMouseEnter={() => {
                                                    if (!clickedCell) setHoveredCell({ userId: user.id, date });
                                                }}
                                                onMouseLeave={() => setHoveredCell(null)}
                                                onClick={(e) => {
                                                    // Toggle clicked cell, but don't stop propagation if we are clicking tasks
                                                    if (clickedCell?.userId === user.id && clickedCell?.date === date) {
                                                        setClickedCell(null);
                                                    } else {
                                                        setClickedCell({ userId: user.id, date });
                                                        setHoveredCell(null);
                                                    }
                                                }}
                                            >
                                                <div className="space-y-1 cursor-pointer">
                                                    <div className="h-8 bg-gray-100 rounded relative overflow-hidden">
                                                        {dayData.leaveHours > 0 ? (
                                                            <div className="absolute inset-0 flex items-center justify-center bg-gray-200">
                                                                <span className="text-xs text-gray-600 font-medium">On Leave</span>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <div
                                                                    className="h-full transition-all"
                                                                    style={{
                                                                        width: `${Math.min(100, dayData.utilization)}%`,
                                                                        backgroundColor: getWorkloadColor(dayData.status)
                                                                    }}
                                                                ></div>
                                                                <div className="absolute inset-0 flex items-center justify-center">
                                                                    <span className="text-xs font-medium text-gray-700">
                                                                        {dayData.scheduledHours.toFixed(1)}h / {dayData.totalCapacity}h
                                                                    </span>
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>

                                                    {dayData.taskCount > 0 && (
                                                        <div className="text-center text-xs text-gray-500">
                                                            {dayData.taskCount} {dayData.taskCount === 1 ? 'task' : 'tasks'}
                                                        </div>
                                                    )}
                                                </div>

                                                {isHovered && dayData.tasks.length > 0 && (
                                                    <div 
                                                        className="absolute z-50 top-full left-1/2 transform -translate-x-1/2 mt-2 w-64 bg-gray-900 text-white rounded-lg shadow-xl p-3"
                                                        onClick={(e) => e.stopPropagation()} // Prevent clicking tooltip from closing it
                                                    >
                                                        <div className="text-xs font-medium mb-2 flex justify-between items-center">
                                                            <span>Tasks for {formatDate(date)}</span>
                                                            {clickedCell && (
                                                                <button onClick={() => setClickedCell(null)} className="text-gray-400 hover:text-white">
                                                                    ✕
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div className="space-y-2">
                                                            {dayData.tasks.slice(0, 3).map((task: Task) => (
                                                                <div
                                                                    key={task.id}
                                                                    className="text-xs cursor-pointer hover:bg-gray-800 p-1 rounded"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleTaskClick(task);
                                                                    }}
                                                                >
                                                                    <div className="font-medium">{task.title}</div>
                                                                    <div className="text-gray-300">
                                                                        {task.estimatedHours}h • {task.priority}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                            {dayData.tasks.length > 3 && (
                                                                <div className="text-xs text-gray-400">
                                                                    +{dayData.tasks.length - 3} more
                                                                </div>
                                                            )}
                                                        </div>
                                                        {/* Invisible bridge to prevent hover loss if they move mouse down quickly */}
                                                        <div className="absolute bottom-full left-0 w-full h-4"></div>
                                                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-900"></div>
                                                    </div>
                                                )}
                                            </td>
                                        );
                                    })}
                                    </tr>
                                );
                            })}
                        </React.Fragment>
                    ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderListView = () => (
        <div className="bg-white rounded-lg border border-gray-200">
            {/* Sort Controls */}
            <div className="border-b border-gray-200 p-4 flex items-center gap-4">
                <span className="text-sm font-medium text-gray-700">Sort by:</span>
                <div className="flex items-center gap-2">
                    {[
                        { value: 'dueDate', label: 'Due Date' },
                        { value: 'priority', label: 'Priority' },
                        { value: 'assignee', label: 'Assignee' },
                        { value: 'status', label: 'Status' },
                        { value: 'hours', label: 'Hours' },
                        { value: 'employee', label: 'Employee' }
                    ].map(option => (
                        <button
                            key={option.value}
                            onClick={() => {
                                if (sortBy === option.value) {
                                    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                                } else {
                                    setSortBy(option.value as SortOption);
                                    setSortDirection('asc');
                                }
                            }}
                            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${sortBy === option.value
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'text-gray-600 hover:bg-gray-100'
                                }`}
                        >
                            {option.label}
                            {sortBy === option.value && (
                                <ArrowUpDown className={`w-3 h-3 inline ml-1 ${sortDirection === 'desc' ? 'rotate-180' : ''}`} />
                            )}
                        </button>
                    ))}
                </div>
            </div>

            <div className="p-6 space-y-3">
                {activeTasks.map(task => {
                    const assignedUser = task.assignedToId ? users.find(u => u.id === task.assignedToId) : null;
                    const client = clients.find(c => c.id === task.clientId);
                    const category = workCategories.find(c => c.id === task.categoryId);
                    const userTeam = assignedUser ? getUserTeam(assignedUser.id) : null;

                    return (
                        <div
                            key={task.id}
                            onClick={() => handleTaskClick(task)}
                            className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer"
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div
                                            className="w-2 h-2 rounded-full"
                                            style={{ backgroundColor: getPriorityColor(task.priority) }}
                                        ></div>
                                        <h3 className="text-sm font-medium text-gray-900">{task.title}</h3>
                                        <span className={`text-xs px-2 py-0.5 rounded ${getStatusBadgeColor(task.status)}`}>
                                            {formatStatusLabel(task.status)}
                                        </span>
                                    </div>

                                    <p className="text-xs text-gray-600 mb-3">{task.description}</p>

                                    <div className="flex items-center gap-4 text-xs text-gray-500">
                                        <span>{client?.name}</span>
                                        <span>•</span>
                                        <span>{category?.name}</span>
                                        <span>•</span>
                                        <span>{task.estimatedHours}h</span>
                                        <span>•</span>
                                        <span>Due {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                    </div>
                                </div>

                                {assignedUser && (
                                    <div className="ml-4 flex items-center gap-2">
                                        <div
                                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium"
                                            style={{ backgroundColor: userTeam?.color || '#6B7280' }}
                                        >
                                            {assignedUser.name.split(' ').map(n => n[0]).join('')}
                                        </div>
                                        <div>
                                            <div className="text-xs font-medium text-gray-900 flex items-center">
                                                {assignedUser.name}
                                                {renderUserRoleTag(assignedUser)}
                                            </div>
                                            <div className="text-xs text-gray-500">{userTeam?.name}</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );

    const handleDragStart = (e: React.DragEvent, taskId: string) => {
        e.dataTransfer.setData('text/plain', taskId);
    };

    const handleDrop = (e: React.DragEvent, newAssigneeId: string) => {
        e.preventDefault();
        const taskId = e.dataTransfer.getData('text/plain');
        if (taskId) {
            setLocalTasks(prev => prev.map(t => 
                t.id === taskId ? { ...t, assignedToId: newAssigneeId } : t
            ));
        }
    };

    const renderBoardView = () => {
        return (
            <div className="bg-white rounded-lg border border-gray-200 p-6 overflow-x-auto">
                <div className="flex gap-8 min-w-max items-start">
                    {Object.entries(membersByTeam).map(([teamName, { team, members }]) => (
                        <div key={teamName} className="flex flex-col bg-gray-50/50 p-4 rounded-lg border border-gray-200 shrink-0">
                            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-4">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: team?.color || '#9CA3AF' }}></div>
                                {teamName}
                            </h3>
                            <div className="flex gap-4 items-start">
                                {members.map(user => {
                                    const columnTasks = activeTasks.filter(t => t.assignedToId === user.id);
                        const userTeam = getUserTeam(user.id);
                        const isCurrentUser = user.id === currentUser.id;

                        return (
                            <div key={user.id} className="space-y-3 w-72 flex-shrink-0">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                        <div 
                                            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-medium"
                                            style={{ backgroundColor: userTeam?.color || '#6B7280' }}
                                        >
                                            {user.name.split(' ').map(n => n[0]).join('')}
                                        </div>
                                        <div className="flex items-center">
                                            {user.name} {isCurrentUser && <span className="text-gray-400 font-normal ml-1">(You)</span>}
                                            {renderUserRoleTag(user)}
                                        </div>
                                    </h3>
                                    <span className="text-xs text-gray-500">{columnTasks.length} tasks</span>
                                </div>

                                <div 
                                    className="space-y-2 min-h-[400px]"
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => handleDrop(e, user.id)}
                                >
                                    {columnTasks.map(task => {
                                        const client = clients.find(c => c.id === task.clientId);

                                        return (
                                            <div
                                                key={task.id}
                                                draggable
                                                onDragStart={(e) => handleDragStart(e, task.id)}
                                                onClick={() => handleTaskClick(task)}
                                                className="bg-gray-50 border border-gray-200 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow active:cursor-grabbing"
                                            >
                                                <div className="flex items-start gap-2 mb-2">
                                                    <div
                                                        className="w-1 h-1 rounded-full mt-1.5"
                                                        style={{ backgroundColor: getPriorityColor(task.priority) }}
                                                    ></div>
                                                    <h4 className="text-sm font-medium text-gray-900 flex-1">{task.title}</h4>
                                                </div>

                                                <p className="text-xs text-gray-600 mb-2 line-clamp-2">{task.description}</p>

                                                <div className="flex items-center justify-between">
                                                    <div className="text-xs text-gray-500 font-medium">
                                                        {task.estimatedHours}h
                                                    </div>
                                                    
                                                    {/* Status Badge */}
                                                    <div className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-200 text-gray-700 capitalize">
                                                        {task.status.replace('_', ' ')}
                                                    </div>
                                                </div>

                                                <div className="text-xs text-gray-500 mt-2">
                                                    Due {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderTimelineView = () => {

        // 2. Group dates by month (for the top header)
        const monthGroups: { name: string, count: number }[] = [];
        let currentMonth = '';
        let count = 0;
        dates.forEach(d => {
            const dateObj = new Date(d);
            const monthStr = dateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            if (monthStr !== currentMonth) {
                if (currentMonth) monthGroups.push({ name: currentMonth, count });
                currentMonth = monthStr;
                count = 1;
            } else {
                count++;
            }
        });
        if (currentMonth) monthGroups.push({ name: currentMonth, count });

        return (
            <TimelineContainer>
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col max-h-[75vh]">
                    <div className="overflow-x-auto overflow-y-auto">
                        <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
                        <thead className="bg-white sticky top-0 z-30 shadow-sm">
                            {/* Month Header Row */}
                            <tr>
                                <th className="w-64 min-w-[256px] sticky left-0 z-40 bg-white border-r border-b border-gray-200 px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">
                                    Team Member
                                </th>
                                {monthGroups.map((mg, i) => (
                                    <th key={i} colSpan={mg.count} className="border-r border-b border-gray-200 px-4 py-2 text-center text-xs font-semibold text-gray-700 bg-gray-50">
                                        {mg.name}
                                    </th>
                                ))}
                            </tr>
                            {/* Days Header Row */}
                            <tr>
                                <th className="w-64 min-w-[256px] sticky left-0 z-40 bg-white border-r border-b border-gray-200"></th>
                                {dates.map((date, idx) => {
                                    const dateObj = new Date(date);
                                    const isToday = date === new Date().toISOString().split('T')[0];
                                    return (
                                        <th key={idx} className={`w-12 min-w-[48px] border-r border-b border-gray-200 px-1 py-1 text-center text-[10px] font-medium ${isToday ? 'bg-blue-50 text-blue-600' : 'bg-white text-gray-500'}`}>
                                            <div>{dateObj.toLocaleDateString('en-US', { weekday: 'narrow' })}</div>
                                            <div className={isToday ? 'font-bold' : ''}>{dateObj.getDate()}</div>
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody className="bg-white">
                            {Object.entries(membersByTeam).map(([teamName, { team, members }]) => (
                                <React.Fragment key={teamName}>
                                    {/* Team Header Row */}
                                    <tr className="bg-gray-50/80">
                                        <td className="sticky left-0 z-20 bg-gray-50 border-r border-b border-gray-200 px-4 py-2.5 font-medium text-sm text-gray-900 flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: team?.color || '#9CA3AF' }}></div>
                                            {teamName}
                                        </td>
                                        {dates.map((date, idx) => (
                                            <td key={idx} className="border-r border-b border-gray-200 bg-gray-50/50"></td>
                                        ))}
                                    </tr>
                                    
                                    {/* Member Rows */}
                                    {members.map(user => {
                                        const userTasks = activeTasks
                                            .filter(t => t.assignedToId === user.id && t.proposedStartDate && t.proposedEndDate)
                                            .sort((a, b) => new Date(a.proposedStartDate!).getTime() - new Date(b.proposedStartDate!).getTime());
                                        
                                        // Calculate max tracks to set row height
                                        let maxTrack = 0;
                                        const trackAssignments: number[] = [];
                                        
                                        userTasks.forEach((task, idx) => {
                                            const startDate = new Date(task.proposedStartDate!).getTime();
                                            let track = 0;
                                            // Find first available track
                                            while (true) {
                                                const conflict = userTasks.slice(0, idx).some((prevTask, prevIdx) => {
                                                    if (trackAssignments[prevIdx] !== track) return false;
                                                    const prevEnd = new Date(prevTask.proposedEndDate!).getTime();
                                                    const prevStart = new Date(prevTask.proposedStartDate!).getTime();
                                                    return (startDate <= prevEnd && new Date(task.proposedEndDate!).getTime() >= prevStart);
                                                });
                                                if (!conflict) break;
                                                track++;
                                            }
                                            trackAssignments[idx] = track;
                                            maxTrack = Math.max(maxTrack, track);
                                        });

                                        const rowHeight = Math.max(48, (maxTrack + 1) * 32 + 16);

                                        return (
                                            <tr key={user.id} className="group hover:bg-gray-50/50 transition-colors">
                                                <td className="sticky left-0 z-20 bg-white group-hover:bg-gray-50 border-r border-b border-gray-200 px-4 py-3 pl-8 transition-colors" style={{ height: `${rowHeight}px` }}>
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-medium" style={{ backgroundColor: team?.color || '#6B7280' }}>
                                                            {user.name.split(' ').map(n => n[0]).join('')}
                                                        </div>
                                                        <div className="flex items-center text-sm text-gray-700 font-medium truncate">
                                                            {user.name}
                                                            {renderUserRoleTag(user)}
                                                        </div>
                                                    </div>
                                                </td>
                                                
                                                {/* Task Rendering Area */}
                                                <td colSpan={dates.length} className="relative border-b border-gray-200 p-0" style={{ height: `${rowHeight}px` }}>
                                                    <div className="absolute inset-0 flex">
                                                        {dates.map((date, idx) => {
                                                            const isWeekend = new Date(date).getDay() === 0 || new Date(date).getDay() === 6;
                                                            return (
                                                                <div key={idx} className={`flex-1 border-r border-gray-200 ${isWeekend ? 'bg-gray-50/50' : ''}`}></div>
                                                            );
                                                        })}
                                                    </div>
                                                    
                                                    <div className="absolute inset-0 py-2">
                                                        {userTasks.map((task, idx) => {
                                                            const startDate = new Date(task.proposedStartDate!);
                                                            const endDate = new Date(task.proposedEndDate!);
                                                            const rangeStart = new Date(dates[0]);
                                                            const rangeEnd = new Date(dates[dates.length - 1]);
                                                            rangeEnd.setHours(23, 59, 59, 999);

                                                            if (endDate < rangeStart || startDate > rangeEnd) return null; // Outside view

                                                            const taskStart = Math.max(startDate.getTime(), rangeStart.getTime());
                                                            const taskEnd = Math.min(endDate.getTime(), rangeEnd.getTime());
                                                            const totalRange = rangeEnd.getTime() - rangeStart.getTime();
                                                            
                                                            const left = ((taskStart - rangeStart.getTime()) / totalRange) * 100;
                                                            let width = ((taskEnd - taskStart) / totalRange) * 100;
                                                            
                                                            // Give minimum width for visibility
                                                            width = Math.max(width, (1 / dates.length) * 100);
                                                            
                                                            const isCompleted = task.status === 'completed';
                                                            const track = trackAssignments[idx];

                                                            return (
                                                                <div
                                                                    key={task.id}
                                                                    onClick={() => handleTaskClick(task)}
                                                                    className={`absolute h-7 rounded px-2 text-[11px] flex items-center overflow-hidden cursor-pointer shadow-sm hover:shadow-md transition-all ${isCompleted ? 'opacity-60' : ''}`}
                                                                    style={{
                                                                        backgroundColor: `${team?.color || '#6B7280'}25`,
                                                                        borderLeft: `3px solid ${team?.color || '#6B7280'}`,
                                                                        color: '#1F2937',
                                                                        left: `${left}%`,
                                                                        width: `${width}%`,
                                                                        top: `${8 + track * 32}px`,
                                                                        zIndex: 10 + track
                                                                    }}
                                                                    title={`${task.title} (${task.status})`}
                                                                >
                                                                    <span className="truncate font-medium flex items-center gap-1.5">
                                                                        {isCompleted && <span className="text-green-600">✓</span>}
                                                                        {task.title}
                                                                    </span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                })}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
                </div>
                </div>
            </TimelineContainer>
        );
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-gray-900">Team Workload</h1>
                    <p className="text-sm text-gray-600 mt-1">View and manage team capacity and task assignments</p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`px-4 py-2 border rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-2 ${showFilters ? 'border-blue-500 text-blue-700 bg-blue-50' : 'border-gray-300 text-gray-700'
                            }`}
                    >
                        <Filter className="w-4 h-4" />
                        Filters
                        {(filterPriority.length + filterStatus.length + filterCategory.length > 0) && (
                            <span className="ml-1 px-1.5 py-0.5 bg-blue-500 text-white text-xs rounded-full">
                                {filterPriority.length + filterStatus.length + filterCategory.length}
                            </span>
                        )}
                    </button>
                    <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
                        <Download className="w-4 h-4" />
                        Export
                    </button>
                </div>
            </div>

            {/* Summary Stats - Moved to top */}
            <div className="grid grid-cols-4 gap-4">
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="text-sm text-gray-600">Total Team Members</div>
                    <div className="text-2xl font-semibold text-gray-900 mt-1">{teamMembers.length}</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="text-sm text-gray-600">Available Members</div>
                    <div className="text-2xl font-semibold text-green-600 mt-1">
                        {teamMembers.filter(user => {
                            const today = dates[0];
                            const capacity = capacityData[user.id]?.[today];
                            return capacity && capacity.status === 'available';
                        }).length}
                    </div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="text-sm text-gray-600">Near Capacity</div>
                    <div className="text-2xl font-semibold text-orange-600 mt-1">
                        {teamMembers.filter(user => {
                            const today = dates[0];
                            const capacity = capacityData[user.id]?.[today];
                            return capacity && capacity.status === 'near_capacity';
                        }).length}
                    </div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="text-sm text-gray-600">Overallocated</div>
                    <div className="text-2xl font-semibold text-red-600 mt-1">
                        {teamMembers.filter(user => {
                            const today = dates[0];
                            const capacity = capacityData[user.id]?.[today];
                            return capacity && capacity.status === 'overallocated';
                        }).length}
                    </div>
                </div>
            </div>

            {/* Filters Panel */}
            {showFilters && (
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="grid grid-cols-3 gap-6">
                        <div>
                            <label className="text-sm font-medium text-gray-700 mb-2 block">Priority</label>
                            <div className="space-y-2">
                                {['urgent', 'high', 'normal', 'low'].map(priority => (
                                    <label key={priority} className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={filterPriority.includes(priority)}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setFilterPriority([...filterPriority, priority]);
                                                } else {
                                                    setFilterPriority(filterPriority.filter(p => p !== priority));
                                                }
                                            }}
                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <span className="text-sm text-gray-700 capitalize">{priority}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="text-sm font-medium text-gray-700 mb-2 block">Status</label>
                            <div className="space-y-2">
                                {['scheduled', 'in_progress', 'on_hold'].map(status => (
                                    <label key={status} className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={filterStatus.includes(status)}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setFilterStatus([...filterStatus, status]);
                                                } else {
                                                    setFilterStatus(filterStatus.filter(s => s !== status));
                                                }
                                            }}
                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <span className="text-sm text-gray-700">{formatStatusLabel(status)}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="text-sm font-medium text-gray-700 mb-2 block">Category</label>
                            <div className="space-y-2 max-h-32 overflow-y-auto">
                                {workCategories.slice(0, 5).map(category => (
                                    <label key={category.id} className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={filterCategory.includes(category.id)}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setFilterCategory([...filterCategory, category.id]);
                                                } else {
                                                    setFilterCategory(filterCategory.filter(c => c !== category.id));
                                                }
                                            }}
                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <span className="text-sm text-gray-700">{category.name}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-gray-200 flex items-center justify-end gap-2">
                        <button
                            onClick={() => {
                                setFilterPriority([]);
                                setFilterStatus([]);
                                setFilterCategory([]);
                            }}
                            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
                        >
                            Clear All
                        </button>
                    </div>
                </div>
            )}

            {/* Filters and View Mode */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <label className="text-sm font-medium text-gray-700">Team:</label>
                        <select
                            value={selectedTeamId}
                            onChange={(e) => setSelectedTeamId(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        >
                            <option value="all">All Teams</option>
                            {visibleTeams.map(team => (
                                <option key={team.id} value={team.id}>{team.name}</option>
                            ))}
                        </select>

                        {viewMode === 'calendar' && (
                            <>
                                <div className="h-6 w-px bg-gray-300"></div>
                                <div className="flex items-center gap-2">
                                    {(['day', 'week', 'month'] as CalendarView[]).map(view => (
                                        <button
                                            key={view}
                                            onClick={() => setCalendarView(view)}
                                            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${calendarView === view
                                                    ? 'bg-blue-100 text-blue-700'
                                                    : 'text-gray-600 hover:bg-gray-100'
                                                }`}
                                        >
                                            {view.charAt(0).toUpperCase() + view.slice(1)}
                                        </button>
                                    ))}
                                </div>

                                <div className="h-6 w-px bg-gray-300"></div>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={showWeekends}
                                        onChange={(e) => setShowWeekends(e.target.checked)}
                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-gray-700">Show Weekends</span>
                                </label>
                            </>
                        )}
                    </div>

                    {/* View Mode Selector */}
                    <div className="flex items-center p-1 bg-[#F8F9FA] rounded-xl">
                        <button
                            onClick={() => setViewMode('calendar')}
                            className={`p-2 rounded-lg transition-all flex items-center justify-center ${viewMode === 'calendar' ? 'bg-white text-blue-600 shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'}`}
                            title="Capacity View"
                        >
                            <Calendar className="w-5 h-5" strokeWidth={1.5} />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-2 rounded-lg transition-all flex items-center justify-center ${viewMode === 'list' ? 'bg-white text-blue-600 shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'}`}
                            title="List View"
                        >
                            <List className="w-5 h-5" strokeWidth={1.5} />
                        </button>
                        <button
                            onClick={() => setViewMode('board')}
                            className={`p-2 rounded-lg transition-all flex items-center justify-center ${viewMode === 'board' ? 'bg-white text-blue-600 shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'}`}
                            title="Board View"
                        >
                            <LayoutGrid className="w-5 h-5" strokeWidth={1.5} />
                        </button>
                        <button
                            onClick={() => setViewMode('timeline')}
                            className={`p-2 rounded-lg transition-all flex items-center justify-center ${viewMode === 'timeline' ? 'bg-white text-blue-600 shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'}`}
                            title="Timeline View"
                        >
                            <GanttChart className="w-5 h-5" strokeWidth={1.5} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Legend - only show for capacity view */}
            {viewMode === 'calendar' && (
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center gap-6 text-sm">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded" style={{ backgroundColor: '#10B981' }}></div>
                            <span className="text-gray-600">0-49% Available</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded" style={{ backgroundColor: '#3B82F6' }}></div>
                            <span className="text-gray-600">50-79% Balanced</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded" style={{ backgroundColor: '#F59E0B' }}></div>
                            <span className="text-gray-600">80-100% Near Capacity</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded" style={{ backgroundColor: '#EF4444' }}></div>
                            <span className="text-gray-600">100%+ Overallocated</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Render selected view */}
            {viewMode === 'calendar' && renderCalendarView()}
            {viewMode === 'list' && renderListView()}
            {viewMode === 'board' && renderBoardView()}
            {viewMode === 'timeline' && renderTimelineView()}

            {/* Task Details Panel */}
            <TaskDetailsPanel
                task={selectedTask}
                isOpen={isTaskPanelOpen}
                onClose={() => {
                    setIsTaskPanelOpen(false);
                    setSelectedTask(null);
                }}
                currentUser={currentUser}
                onStatusChange={handleStatusChange}
            />
        </div>
    );
}