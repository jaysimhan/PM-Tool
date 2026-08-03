import React, { useState, useMemo, useEffect } from 'react';
import { 
    Priority, Status, Brand, Region, ViewMode as HelperViewMode, TimeScale, 
    PRIORITY_CONFIG, STATUS_CONFIG, BRAND_CONFIG, REGION_CONFIG, 
    loadColor, loadLabel, PriorityPill, Pill, CapBar, ViewIcons 
} from './WorkloadDashboardHelpers';

import { User, Task, isPreMember } from '../types/types';
import { useData } from '../contexts/DataContext';
import { calculateDailyCapacity, getDatesInRange, formatDate, getWorkloadColor, getStatusBadgeColor, formatStatusLabel, getPriorityColor, getProjectTimelineBounds, getTimelineColumns, TimelineColumn } from '../utils/capacityCalculations';
import { Filter, Download, Calendar, List, LayoutGrid, GanttChart, ArrowUpDown } from 'lucide-react';
import TaskDetailsPanel from './TaskDetailsPanel';
import { TimelineContainer } from './TimelineContainer';
import { useTestEnvironment } from '../lib/testEnvironment';
import { useMemberFilter } from '../contexts/MemberViewContext';

interface Props {
    currentUser: User;
}

type ViewMode = 'calendar' | 'list' | 'board' | 'timeline';
type CalendarView = 'day' | 'week' | 'month';
type SortOption = 'dueDate' | 'priority' | 'assignee' | 'status' | 'hours' | 'employee';

