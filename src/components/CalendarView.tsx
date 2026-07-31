import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Task } from '../types/types';
import { users, teams, tasks, clients, workCategories } from '../data/mockData';
import { ChevronLeft, ChevronRight, ChevronDown, Users, Filter, Download, Plus, LayoutGrid, List, ArrowUpDown, Calendar, GanttChart, User as UserIcon } from 'lucide-react';
import { getPriorityColor, getStatusBadgeColor, formatStatusLabel, getDatesInRange } from '../utils/capacityCalculations';
import TaskDetailsPanel from './TaskDetailsPanel';
import { TimelineContainer } from './TimelineContainer';

interface Props {
  currentUser: User;
}

type CalendarView = 'month' | 'week' | 'day';
type TaskPageMode = 'calendar' | 'list' | 'board' | 'timeline';
type SortOption = 'dueDate' | 'priority' | 'assignee' | 'status' | 'hours' | 'employee';

export default function CalendarView({ currentUser }: Props) {
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date('2026-07-28'));
  const [pageMode, setPageMode] = useState<TaskPageMode>('calendar');
  const [viewMode, setViewMode] = useState<CalendarView>('month');
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  const handleNewTask = () => {
    const blankTask: Task = {
      id: `new-${Date.now()}`,
      requestId: '',
      title: '',
      description: '',
      categoryId: '',
      clientId: '',
      requesterId: currentUser.id,
      priority: 'normal',
      status: 'new_request',
      estimatedHours: 0,
      dueDate: '',
      createdDate: new Date().toISOString(),
      teamIds: [],
      requiredSkillIds: [],
      subtaskIds: [],
      dependencyIds: [],
      linkedTaskIds: []
    };
    setSelectedTask(blankTask);
    setIsTaskPanelOpen(true);
  };

  const toggleTaskExpansion = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newExpanded = new Set(expandedTasks);
    if (newExpanded.has(taskId)) {
      newExpanded.delete(taskId);
    } else {
      newExpanded.add(taskId);
    }
    setExpandedTasks(newExpanded);
  };
  const [sortBy, setSortBy] = useState<SortOption>('dueDate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filterTeam, setFilterTeam] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);

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

  // Filter tasks
  const filteredTasks = useMemo(() => {
    let filtered = tasks.filter(t => 
      t.status !== 'completed' && 
      t.status !== 'cancelled'
    );

    if (filterTeam !== 'all') {
      filtered = filtered.filter(t => t.teamIds.includes(filterTeam));
    }
    if (filterPriority.length > 0) {
      filtered = filtered.filter(t => t.priority && filterPriority.includes(t.priority));
    }
    if (filterStatus.length > 0) {
      filtered = filtered.filter(t => filterStatus.includes(t.status));
    }

    if (pageMode === 'list') {
      filtered.sort((a, b) => {
        let comparison = 0;
        switch (sortBy) {
          case 'dueDate':
            comparison = new Date(a.dueDate || 0).getTime() - new Date(b.dueDate || 0).getTime();
            break;
          case 'priority':
            const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
            comparison = (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 9) - (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 9);
            break;
          case 'assignee':
          case 'employee':
            const assigneeA = a.assignedToId ? users.find(u => u.id === a.assignedToId)?.name || '' : '';
            const assigneeB = b.assignedToId ? users.find(u => u.id === b.assignedToId)?.name || '' : '';
            comparison = assigneeA.localeCompare(assigneeB);
            break;
          case 'status':
            comparison = a.status.localeCompare(b.status);
            break;
          case 'hours':
            comparison = (a.estimatedHours || 0) - (b.estimatedHours || 0);
            break;
        }
        return sortDirection === 'asc' ? comparison : -comparison;
      });
    }

    return filtered;
  }, [filterTeam, filterPriority, filterStatus, pageMode, sortBy, sortDirection]);

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    setIsTaskPanelOpen(true);
  };

  const handleStatusChange = (taskId: string, newStatus: string) => {
    console.log('Updating task', taskId, 'to status', newStatus);
  };

  // Get days in month
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days: Date[] = [];
    
    // Add previous month's days to fill the first week
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      const prevDate = new Date(year, month, -i);
      days.push(prevDate);
    }
    
    // Add current month's days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }
    
    // Add next month's days to complete the last week
    const remainingDays = 42 - days.length; // 6 weeks × 7 days
    for (let i = 1; i <= remainingDays; i++) {
      days.push(new Date(year, month + 1, i));
    }
    
    return days;
  };

  // Get week days (starting on Sunday)
  const getWeekDays = (date: Date) => {
    const days: Date[] = [];
    const currentDay = date.getDay();
    const startOfWeek = new Date(date);
    startOfWeek.setDate(date.getDate() - currentDay);
    
    for (let i = 0; i < 7; i++) {
      days.push(new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate() + i));
    }
    
    return days;
  };

  // Get tasks for a specific date
  const getTasksForDate = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    return filteredTasks.filter(task => {
      if (!task.proposedStartDate || !task.dueDate) return false;
      const startDate = new Date(task.proposedStartDate).toISOString().split('T')[0];
      const endDate = new Date(task.dueDate).toISOString().split('T')[0];
      return dateStr >= startDate && dateStr <= endDate;
    });
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    if (direction === 'prev') {
      newDate.setMonth(newDate.getMonth() - 1);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setCurrentDate(newDate);
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    if (direction === 'prev') {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setDate(newDate.getDate() + 7);
    }
    setCurrentDate(newDate);
  };

  const navigateDay = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    if (direction === 'prev') {
      newDate.setDate(newDate.getDate() - 1);
    } else {
      newDate.setDate(newDate.getDate() + 1);
    }
    setCurrentDate(newDate);
  };

  const renderMonthView = () => {
    const days = getDaysInMonth(currentDate);
    const currentMonth = currentDate.getMonth();

  



  return (
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-gray-200">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase bg-gray-50">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7">
          {days.map((day, index) => {
            const isCurrentMonth = day.getMonth() === currentMonth;
            const isToday = day.toDateString() === new Date().toDateString();
            const dayTasks = getTasksForDate(day);

            return (
              <div
                key={index}
                className={`min-h-[120px] border-r border-b border-gray-200 p-2 ${
                  !isCurrentMonth ? 'bg-gray-50' : 'bg-white'
                } hover:bg-blue-50 transition-colors`}
              >
                <div className={`text-sm font-medium mb-2 ${
                  isToday 
                    ? 'bg-blue-600 text-white w-7 h-7 rounded-full flex items-center justify-center' 
                    : isCurrentMonth 
                    ? 'text-gray-900' 
                    : 'text-gray-400'
                }`}>
                  {day.getDate()}
                </div>

                <div className="space-y-1">
                  {dayTasks.slice(0, 3).map(task => {
                    const assignedUser = task.assignedToId ? users.find(u => u.id === task.assignedToId) : null;
                    const userTeam = assignedUser ? teams.find(t => t.memberIds.includes(assignedUser.id)) : null;

                    return (
                      <div
                        key={task.id}
                        onClick={() => handleTaskClick(task)}
                        className="text-xs p-1.5 rounded cursor-pointer hover:shadow-sm transition-shadow"
                        style={{ 
                          backgroundColor: userTeam?.color ? `${userTeam.color}20` : '#E5E7EB',
                          borderLeft: `3px solid ${userTeam?.color || '#9CA3AF'}`
                        }}
                      >
                        <div className="font-medium truncate" title={task.title}>
                          {task.title}
                        </div>
                        <div className="text-[10px] text-gray-600 flex items-center gap-1 mt-0.5">
                          <div 
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: getPriorityColor(task.priority) }}
                          ></div>
                          {assignedUser?.name.split(' ')[0]}
                        </div>
                      </div>
                    );
                  })}
                  {dayTasks.length > 3 && (
                    <div className="text-[10px] text-gray-500 text-center">
                      +{dayTasks.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const days = getWeekDays(currentDate);

    return (
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="grid grid-cols-7 border-b border-gray-200">
          {days.map((day, index) => {
            const isToday = day.toDateString() === new Date().toDateString();
            return (
              <div key={index} className="px-4 py-3 text-center border-r border-gray-200 last:border-r-0 bg-gray-50">
                <div className="text-xs font-semibold text-gray-500 uppercase">
                  {day.toLocaleDateString('en-US', { weekday: 'short' })}
                </div>
                <div className={`text-lg font-semibold mt-1 ${
                  isToday 
                    ? 'bg-blue-600 text-white w-9 h-9 rounded-full flex items-center justify-center mx-auto' 
                    : 'text-gray-900'
                }`}>
                  {day.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day, index) => {
            const dayTasks = getTasksForDate(day);

            return (
              <div key={index} className="min-h-[400px] border-r border-gray-200 last:border-r-0 p-3">
                <div className="space-y-2">
                  {dayTasks.map(task => {
                    const assignedUser = task.assignedToId ? users.find(u => u.id === task.assignedToId) : null;
                    const userTeam = assignedUser ? teams.find(t => t.memberIds.includes(assignedUser.id)) : null;

                    return (
                      <div
                        key={task.id}
                        onClick={() => handleTaskClick(task)}
                        className="text-xs p-2 rounded cursor-pointer hover:shadow-md transition-shadow"
                        style={{ 
                          backgroundColor: userTeam?.color ? `${userTeam.color}20` : '#E5E7EB',
                          borderLeft: `3px solid ${userTeam?.color || '#9CA3AF'}`
                        }}
                      >
                        <div className="font-medium mb-1">{task.title}</div>
                        <div className="text-[10px] text-gray-600">
                          {task.estimatedHours}h • {assignedUser?.name.split(' ')[0]}
                        </div>
                        <div className={`text-[10px] px-1.5 py-0.5 rounded inline-block mt-1 ${getStatusBadgeColor(task.status)}`}>
                          {formatStatusLabel(task.status)}
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
    );
  };

  const renderDayView = () => {
    const dayTasks = getTasksForDate(currentDate);
    const isToday = currentDate.toDateString() === new Date().toDateString();

    return (
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="border-b border-gray-200 p-4 bg-gray-50">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500">
                {currentDate.toLocaleDateString('en-US', { weekday: 'long' })}
              </div>
              <div className={`text-2xl font-semibold ${isToday ? 'text-blue-600' : 'text-gray-900'}`}>
                {currentDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
            </div>
            <div className="text-sm text-gray-600">
              {dayTasks.length} {dayTasks.length === 1 ? 'task' : 'tasks'}
            </div>
          </div>
        </div>

        <div className="p-6 space-y-3">
          {dayTasks.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-400 text-lg mb-2">No tasks scheduled</div>
              <div className="text-sm text-gray-500">This day is free</div>
            </div>
          ) : (
            dayTasks.map(task => {
              const assignedUser = task.assignedToId ? users.find(u => u.id === task.assignedToId) : null;
              const client = clients.find(c => c.id === task.clientId);
              const category = workCategories.find(c => c.id === task.categoryId);
              const userTeam = assignedUser ? teams.find(t => t.memberIds.includes(assignedUser.id)) : null;

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
                          <div className="text-xs font-medium text-gray-900">{assignedUser.name}</div>
                          <div className="text-xs text-gray-500">{userTeam?.name}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const renderTimelineView = () => {
    // We will show days for the current month
    const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const startDateStr = start.toISOString().split('T')[0];
    
    // Get number of days in the current month
    const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
    const dates = getDatesInRange(startDateStr, daysInMonth);

    // Group dates by month (for the top header)
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

    // Group by WorkCategory
    const tasksByCategory = filteredTasks.reduce((acc, task) => {
        const category = workCategories.find(c => c.id === task.categoryId);
        const catName = category?.name || 'Uncategorized';
        if (!acc[catName]) {
            acc[catName] = { category, tasks: [] };
        }
        acc[catName].tasks.push(task);
        return acc;
    }, {} as Record<string, { category: typeof workCategories[0] | undefined, tasks: Task[] }>);

    return (
        <TimelineContainer>
            <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
                <thead className="bg-white sticky top-0 z-30 shadow-sm">
                    {/* Month Header Row */}
                    <tr>
                        <th className="w-80 min-w-[320px] sticky left-0 z-40 bg-white border-r border-b border-gray-200 px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">
                            Task List
                        </th>
                        {monthGroups.map((mg, i) => (
                            <th key={i} colSpan={mg.count} className="border-r border-b border-gray-200 px-4 py-2 text-center text-xs font-semibold text-gray-700 bg-gray-50">
                                {mg.name}
                            </th>
                        ))}
                    </tr>
                    {/* Days Header Row */}
                    <tr>
                        <th className="w-80 min-w-[320px] sticky left-0 z-40 bg-white border-r border-b border-gray-200"></th>
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
                    {Object.entries(tasksByCategory).map(([catName, { category, tasks: catTasks }]) => (
                        <React.Fragment key={catName}>
                            {/* Category Header Row */}
                            <tr className="bg-gray-50/50">
                                <td className="w-80 min-w-[320px] sticky left-0 z-20 bg-gray-50/50 border-r border-b border-gray-200 px-4 py-3 font-semibold text-gray-900 flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#6B7280' }} />
                                    {catName}
                                </td>
                                <td colSpan={dates.length} className="border-r border-b border-gray-200 bg-gray-50/50"></td>
                            </tr>
                            {/* Category Tasks */}
                            {catTasks.map(task => {
                                const assignedUser = task.assignedToId ? users.find(u => u.id === task.assignedToId) : null;
                                const userTeam = assignedUser ? getUserTeam(assignedUser.id) : null;
                                return (
                                    <tr key={task.id} className="hover:bg-gray-50/30 group">
                                        <td className="w-80 min-w-[320px] sticky left-0 z-20 bg-white group-hover:bg-gray-50/30 border-r border-b border-gray-200 px-4 py-2">
                                            <div className="flex items-center gap-3">
                                                {/* Assigned User Avatar */}
                                                {assignedUser ? (
                                                    <div 
                                                        className="w-6 h-6 rounded-full flex flex-shrink-0 items-center justify-center text-white text-[10px] font-medium border-2 border-white shadow-sm"
                                                        style={{ backgroundColor: userTeam?.color || '#6B7280' }}
                                                        title={`${assignedUser.name} (${userTeam?.name || 'No Team'})`}
                                                    >
                                                        {assignedUser.name.split(' ').map(n => n[0]).join('')}
                                                    </div>
                                                ) : (
                                                    <div className="w-6 h-6 rounded-full bg-gray-100 flex-shrink-0 border-2 border-white shadow-sm flex items-center justify-center" title="Unassigned">
                                                        <UserIcon className="w-3 h-3 text-gray-400" />
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <div className="text-sm font-medium text-gray-900 truncate" title={task.title}>{task.title}</div>
                                                    <div className="text-[10px] text-gray-500 truncate flex items-center gap-2">
                                                        <span>{formatStatusLabel(task.status)}</span>
                                                        <span className="text-gray-300">•</span>
                                                        <span className="uppercase" style={{ color: getPriorityColor(task.priority) }}>{task.priority || 'Normal'}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td colSpan={dates.length} className="border-r border-b border-gray-200 p-0 relative h-12">
                                            {/* Grid Lines */}
                                            <div className="absolute inset-0 flex pointer-events-none">
                                                {dates.map((d, i) => (
                                                    <div key={i} className={`flex-1 border-r border-gray-100/50 ${d === new Date().toISOString().split('T')[0] ? 'bg-blue-50/20 border-blue-100' : ''}`} />
                                                ))}
                                            </div>
                                            {/* Task Bar */}
                                            <div className="relative w-full h-full flex items-center">
                                                {(() => {
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
                                                    const priorityColor = getPriorityColor(task.priority);

                                                    return (
                                                        <div key={`wrapper-${task.id}`} className="absolute" style={{ left: `${left}%`, width: `${width}%`, top: `6px`, zIndex: 10 }}>
                                                            <div
                                                                onClick={() => handleTaskClick(task)}
                                                                className={`relative h-8 rounded px-2 text-[11px] flex items-center overflow-visible cursor-pointer shadow-sm hover:shadow-md transition-all ${isCompleted ? 'opacity-60' : ''}`}
                                                                style={{
                                                                    backgroundColor: `${priorityColor}25`,
                                                                    borderLeft: `3px solid ${priorityColor}`,
                                                                    color: '#1F2937'
                                                                }}
                                                                title={`${task.title} (${task.status})`}
                                                            >
                                                                <span className="truncate font-medium flex items-center gap-1.5 w-full">
                                                                    {isCompleted && <span className="text-green-600">✓</span>}
                                                                    {task.title}
                                                                </span>
                                                                {/* Visual Connector for Follow-up tasks */}
                                                                {(task.dependencyIds?.length > 0 || task.subtaskIds?.length > 0) && (
                                                                    <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-3 h-px bg-gray-400"></div>
                                                                )}
                                                                {task.parentTaskId && (
                                                                    <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-3 h-px bg-gray-400"></div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
        </TimelineContainer>
    );
  };


  const activeTasks = filteredTasks;

  const getUserTeam = (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (!user || user.teamIds.length === 0) return null;
    return teams.find(t => t.id === user.teamIds[0]) || null;
  };

  const getTagColor = (tag: string) => {
    // Generate a consistent color based on string
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
        hash = tag.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 45%)`;
  };

  const renderTaskRow = (task: Task, depth: number): React.ReactElement[] => {
      const assignedUser = task.assignedToId ? users.find(u => u.id === task.assignedToId) : null;
      const category = workCategories.find(c => c.id === task.categoryId);
      const userTeam = assignedUser ? getUserTeam(assignedUser.id) : null;
      const hasSubtasks = task.subtaskIds && task.subtaskIds.length > 0;
      const isExpanded = expandedTasks.has(task.id);
      
      // Determine solid color from tailwind classes
      const statusColorCls = getStatusBadgeColor(task.status);
      let dotColor = '#F59E0B'; // default
      if (statusColorCls.includes('blue')) dotColor = '#3B82F6';
      else if (statusColorCls.includes('green')) dotColor = '#10B981';
      else if (statusColorCls.includes('purple')) dotColor = '#8B5CF6';
      else if (statusColorCls.includes('gray')) dotColor = '#6B7280';

      const row = (
          <tr key={task.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => handleTaskClick(task)}>
              <td className="px-4 py-3 min-w-[300px]">
                  <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 24}px` }}>
                      {hasSubtasks ? (
                          <button onClick={(e) => toggleTaskExpansion(task.id, e)} className="p-0.5 hover:bg-gray-200 rounded text-gray-500 transition-colors">
                              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                      ) : (
                          <div className="w-5" />
                      )}
                      
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 shadow-sm" style={{ backgroundColor: dotColor }}>
                          {formatStatusLabel(task.status).charAt(0).toUpperCase()}
                      </div>
                      
                      <span className="text-sm font-medium text-gray-900 truncate" title={task.title}>{task.title}</span>
                  </div>
              </td>
              
              <td className="px-4 py-3">
                  <div className="flex items-center gap-1 flex-wrap">
                      {task.tags && task.tags.map((tag, idx) => (
                          <span key={tag.id || idx} className={`px-2 py-0.5 text-[10px] rounded-full ${tag.color || 'bg-gray-100 text-gray-700'}`}>
                              {tag.name}
                          </span>
                      ))}
                  </div>
              </td>
              
              <td className="px-4 py-3">
                  {category && (
                      <span className="text-xs text-gray-600 px-2 py-1 bg-gray-100 rounded-md">
                          {category.name}
                      </span>
                  )}
              </td>
              
              <td className="px-4 py-3">
                  {assignedUser ? (
                      <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-medium" style={{ backgroundColor: userTeam?.color || '#6B7280' }}>
                              {assignedUser.name.split(' ').map(n => n[0]).join('')}
                          </div>
                          <span className="text-xs text-gray-700">{assignedUser.name}</span>
                      </div>
                  ) : (
                      <div className="w-6 h-6 rounded-full border border-dashed border-gray-300 flex items-center justify-center text-gray-400" title="Unassigned">
                          <Users className="w-3 h-3" />
                      </div>
                  )}
              </td>
              
              <td className="px-4 py-3 text-xs text-gray-600">
                  {task.dueDate ? (
                      <span className={new Date(task.dueDate) < new Date() ? 'text-red-600 font-medium' : ''}>
                          {new Date(task.dueDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                      </span>
                  ) : '-'}
              </td>
              
              <td className="px-4 py-3">
                  <span className="text-[11px] font-medium px-2 py-1 rounded" style={{ backgroundColor: `${getPriorityColor(task.priority)}15`, color: getPriorityColor(task.priority) }}>
                      {(task.priority || 'Normal').toUpperCase()}
                  </span>
              </td>
              
              <td className="px-4 py-3 text-xs text-gray-600">
                  {task.actualHours || 0} / {task.estimatedHours}h
              </td>
          </tr>
      );

      let rows = [row];
      
      if (isExpanded && hasSubtasks) {
          // get real tasks, not just filtered ones, so subtasks are always accessible
          const subtasks = tasks.filter(t => task.subtaskIds.includes(t.id));
          subtasks.forEach(sub => {
              rows = [...rows, ...renderTaskRow(sub, depth + 1)];
          });
      }
      
      return rows;
  };

  const renderListView = () => {
      // Only show top level tasks in the root of the table that match the filters
      const topLevelTasks = activeTasks.filter(t => !t.isSubtask);
      
      return (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                      <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Tags</th>
                              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Channel</th>
                              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Assignee</th>
                              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Due date</th>
                              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Priority</th>
                              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Hours</th>
                          </tr>
                      </thead>
                      <tbody className="bg-white">
                          {topLevelTasks.length > 0 ? (
                              topLevelTasks.map(t => (
                                  <React.Fragment key={t.id}>
                                      {renderTaskRow(t, 0)}
                                  </React.Fragment>
                              ))
                          ) : (
                              <tr>
                                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                                      No tasks found matching your filters.
                                  </td>
                              </tr>
                          )}
                      </tbody>
                  </table>
              </div>
          </div>
      );
  };

  const renderBoardView = () => {
      const statusColumns = [
          { status: 'scheduled', label: 'Scheduled', color: 'bg-purple-100' },
          { status: 'pending', label: 'Pending', color: 'bg-gray-100' },
          { status: 'awaiting_employee_approval', label: 'Awaiting Approval', color: 'bg-yellow-100' },
          { status: 'in_progress', label: 'In Progress', color: 'bg-blue-100' },
          { status: 'manager_review_required', label: 'Manager Review', color: 'bg-orange-100' },
          { status: 'completed', label: 'Completed', color: 'bg-green-100' }
      ];

      return (
          <div className="bg-white rounded-lg border border-gray-200 p-6 overflow-x-auto">
              <div className="flex gap-4 min-w-max">
                  {statusColumns.map(column => {
                      const columnTasks = activeTasks.filter(t => t.status === column.status);

                      return (
                          <div key={column.status} className="space-y-3 w-72 flex-shrink-0">
                              <div className="flex items-center justify-between">
                                  <h3 className="text-sm font-semibold text-gray-900">{column.label}</h3>
                                  <span className="text-xs text-gray-500">{columnTasks.length}</span>
                              </div>

                              <div className="space-y-2 min-h-[400px]">
                                  {columnTasks.map(task => {
                                      const assignedUser = task.assignedToId ? users.find(u => u.id === task.assignedToId) : null;
                                      const userTeam = assignedUser ? getUserTeam(assignedUser.id) : null;

                                      return (
                                          <div
                                              key={task.id}
                                              onClick={() => handleTaskClick(task)}
                                              className={`${column.color} border border-gray-200 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow`}
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
                                                  <div className="text-xs text-gray-500">
                                                      {task.estimatedHours}h
                                                  </div>

                                                  {assignedUser && (
                                                      <div className="flex items-center gap-1">
                                                          <div
                                                              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-medium"
                                                              style={{ backgroundColor: userTeam?.color || '#6B7280' }}
                                                          >
                                                              {assignedUser.name.split(' ').map(n => n[0]).join('')}
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
                  })}
              </div>
          </div>
      );
  };
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Tasks</h1>
          <p className="text-sm text-gray-600 mt-1">Manage and track your tasks</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center p-1 bg-[#F8F9FA] rounded-xl">
              <button
                  onClick={() => setPageMode('calendar')}
                  className={`p-2 rounded-lg transition-all flex items-center justify-center ${pageMode === 'calendar' ? 'bg-white text-blue-600 shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'}`}
                  title="Calendar View"
              >
                  <Calendar className="w-5 h-5" strokeWidth={1.5} />
              </button>
              <button
                  onClick={() => setPageMode('list')}
                  className={`p-2 rounded-lg transition-all flex items-center justify-center ${pageMode === 'list' ? 'bg-white text-blue-600 shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'}`}
                  title="List View"
              >
                  <List className="w-5 h-5" strokeWidth={1.5} />
              </button>
              <button
                  onClick={() => setPageMode('board')}
                  className={`p-2 rounded-lg transition-all flex items-center justify-center ${pageMode === 'board' ? 'bg-white text-blue-600 shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'}`}
                  title="Board View"
              >
                  <LayoutGrid className="w-5 h-5" strokeWidth={1.5} />
              </button>
              <button
                  onClick={() => setPageMode('timeline')}
                  className={`p-2 rounded-lg transition-all flex items-center justify-center ${pageMode === 'timeline' ? 'bg-white text-blue-600 shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'}`}
                  title="Timeline View"
              >
                  <GanttChart className="w-5 h-5" strokeWidth={1.5} />
              </button>
          </div>

          <button 
            onClick={() => setShowFilters(!showFilters)}
            className={`px-4 py-2 border rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-2 ${
              showFilters ? 'border-blue-500 text-blue-700 bg-blue-50' : 'border-gray-300 text-gray-700'
            }`}
          >
            <Filter className="w-4 h-4" />
            Filters
          </button>
          <button 
            onClick={handleNewTask}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Task
          </button>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-5 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-600">Total Tasks</div>
          <div className="text-2xl font-semibold text-gray-900 mt-1">{filteredTasks.length}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-600">In Review</div>
          <div className="text-2xl font-semibold text-yellow-600 mt-1">
            {filteredTasks.filter(t => t.status === 'manager_review_required').length}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-600">In Progress</div>
          <div className="text-2xl font-semibold text-blue-600 mt-1">
            {filteredTasks.filter(t => t.status === 'in_progress').length}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-600">Scheduled</div>
          <div className="text-2xl font-semibold text-purple-600 mt-1">
            {filteredTasks.filter(t => t.status === 'scheduled').length}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-600">On Hold</div>
          <div className="text-2xl font-semibold text-gray-600 mt-1">
            {filteredTasks.filter(t => t.status === 'on_hold').length}
          </div>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="grid grid-cols-3 gap-6">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Team</label>
              <select
                value={filterTeam}
                onChange={(e) => setFilterTeam(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="all">All Teams</option>
                {visibleTeams.map(team => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </div>

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
                {['in_review', 'scheduled', 'in_progress', 'accepted', 'on_hold'].map(status => (
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
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200 flex items-center justify-end">
            <button 
              onClick={() => {
                setFilterTeam('all');
                setFilterPriority([]);
                setFilterStatus([]);
              }}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
            >
              Clear All
            </button>
          </div>
        </div>
      )}

      {/* Navigation and View Controls */}
      {pageMode === 'calendar' && (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                if (viewMode === 'month') navigateMonth('prev');
                else if (viewMode === 'week') navigateWeek('prev');
                else navigateDay('prev');
              }}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>

            <h2 className="text-lg font-semibold text-gray-900 min-w-[200px] text-center">
              {viewMode === 'month' && currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              {viewMode === 'week' && `Week of ${getWeekDays(currentDate)[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
              {viewMode === 'day' && currentDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </h2>

            <button
              onClick={() => {
                if (viewMode === 'month') navigateMonth('next');
                else if (viewMode === 'week') navigateWeek('next');
                else navigateDay('next');
              }}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ChevronRight className="w-5 h-5 text-gray-600" />
            </button>

            <button
              onClick={() => setCurrentDate(new Date())}
              className="ml-4 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Today
            </button>
          </div>

          {/* Sub View Mode Toggle (Calendar specific) */}
          <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                viewMode === 'month' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Month
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                viewMode === 'week' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setViewMode('day')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                viewMode === 'day' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Day
            </button>
          </div>
        </div>
      </div>
      )}

      {/* Render Main Views */}
      {pageMode === 'list' && renderListView()}
      {pageMode === 'board' && renderBoardView()}
      {pageMode === 'timeline' && renderTimelineView()}
      
      {/* Render Calendar Views */}
      {pageMode === 'calendar' && viewMode === 'month' && renderMonthView()}
      {pageMode === 'calendar' && viewMode === 'week' && renderWeekView()}
      {pageMode === 'calendar' && viewMode === 'day' && renderDayView()}

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