// Chromium drops a collapsed-border table cell's border while the cell is sticky and the
// table scrolls horizontally, so the frozen columns' edges vanish mid-scroll. An absolutely
// positioned child isn't a collapsed border, so it survives the scroll and stays glued to
// the real cell edge (the columns are auto-width, so a fixed offset would misalign).
const FreezeEdge = ({ side }: { side: 'left' | 'right' }) => (
    <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 ${side === 'right' ? 'right-0' : 'left-0'} w-px bg-gray-200`}
    />
);

export default function WorkloadDashboard({ currentUser }: Props) {
    const { users, teams, tasks, leaves, clients, regions, allTags, workCategories } = useData();
    const [localTasks, setLocalTasks] = useState(tasks);
    
    useEffect(() => {
        setLocalTasks(tasks);
    }, [tasks]);
    const [selectedTeamId, setSelectedTeamId] = useState<string>('all');
    const [startDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [hoveredCell, setHoveredCell] = useState<{ userId: string; date: string } | null>(null);
    const [clickedCell, setClickedCell] = useState<{ userId: string; date: string } | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('calendar');
    // The timeline is still being worked on, so it only exists in the test environment
    // (/test/workload) and only for the super admin. Everywhere else the toggle is absent
    // and the view cannot be reached.
    const showTimeline = useTestEnvironment(currentUser);
    // Whoever was picked in the header, or null for all members.
    const memberFilter = useMemberFilter();
    const viewModes: ViewMode[] = showTimeline
        ? ['calendar', 'list', 'board', 'timeline']
        : ['calendar', 'list', 'board'];
    // Leaving the test environment while the timeline is up must not leave the page on a
    // view it no longer offers — this component keeps its state across that navigation.
    useEffect(() => {
        if (!showTimeline) setViewMode(prev => (prev === 'timeline' ? 'calendar' : prev));
    }, [showTimeline]);
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
    const [filterBrand, setFilterBrand] = useState<string[]>([]);
    const [filterRegion, setFilterRegion] = useState<string[]>([]);
    const [filterTag, setFilterTag] = useState<string[]>([]);

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

    // Visible teams based on user role
    const visibleTeams = useMemo(() => {
        if (currentUser.role === 'super_admin' || currentUser.role === 'admin' || currentUser.role === 'manager') {
            return teams;
        }
        return teams.filter(t => t.memberIds && t.memberIds.includes(currentUser.id));
    }, [currentUser, teams]);

    // Get team members based on selected team
    const teamMembers = useMemo(() => {
        // One person picked in the header wins over the team selector: the grid, the stats
        // and the board columns are all built from this list.
        if (memberFilter) {
            return users.filter(u => u.id === memberFilter);
        }
        if (selectedTeamId === 'all') {
            const visibleTeamIds = visibleTeams.map(t => t.id);
            return users.filter(u =>
                !isPreMember(u.role) &&
                u.isActive &&
                (currentUser.role === 'super_admin' || currentUser.role === 'admin' || currentUser.role === 'manager' || (u.teamIds && u.teamIds.some(tid => visibleTeamIds.includes(tid))) || u.id === currentUser.id)
            );
        }

        const team = teams.find(t => t.id === selectedTeamId);
        // Same rule as the all-teams branch above: deactivated people are out of workload
        // planning, which is the whole point of deactivating them.
        return team ? users.filter(u => u.teamIds && u.teamIds.includes(selectedTeamId) && u.isActive) : [];
    }, [selectedTeamId, visibleTeams, users, tasks, currentUser, memberFilter]);

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
            if (!user.teamIds || user.teamIds.length === 0) {
                map.set(user.id, null);
            } else {
                map.set(user.id, teams.find(t => t.id === user.teamIds[0]) || null);
            }
        });
        return map;
    }, [users, teams]);

    const getUserTeam = (userId: string) => userTeamMap.get(userId) || null;

    // Get all active tasks for board/list views with filters
    const activeTasks = useMemo(() => {
        const visibleTeamIds = visibleTeams.map(t => t.id);
        let filtered = localTasks.filter(t =>
            (t.status === 'in_progress' || t.status === 'scheduled' || t.status === 'accepted' || t.status === 'on_hold') &&
            (selectedTeamId === 'all' 
                ? (currentUser.role === 'super_admin' || currentUser.role === 'admin' || currentUser.role === 'manager' || (t.teamIds && t.teamIds.some(tid => visibleTeamIds.includes(tid))) || t.assignedToId === currentUser.id)
                : (t.teamIds && t.teamIds.includes(selectedTeamId)))
        );

        // Apply filters
        if (filterPriority.length > 0) {
            filtered = filtered.filter(t => t.priority && filterPriority.includes(t.priority));
        }
        if (filterStatus.length > 0) {
            filtered = filtered.filter(t => filterStatus.includes(t.status));
        }
        if (filterBrand.length > 0) {
            filtered = filtered.filter(t => filterBrand.includes(t.clientId));
        }
        if (filterRegion.length > 0) {
            filtered = filtered.filter(t => t.regionId && filterRegion.includes(t.regionId));
        }
        if (filterTag.length > 0) {
            filtered = filtered.filter(t => t.tags && t.tags.some(tag => filterTag.includes(tag.id)));
        }
        if (memberFilter) {
            filtered = filtered.filter(t => t.assignedToId === memberFilter);
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
    }, [selectedTeamId, filterPriority, filterStatus, filterBrand, filterRegion, filterTag, memberFilter, sortBy, sortDirection, viewMode]);

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
                                <FreezeEdge side="right" />
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
                            <th className="sticky right-0 z-20 bg-gray-50 px-4 py-3 text-center border-l border-gray-200 min-w-[100px] text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                                Total
                                <FreezeEdge side="left" />
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {Object.entries(membersByTeam).map(([teamName, { team, members }]) => (
                            <React.Fragment key={teamName}>
                                <tr className="bg-gray-50/80">
                                    <td className="sticky left-0 z-20 bg-gray-50 border-b border-r border-gray-200 px-6 py-2.5 font-medium text-sm text-gray-900">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: team?.color || '#9CA3AF' }}></div>
                                            {teamName}
                                            <div className="flex h-[18px] items-center justify-center rounded-[150px] bg-[#e5e7eb] px-2 min-w-[22px] ml-1">
                                                <span className="font-semibold text-[#364153] text-[11px]">{members.length}</span>
                                            </div>
                                        </div>
                                        <FreezeEdge side="right" />
                                    </td>
                                    <td colSpan={dates.length} className="border-b border-gray-200 bg-gray-50/80"></td>
                                    <td className="sticky right-0 z-20 border-b border-l border-gray-200 bg-gray-50/80">
                                        <FreezeEdge side="left" />
                                    </td>
                                </tr>
                                {members.map(user => {
                                    const userTeam = team;

                                    return (
                                <tr key={user.id} className="hover:bg-gray-50 group transition-colors">
                                    <td className="sticky left-0 z-10 bg-white group-hover:bg-gray-50 transition-colors px-6 py-4 whitespace-nowrap border-r border-gray-200">
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
                                        <FreezeEdge side="right" />
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
                                                    <CapBar 
                                                        hours={dayData.scheduledHours} 
                                                        capacity={dayData.totalCapacity} 
                                                        isLeave={dayData.leaveHours > 0} 
                                                    />
                                                    {dayData.taskCount > 0 && (
                                                        <div className="text-center text-[10px] text-gray-400 font-medium mt-1">
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
                                    
                                    {/* Total Column */}
                                    <td className="sticky right-0 z-10 bg-white group-hover:bg-gray-50 transition-colors px-4 py-2 border-l border-gray-200 text-center align-middle">
                                        <FreezeEdge side="left" />
                                        {(() => {
                                            const totalHours = dates.reduce((sum, d) => sum + (capacityData[user.id]?.[d]?.scheduledHours || 0), 0);
                                            const totalCapacity = dates.reduce((sum, d) => sum + (capacityData[user.id]?.[d]?.totalCapacity || 8), 0);
                                            const utilization = totalCapacity > 0 ? (totalHours / totalCapacity) * 100 : 0;
                                            
                                            let statusText = 'Available';
                                            let statusColor = '#10b981'; // green
                                            
                                            if (utilization > 100) {
                                                statusText = 'Overallocated';
                                                statusColor = '#ef4444'; // red
                                            } else if (utilization >= 80) {
                                                statusText = 'Balanced'; 
                                                statusColor = '#f59e0b'; // orange
                                            }
                                            
                                            return (
                                                <div className="flex flex-col items-center justify-center h-full">
                                                    <div className="font-semibold text-sm leading-5" style={{ color: statusColor }}>
                                                        {totalHours > 0 ? `${totalHours % 1 === 0 ? totalHours : totalHours.toFixed(1)}h` : '—'}
                                                    </div>
                                                    <div className="text-[10px] text-gray-400 mt-0.5 font-medium">
                                                        {totalHours > 0 ? statusText : 'Available'}
                                                    </div>
                                                </div>
                                            );
                                        })()}
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
                                <div className="flex h-[18px] items-center justify-center rounded-[150px] bg-[#e5e7eb] px-2 min-w-[22px] ml-1">
                                    <span className="font-semibold text-[#364153] text-[11px]">{members.length}</span>
                                </div>
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
                                                        {task.status.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
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
        const timelineBounds = getProjectTimelineBounds(activeTasks);
        const timelineColumns = getTimelineColumns(timelineBounds, calendarView);
        const totalDurationMs = timelineBounds.end.getTime() - timelineBounds.start.getTime();

        // Group columns for the top header (e.g. Month for Day/Week scale, Year for Month scale)
        const headerGroups: { name: string, count: number }[] = [];
        let currentGroup = '';
        let count = 0;

        timelineColumns.forEach(col => {
            let groupName = '';
            if (calendarView === 'day' || calendarView === 'week') {
                groupName = col.date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            } else {
                groupName = col.date.getFullYear().toString();
            }

            if (groupName !== currentGroup) {
                if (currentGroup) headerGroups.push({ name: currentGroup, count });
                currentGroup = groupName;
                count = 1;
            } else {
                count++;
            }
        });
        if (currentGroup) headerGroups.push({ name: currentGroup, count });

        const tableMinWidth = calendarView === 'day' ? timelineColumns.length * 48 : calendarView === 'week' ? timelineColumns.length * 100 : timelineColumns.length * 150;

        return (
            <TimelineContainer>
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col max-h-[75vh]">
                    <div className="overflow-x-auto overflow-y-auto">
                        <table className="border-collapse" style={{ tableLayout: 'fixed', minWidth: `${tableMinWidth + 256}px`, width: '100%' }}>
                        <thead className="bg-white sticky top-0 z-30 shadow-sm">
                            {/* Top Header Row */}
                            <tr>
                                <th className="w-64 min-w-[256px] sticky left-0 z-40 bg-white border-r border-b border-gray-200 px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">
                                    Team Member
                                    <FreezeEdge side="right" />
                                </th>
                                {headerGroups.map((hg, i) => (
                                    <th key={i} colSpan={hg.count} className="border-r border-b border-gray-200 px-4 py-2 text-center text-xs font-semibold text-gray-700 bg-gray-50">
                                        {hg.name}
                                    </th>
                                ))}
                            </tr>
                            {/* Column Header Row */}
                            <tr>
                                <th className="w-64 min-w-[256px] sticky left-0 z-40 bg-white border-r border-b border-gray-200">
                                    <FreezeEdge side="right" />
                                </th>
                                {timelineColumns.map((col, idx) => {
                                    const isToday = col.date <= new Date() && col.endDate >= new Date();
                                    const startOffset = Math.max(0, col.date.getTime() - timelineBounds.start.getTime());
                                    const endOffset = Math.min(totalDurationMs, col.endDate.getTime() - timelineBounds.start.getTime());
                                    const widthPercent = ((endOffset - startOffset) / totalDurationMs) * 100;
                                    
                                    return (
                                        <th key={idx} style={{ width: `${widthPercent}%` }} className={`border-r border-b border-gray-200 px-1 py-1 text-center text-[10px] font-medium ${isToday ? 'bg-blue-50 text-blue-600' : 'bg-white text-gray-500'}`}>
                                            <div>{col.subLabel}</div>
                                            <div className={isToday ? 'font-bold' : ''}>{col.label}</div>
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
                                        <td className="sticky left-0 z-20 bg-gray-50 border-r border-b border-gray-200 px-4 py-2.5 font-medium text-sm text-gray-900">
                                            <div className="flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: team?.color || '#9CA3AF' }}></div>
                                                {teamName}
                                                <div className="flex h-[18px] items-center justify-center rounded-[150px] bg-[#e5e7eb] px-2 min-w-[22px] ml-1">
                                                    <span className="font-semibold text-[#364153] text-[11px]">{members.length}</span>
                                                </div>
                                            </div>
                                            <FreezeEdge side="right" />
                                        </td>
                                        <td colSpan={timelineColumns.length} className="border-r border-b border-gray-200 bg-gray-50/50 p-0 relative">
                                            <div className="absolute inset-0 flex">
                                                {timelineColumns.map((col, idx) => {
                                                    const startOffset = Math.max(0, col.date.getTime() - timelineBounds.start.getTime());
                                                    const endOffset = Math.min(totalDurationMs, col.endDate.getTime() - timelineBounds.start.getTime());
                                                    const widthPercent = ((endOffset - startOffset) / totalDurationMs) * 100;
                                                    return (
                                                        <div key={idx} style={{ width: `${widthPercent}%` }} className={`border-r border-gray-200 ${col.isWeekend ? 'bg-gray-100/50' : ''}`}></div>
                                                    );
                                                })}
                                            </div>
                                        </td>
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
                                                    <FreezeEdge side="right" />
                                                </td>
                                                
                                                {/* Task Rendering Area */}
                                                <td colSpan={timelineColumns.length} className="relative border-b border-gray-200 p-0" style={{ height: `${rowHeight}px` }}>
                                                    <div className="absolute inset-0 flex">
                                                        {timelineColumns.map((col, idx) => {
                                                            const startOffset = Math.max(0, col.date.getTime() - timelineBounds.start.getTime());
                                                            const endOffset = Math.min(totalDurationMs, col.endDate.getTime() - timelineBounds.start.getTime());
                                                            const widthPercent = ((endOffset - startOffset) / totalDurationMs) * 100;
                                                            return (
                                                                <div key={idx} style={{ width: `${widthPercent}%` }} className={`border-r border-gray-200 ${col.isWeekend ? 'bg-gray-50/50' : ''}`}></div>
                                                            );
                                                        })}
                                                    </div>
                                                    
                                                    <div className="absolute inset-0 py-2">
                                                        {userTasks.map((task, idx) => {
                                                            const startDate = new Date(task.proposedStartDate!);
                                                            const endDate = new Date(task.proposedEndDate!);
                                                            
                                                            const rangeStart = timelineBounds.start.getTime();
                                                            const rangeEnd = timelineBounds.end.getTime();

                                                            if (endDate.getTime() < rangeStart || startDate.getTime() > rangeEnd) return null; // Outside view

                                                            const taskStart = Math.max(startDate.getTime(), rangeStart);
                                                            const taskEnd = Math.min(endDate.getTime(), rangeEnd);
                                                            
                                                            const left = ((taskStart - rangeStart) / totalDurationMs) * 100;
                                                            let width = ((taskEnd - taskStart) / totalDurationMs) * 100;
                                                            
                                                            // Give minimum width for visibility
                                                            width = Math.max(width, 0.5);
                                                            
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

    
    const activeCount = filterPriority.length + filterStatus.length + filterBrand.length + filterRegion.length + filterTag.length;
    
    const totalMembers = teamMembers.length;
    const availableMembers = teamMembers.filter(user => {
        const today = dates[0];
        const capacity = capacityData[user.id]?.[today];
        return capacity && capacity.status === 'available';
    }).length;
    const nearCapacityMembers = teamMembers.filter(user => {
        const today = dates[0];
        const capacity = capacityData[user.id]?.[today];
        return capacity && capacity.status === 'near_capacity';
    }).length;
    const overallocatedMembers = teamMembers.filter(user => {
        const today = dates[0];
        const capacity = capacityData[user.id]?.[today];
        return capacity && capacity.status === 'overallocated';
    }).length;

    const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low'];
    const STATUSES: string[] = ['scheduled', 'in_progress', 'in_review', 'on_hold', 'completed'];

    // min-h-full, not min-h-screen: this renders below the dashboard header, so a full
    // viewport of height here overflows the pane it sits in by exactly that header.
    return (
        <div className="min-h-full font-sans" style={{ backgroundColor: '#f9fafb' }}>
            {/* Header */}
            <div className="bg-white border-b border-gray-100">
                <div className="max-w-screen-xl mx-auto w-full px-8 pt-5 pb-3">
                    
                    {/* Row 1: title + KPIs */}
                    <div className="flex items-start justify-between gap-8 mb-4">
                        <div className="shrink-0">
                            <h1 className="text-lg font-semibold text-gray-900 tracking-tight">Team Workload</h1>
                            <p className="text-sm text-gray-400 mt-0.5">Lifetime overview</p>
                        </div>
                        <div className="flex items-center gap-6">
                            {[
                                { label: 'Total Members',   value: totalMembers,         color: '#111827' },
                                { label: 'Available',       value: availableMembers,     color: '#10b981' },
                                { label: 'Near Capacity',   value: nearCapacityMembers,  color: '#f59e0b' },
                                { label: 'Overallocated',   value: overallocatedMembers, color: '#ef4444' },
                            ].map(({ label, value, color }) => (
                                <div key={label} className="text-center shrink-0">
                                    <div className="text-xl font-semibold tabular-nums leading-none" style={{ color }}>{value}</div>
                                    <div className="text-[11px] text-gray-400 mt-1 whitespace-nowrap">{label}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Row 2: controls */}
                    <div className="flex items-center gap-3 border-t border-gray-100 pt-3">
                        {/* Team */}
                        <select
                            value={selectedTeamId}
                            onChange={e => setSelectedTeamId(e.target.value)}
                            className="h-8 pl-3 pr-7 text-xs text-gray-700 bg-white border border-gray-200 rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer"
                            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5l3.5 3.5 3.5-3.5' stroke='%239ca3af' stroke-width='1.3' stroke-linecap='round' fill='none'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
                        >
                            <option value="all">All Teams</option>
                            {visibleTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>

                        {viewMode === 'calendar' && (
                            <>
                                {/* Timescale */}
                                <div className="flex items-center h-8 bg-gray-100 rounded-lg p-0.5">
                                    {(['day', 'week', 'month'] as CalendarView[]).map(s => (
                                        <button key={s} onClick={() => setCalendarView(s)}
                                            className={`px-3 h-full rounded-md text-xs font-medium transition-colors ${calendarView === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                                            {s.charAt(0).toUpperCase() + s.slice(1)}
                                        </button>
                                    ))}
                                </div>

                                {/* Weekends */}
                                <button onClick={() => setShowWeekends(!showWeekends)} className="flex items-center gap-2 group">
                                    <div className={`rounded-full relative transition-colors flex items-center px-0.5 ${showWeekends ? 'bg-blue-500' : 'bg-gray-200'}`}
                                        style={{ width: 32, height: 18 }}>
                                        <span className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${showWeekends ? 'translate-x-3.5' : 'translate-x-0'}`} />
                                    </div>
                                    <span className="text-xs text-gray-500 group-hover:text-gray-700 transition-colors">Weekends</span>
                                </button>
                            </>
                        )}

                        <div className="flex-1" />
                        <div className="w-px h-6 bg-gray-200" />

                        {/* Filter button */}
                        <button
                            onClick={() => setShowFilters(v => !v)}
                            className={`inline-flex items-center gap-2 h-8 px-3 rounded-lg border text-xs font-medium transition-all ${
                                showFilters || activeCount > 0
                                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-800'
                            }`}
                        >
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                                <path d="M1.5 3.5h10M3.5 6.5h6M5.5 9.5h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                            </svg>
                            Filter
                            {activeCount > 0 && (
                                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] font-bold leading-none">
                                    {activeCount}
                                </span>
                            )}
                        </button>

                        <div className="w-px h-6 bg-gray-200" />

                        {/* View */}
                        <div className="flex items-center h-8 bg-gray-100 rounded-lg p-0.5 gap-0.5">
                            {viewModes.map(key => (
                                <button key={key} title={key} onClick={() => setViewMode(key)}
                                    className={`w-7 h-full flex items-center justify-center rounded-md transition-all ${viewMode === key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                                    {ViewIcons[key as keyof typeof ViewIcons]}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Filter panel */}
            {showFilters && (
                <div className="bg-white border-b border-gray-100 w-full">
                    <div className="max-w-screen-xl mx-auto w-full px-8 py-4 flex items-start gap-8 flex-wrap">
                        
                        {/* Priority */}
                        <div className="flex flex-col gap-2">
                            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Priority</span>
                            <div className="flex items-center gap-1 flex-wrap">
                                {PRIORITIES.map(p => (
                                    <PriorityPill key={p} priority={p as Priority}
                                        active={filterPriority.includes(p)} 
                                        onClick={() => {
                                            if (filterPriority.includes(p)) setFilterPriority(filterPriority.filter(x => x !== p));
                                            else setFilterPriority([...filterPriority, p]);
                                        }} 
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="w-px self-stretch bg-gray-100 shrink-0" />

                        {/* Status */}
                        <div className="flex flex-col gap-2">
                            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Status</span>
                            <div className="flex items-center gap-1 flex-wrap">
                                {STATUSES.map(s => (
                                    <Pill key={s} label={s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} color={STATUS_CONFIG[s]?.color || '#94a3b8'} dot
                                        active={filterStatus.includes(s)} 
                                        onClick={() => {
                                            if (filterStatus.includes(s)) setFilterStatus(filterStatus.filter(x => x !== s));
                                            else setFilterStatus([...filterStatus, s]);
                                        }} 
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="w-px self-stretch bg-gray-100 shrink-0" />

                        {/* Brand */}
                        <div className="flex flex-col gap-2">
                            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Brand</span>
                            <div className="flex items-center gap-1 flex-wrap">
                                {clients.map(b => {
                                    const bName = b.name as Brand;
                                    const domainMap: Record<string, string> = {
                                        'CareStack': 'carestack.com',
                                        'VoiceStack': 'voicestack.com',
                                        'OS Dental': 'osdental.com', // fallback domains
                                        'ACE DSN': 'acedsn.com',
                                        'Aeka': 'aeka.com'
                                    };
                                    let domain = '';
                                    try {
                                        if (b.website) domain = new URL(b.website).hostname;
                                    } catch (e) {}
                                    if (!domain) domain = domainMap[bName];
                                    const logoUrl = b.favicon || (domain ? `https://logo.clearbit.com/${domain}` : undefined);
                                    
                                    return (
                                    <Pill key={b.id} label={b.name} color={BRAND_CONFIG[bName]?.color || '#3b82f6'}
                                        logoUrl={logoUrl}
                                        active={filterBrand.includes(b.id)} 
                                        onClick={() => {
                                            if (filterBrand.includes(b.id)) setFilterBrand(filterBrand.filter(x => x !== b.id));
                                            else setFilterBrand([...filterBrand, b.id]);
                                        }} 
                                    />
                                )})}
                            </div>
                        </div>

                        <div className="w-px self-stretch bg-gray-100 shrink-0" />

                        {/* Region */}
                        <div className="flex flex-col gap-2">
                            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Region</span>
                            <div className="flex items-center gap-1 flex-wrap">
                                {(['USA', 'UK', 'AU'] as Region[]).map(r => (
                                    <Pill key={r} label={r} color="#475569" prefix={`${REGION_CONFIG[r]?.flag} `}
                                        active={filterRegion.includes(r)} 
                                        onClick={() => {
                                            if (filterRegion.includes(r)) setFilterRegion(filterRegion.filter(x => x !== r));
                                            else setFilterRegion([...filterRegion, r]);
                                        }} 
                                    />
                                ))}
                            </div>
                        </div>

                        {activeCount > 0 && (
                            <>
                                <div className="w-px self-stretch bg-gray-100 shrink-0" />
                                <div className="flex flex-col gap-2">
                                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest opacity-0">·</span>
                                    <button 
                                        onClick={() => {
                                            setFilterPriority([]);
                                            setFilterStatus([]);
                                            setFilterBrand([]);
                                            setFilterRegion([]);
                                            setFilterTag([]);
                                        }}
                                        className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md text-xs font-medium text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-all border border-transparent hover:border-gray-200"
                                    >
                                        <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                                            <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                                        </svg>
                                        Clear all
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Render Views */}
            <div className="max-w-screen-xl mx-auto px-8 py-6 w-full">
                {viewMode === 'calendar' && renderCalendarView()}
                {viewMode === 'list' && renderListView()}
                {viewMode === 'board' && renderBoardView()}
                {viewMode === 'timeline' && showTimeline && renderTimelineView()}
            </div>

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