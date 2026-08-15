import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { User, Task, TaskStatus } from '../types/types';
import { useData } from '../contexts/DataContext';
import { ChevronLeft, ChevronRight, ChevronDown, Users, Filter, Download, Plus, LayoutGrid, List, ArrowUpDown, Calendar, GanttChart, User as UserIcon } from 'lucide-react';
import { getDatesInRange, getPriorityColor, getTimelineColumns, getProjectTimelineBounds, getStatusBadgeColor, formatStatusLabel, startOfToday } from '../utils/capacityCalculations';
import TaskDetailsPanel from './TaskDetailsPanel';
import TimelineView from './TimelineView';
import { TimelineContainer } from './TimelineContainer';
import { useTestEnvironment } from '../lib/testEnvironment';
import { useAppNavigate } from '../lib/appNav';
import { useMemberFilter } from '../contexts/MemberViewContext';
import { getTagStyle } from '../utils/colors';
import { useVirtualWindow } from '../lib/useVirtualWindow';
import { PageSkeleton } from './Skeleton';
import {
    Priority, Status, Brand,
    PRIORITY_CONFIG, STATUS_CONFIG, BRAND_CONFIG,
    PriorityPill, Pill, ViewIcons
} from './WorkloadDashboardHelpers';
interface Props {
  currentUser: User;
}

// The grid is built from local dates, so a cell has to be identified by the date it prints
// rather than by toISOString(), which rolls a local midnight back a day east of UTC.
const toDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// Task dates arrive either as a plain date or as a UTC timestamp for that date's midnight;
// both name the day in their first ten characters, and reading the timestamp form through a
// local Date is exactly what would shift a task off the cell it belongs to.
const taskDateKey = (value: string) =>
  /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : toDateKey(new Date(value));

type CalendarView = 'month' | 'week' | 'day';
type TaskPageMode = 'calendar' | 'list' | 'board' | 'timeline';
type SortOption = 'dueDate' | 'priority' | 'assignee' | 'status' | 'hours' | 'employee';

// The filters global search can hand over in the URL, in the order they are read below.
const FACET_PARAMS = ['assignee', 'brand', 'region', 'tag', 'skill'] as const;

// Offered, not agreed to. It shows on every view -- leaving it off would make a week look
// emptier than it is -- but faded and dashed, because the person it is waiting on has not
// said yes and the hours behind it are not committed capacity yet. See .task-pending.
const isPendingAcceptance = (task: Task) => task.status === 'awaiting_employee_approval';
const pendingClass = (task: Task) => (isPendingAcceptance(task) ? ' task-pending' : '');

// estimated_hours is nullable, and a request submitted without one is not a task somebody
// estimated at zero. Interpolated raw it printed a bare "h" on every card and a "0 / h" in
// the list, which reads as a broken row rather than as a figure nobody has given yet.
const estimateLabel = (hours?: number | null) => (hours === null || hours === undefined ? '—' : `${hours}h`);

export default function CalendarView({ currentUser }: Props) {
  const { users, teams, tasks, clients, regions, allTags, skills, workCategories, loading } = useData();
  const [searchParams, setSearchParams] = useSearchParams();
  // Opens on today. It used to open on a fixed 28 July 2026 while the Today button beside it
  // jumped to the real date, so the month you landed on and the month that button took you to
  // drifted further apart every day.
  const [currentDate, setCurrentDate] = useState(startOfToday);
  const [pageMode, setPageMode] = useState<TaskPageMode>('list');
  // Still unfinished, so it lives only in the test environment (/test/tasks) and only for
  // the super admin. Everyone else gets calendar/list/board and no way to the timeline.
  const showTimeline = useTestEnvironment(currentUser);
  // 'All members' (null) unless somebody has been picked in the header.
  const memberFilter = useMemberFilter();
  const pageModes: TaskPageMode[] = showTimeline
    ? ['calendar', 'list', 'board', 'timeline']
    : ['calendar', 'list', 'board'];
  // This component survives the /test/tasks -> /tasks navigation, so the view it is sitting
  // on has to come back inside the offered set when the test environment is left.
  useEffect(() => {
    if (!showTimeline) setPageMode(prev => (prev === 'timeline' ? 'list' : prev));
  }, [showTimeline]);
  const [viewMode, setViewMode] = useState<CalendarView>('month');
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  // New Task goes to the request form, which is the only thing in the app that creates one.
  //
  // It used to hand the details panel a blank task carrying a `new-<timestamp>` id and let
  // somebody fill it in there, but the panel writes every field with an UPDATE against an
  // existing row and skips the write entirely when the id is not a real one -- so everything
  // typed into that draft was dropped silently, and the task never existed. Composing in the
  // panel cannot work without a create step, and there already is one.
  const goTo = useAppNavigate();
  const handleNewTask = () => goTo('/new-request');

  // Whatever the click already implies -- the day cell in the calendar -- is carried across,
  // so the form opens on the deadline that was just clicked rather than asking for it again.
  const handleNewTaskOnDate = (day: Date) => goTo(`/new-request?due=${toDateKey(day)}`);

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
  const [filterBrand, setFilterBrand] = useState<string[]>([]);
  const [filterRegion, setFilterRegion] = useState<string[]>([]);
  const [filterTag, setFilterTag] = useState<string[]>([]);
  const [filterAssignee, setFilterAssignee] = useState<string[]>([]);
  const [filterSkill, setFilterSkill] = useState<string[]>([]);

  // Visible teams based on user role
  const visibleTeams = useMemo(() => {
    if (currentUser.role === 'super_admin' || currentUser.role === 'admin' || currentUser.role === 'manager') {
      return teams;
    }
    return teams.filter(t => t.memberIds.includes(currentUser.id));
  }, [currentUser]);

  // Everything the filters allow, finished work included.
  //
  // Completed and cancelled tasks used to be dropped right here, before any filter ran, and
  // three things downstream asked for them anyway: the board's Completed column, the
  // Completed Tasks KPI, and the Completed and Cancelled pills in the status filter. All
  // three were answered with an empty set no matter what was in the database. Which views
  // hide finished work is a decision each of them makes below, where it can be seen.
  const filteredTasks = useMemo(() => {
    const visibleTeamIds = visibleTeams.map(t => t.id);
    let filtered = tasks.slice();

    if (filterTeam !== 'all') {
      filtered = filtered.filter(t => t.teamIds && t.teamIds.includes(filterTeam));
    } else {
      if (currentUser.role !== 'super_admin' && currentUser.role !== 'admin' && currentUser.role !== 'manager') {
        filtered = filtered.filter(t => 
          (t.teamIds && t.teamIds.some(tid => visibleTeamIds.includes(tid))) || 
          t.assignedToId === currentUser.id
        );
      }
    }
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
    if (filterAssignee.length > 0) {
      filtered = filtered.filter(t => t.assignedToId && filterAssignee.includes(t.assignedToId));
    }
    if (filterSkill.length > 0) {
      filtered = filtered.filter(t => t.requiredSkillIds && t.requiredSkillIds.some(id => filterSkill.includes(id)));
    }
    // The member picked in the header. It narrows on top of the page's own filters rather
    // than replacing them, so a status filter still applies to the person being looked at.
    if (memberFilter) {
      filtered = filtered.filter(t => t.assignedToId === memberFilter);
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
  }, [filterTeam, filterPriority, filterStatus, filterBrand, filterRegion, filterTag, filterAssignee, filterSkill, pageMode, sortBy, sortDirection, tasks, visibleTeams, users, currentUser]);

  // The live slice: what is still to be done. The calendar and the list are about the work in
  // front of people, so finished tasks stay out of them -- unless they have been asked for by
  // name in the status filter, which is the one way to go back and look at them.
  const activeTasks = useMemo(() => {
    const wantsFinished = filterStatus.includes('completed') || filterStatus.includes('cancelled');
    if (wantsFinished) return filteredTasks;
    return filteredTasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled');
  }, [filteredTasks, filterStatus]);

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    setIsTaskPanelOpen(true);
  };

  // A notification about a task links here as /tasks?task=<id>, and that id is looked up in
  // the unfiltered list: the task someone is being told about is often exactly the one the
  // page filters hide (completed, cancelled, another team's), and it still has to open.
  const deepLinkTaskId = searchParams.get('task');
  const appliedDeepLinkRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkTaskId) {
      appliedDeepLinkRef.current = null;
      return;
    }
    // Each linked id opens the panel once. Task data refreshes on a timer, and without this
    // the refresh would drag the panel back to the linked task after someone had clicked
    // through to a different one.
    if (appliedDeepLinkRef.current === deepLinkTaskId) return;

    const task = tasks.find(t => t.id === deepLinkTaskId);
    if (task) {
      appliedDeepLinkRef.current = deepLinkTaskId;
      setSelectedTask(task);
      setIsTaskPanelOpen(true);
      return;
    }
    // Still arriving, or gone/not visible to this person. Only give up once the load settles,
    // and drop the parameter so the stale link cannot reopen anything.
    if (!loading) {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('task');
        return next;
      }, { replace: true });
    }
  }, [deepLinkTaskId, tasks, loading, setSearchParams]);

  // A global-search hit that is not a task arrives as /tasks?assignee=<id> — or ?brand=,
  // ?region=, ?tag= — and seeds the matching filter, so the page opens on exactly the slice
  // that was searched for. Like ?task=, these are a way in rather than a mirror of the filter
  // state: they are consumed once and dropped, since a parameter that outlived the arrival
  // would fight every later click in the filter panel.
  const linkedFacets = FACET_PARAMS.map(key => searchParams.get(key)).join('|');
  useEffect(() => {
    const [assignee, brand, region, tag, skill] = FACET_PARAMS.map(key => searchParams.get(key));
    if (!assignee && !brand && !region && !tag && !skill) return;

    // Searching for something means "show me this", so whatever was filtered before is
    // replaced rather than intersected with it — an old brand filter left standing would
    // quietly empty the very list the search was meant to open.
    setFilterTeam('all');
    setFilterPriority([]);
    setFilterStatus([]);
    setFilterAssignee(assignee ? [assignee] : []);
    setFilterBrand(brand ? [brand] : []);
    setFilterRegion(region ? [region] : []);
    setFilterTag(tag ? [tag] : []);
    setFilterSkill(skill ? [skill] : []);
    // The filters are shown rather than merely applied: arriving on a silently narrowed list
    // with no sign of why is worse than not filtering at all. The calendar can hide the whole
    // result set behind the month it happens to be on, so the list is where these land.
    setShowFilters(true);
    setPageMode(prev => (prev === 'calendar' ? 'list' : prev));

    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      FACET_PARAMS.forEach(key => next.delete(key));
      return next;
    }, { replace: true });
    // searchParams is read through linkedFacets, which is what actually changes here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedFacets, setSearchParams]);

  // Closing the panel has to clear the parameter too, otherwise the URL still names the task
  // and clicking the same notification again would be a no-op.
  const closeTaskPanel = () => {
    setIsTaskPanelOpen(false);
    setSelectedTask(null);
    if (searchParams.has('task')) {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('task');
        return next;
      }, { replace: true });
    }
  };

  const handleStatusChange = (taskId: string, newStatus: string) => {
    setSelectedTask(prev => prev?.id === taskId ? { ...prev, status: newStatus as TaskStatus } : prev);
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
    const dateStr = toDateKey(date);
    return activeTasks.filter(task => {
      if (!task.proposedStartDate || !task.dueDate) return false;
      const startDate = taskDateKey(task.proposedStartDate);
      const endDate = taskDateKey(task.dueDate);
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

            // The whole cell used to be the click target for a new task. That was survivable
            // when it opened a dismissible panel beside the calendar; now that it leaves the
            // page for the request form, a mis-click costs you the month you were reading.
            // The + is the button -- it is what the hover was advertising all along.
            return (
              <div
                key={index}
                className={`group min-h-[120px] border-r border-b border-gray-200 p-2 ${
                  !isCurrentMonth ? 'bg-gray-50' : 'bg-white'
                } hover:bg-blue-50/60 transition-colors`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className={`text-sm font-medium ${
                    isToday
                      ? 'bg-blue-600 text-white w-7 h-7 rounded-full flex items-center justify-center'
                      : isCurrentMonth
                      ? 'text-gray-900'
                      : 'text-gray-400'
                  }`}>
                    {day.getDate()}
                  </div>
                  <button
                    onClick={() => handleNewTaskOnDate(day)}
                    title={`New task on ${day.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`}
                    aria-label={`New task on ${day.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`}
                    className="p-0.5 rounded text-blue-600 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-blue-100 transition-opacity"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-1">
                  {dayTasks.slice(0, 3).map(task => {
                    const assignedUser = task.assignedToId ? users.find(u => u.id === task.assignedToId) : null;
                    const userTeam = assignedUser ? teams.find(t => t.memberIds.includes(assignedUser.id)) : null;

                    return (
                      <div
                        key={task.id}
                        onClick={() => handleTaskClick(task)}
                        title={isPendingAcceptance(task) ? `${task.title} — waiting to be accepted` : task.title}
                        className={`text-xs p-1.5 rounded cursor-pointer hover:shadow-sm transition-shadow border border-transparent${pendingClass(task)}`}
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
                    <div
                      onClick={() => { setViewMode('day'); setCurrentDate(day); }}
                      className="text-[10px] text-gray-500 text-center cursor-pointer hover:text-blue-600"
                    >
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
              <div
                key={index}
                className="group min-h-[400px] border-r border-gray-200 last:border-r-0 p-3 hover:bg-blue-50/30 transition-colors"
              >
                <div className="space-y-2">
                  {dayTasks.map(task => {
                    const assignedUser = task.assignedToId ? users.find(u => u.id === task.assignedToId) : null;
                    const userTeam = assignedUser ? teams.find(t => t.memberIds.includes(assignedUser.id)) : null;

                    return (
                      <div
                        key={task.id}
                        onClick={() => handleTaskClick(task)}
                        title={isPendingAcceptance(task) ? `${task.title} — waiting to be accepted` : task.title}
                        className={`text-xs p-2 rounded cursor-pointer hover:shadow-md transition-shadow border border-transparent${pendingClass(task)}`}
                        style={{
                          backgroundColor: userTeam?.color ? `${userTeam.color}20` : '#E5E7EB',
                          borderLeft: `3px solid ${userTeam?.color || '#9CA3AF'}`
                        }}
                      >
                        <div className="font-medium mb-1">{task.title}</div>
                        <div className="text-[10px] text-gray-600">
                          {estimateLabel(task.estimatedHours)} • {assignedUser?.name.split(' ')[0]}
                        </div>
                        <div className={`text-[10px] px-1.5 py-0.5 rounded inline-block mt-1 ${getStatusBadgeColor(task.status)}`}>
                          {formatStatusLabel(task.status)}
                        </div>
                      </div>
                    );
                  })}

                  {/* The label was decoration over a click target covering the whole column.
                      Now it is the control, so it has to be one you can actually press. */}
                  <button
                    onClick={() => handleNewTaskOnDate(day)}
                    title={`New task on ${day.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`}
                    className="w-full flex items-center gap-1 text-xs text-blue-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity px-1 py-1 rounded hover:bg-blue-100/60"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New task
                  </button>
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
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-600">
                {dayTasks.length} {dayTasks.length === 1 ? 'task' : 'tasks'}
              </div>
              <button
                onClick={() => handleNewTaskOnDate(currentDate)}
                className="h-8 px-3 border border-gray-300 bg-white rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 hover:border-blue-300 hover:text-blue-600 flex items-center gap-1.5 transition-colors"
              >
                <Plus className="w-4 h-4" />
                New task
              </button>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-3">
          {dayTasks.length === 0 ? (
            // An empty day is the one place where the whole area is safe to make the target:
            // there is nothing else in it to mis-click, and it says what it does.
            <button
              onClick={() => handleNewTaskOnDate(currentDate)}
              className="w-full text-center py-12 rounded-lg border border-dashed border-gray-200 hover:border-blue-300 hover:bg-blue-50/40 transition-colors"
            >
              <div className="text-gray-400 text-lg mb-2">No tasks scheduled</div>
              <div className="text-sm text-gray-500">Add a task to this day</div>
            </button>
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
                  className={`border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer${pendingClass(task)}`}
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
                        <span>{estimateLabel(task.estimatedHours)}</span>
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
    return (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden" style={{ height: 'calc(100vh - 220px)' }}>
            <TimelineView currentUser={currentUser} />
        </div>
    );
  };


  const topLevelListTasks = useMemo(() => activeTasks.filter(t => !t.isSubtask), [activeTasks]);
  const listWindow = useVirtualWindow(topLevelListTasks.length, 54, 600, 8);

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
          <tr key={task.id} className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors${pendingClass(task)}`} onClick={() => handleTaskClick(task)}>
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
                          <span 
                              key={tag.id || idx} 
                              className={`px-2 py-0.5 text-[10px] rounded-full font-medium ${getTagStyle(tag.color).className}`}
                              style={getTagStyle(tag.color).style}
                          >
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
              
              <td
                  className="px-4 py-3 text-xs text-gray-600"
                  title={task.estimatedHours == null ? 'No estimate set' : 'Hours logged against the estimate'}
              >
                  {task.actualHours || 0} / {estimateLabel(task.estimatedHours)}
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
      const topLevelTasks = topLevelListTasks;
      const windowedTasks = topLevelTasks.length > 40
          ? topLevelTasks.slice(listWindow.start, listWindow.end)
          : topLevelTasks;
      
      return (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
              <div
                  className="overflow-auto"
                  style={topLevelTasks.length > 40 ? { maxHeight: listWindow.viewportHeight } : undefined}
                  onScroll={topLevelTasks.length > 40 ? listWindow.onScroll : undefined}
              >
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
                              <>
                              {topLevelTasks.length > 40 && listWindow.paddingTop > 0 && (
                                  <tr aria-hidden="true"><td colSpan={7} style={{ height: listWindow.paddingTop, padding: 0 }} /></tr>
                              )}
                              {windowedTasks.map(t => (
                                  <React.Fragment key={t.id}>
                                      {renderTaskRow(t, 0)}
                                  </React.Fragment>
                              ))}
                              {topLevelTasks.length > 40 && listWindow.paddingBottom > 0 && (
                                  <tr aria-hidden="true"><td colSpan={7} style={{ height: listWindow.paddingBottom, padding: 0 }} /></tr>
                              )}
                              </>
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
      // 'pending' is a legacy status no task carries any more, so the column it used to fill
      // stood permanently empty. 'awaiting_assignment' is what "pending" means now.
      //
      // 'new_request' leads because it is where every task starts: the tasks insert trigger
      // sets that status and will not take another value, so without a column for it a task
      // created from this very board dropped straight off the board it was created on.
      //
      // The + on a column is therefore a shortcut to the request form rather than a way to
      // file work into that column -- where a task goes next is the workflow's answer.
      const statusColumns: { status: TaskStatus; label: string; color: string }[] = [
          { status: 'new_request', label: 'New', color: 'bg-slate-100' },
          { status: 'scheduled', label: 'Scheduled', color: 'bg-purple-100' },
          { status: 'awaiting_assignment', label: 'Pending', color: 'bg-gray-100' },
          { status: 'awaiting_employee_approval', label: 'Awaiting Approval', color: 'bg-yellow-100' },
          { status: 'in_progress', label: 'In Progress', color: 'bg-blue-100' },
          { status: 'manager_review_required', label: 'Review', color: 'bg-orange-100' },
          { status: 'completed', label: 'Completed', color: 'bg-green-100' }
      ];

      return (
          <div className="bg-white rounded-lg border border-gray-200 p-6 overflow-x-auto">
              <div className="flex gap-4 min-w-max">
                  {statusColumns.map(column => {
                      // filteredTasks, not the live slice: the board names the status of every
                      // column it draws, so hiding finished work from it would empty the one
                      // column that exists to show it.
                      const columnTasks = filteredTasks.filter(t => t.status === column.status);

                      return (
                          <div key={column.status} className="group space-y-3 w-72 flex-shrink-0">
                              <div className="flex items-center justify-between">
                                  <h3 className="text-sm font-semibold text-gray-900">{column.label}</h3>
                                  <div className="flex items-center gap-1.5">
                                      <span className="text-xs text-gray-500">{columnTasks.length}</span>
                                      <button
                                          onClick={handleNewTask}
                                          title="New task"
                                          aria-label="New task"
                                          className="p-0.5 rounded text-gray-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-gray-100 hover:text-blue-600 transition-all"
                                      >
                                          <Plus className="w-4 h-4" />
                                      </button>
                                  </div>
                              </div>

                              <div className="space-y-2 min-h-[400px]">
                                  {columnTasks.map(task => {
                                      const assignedUser = task.assignedToId ? users.find(u => u.id === task.assignedToId) : null;
                                      const userTeam = assignedUser ? getUserTeam(assignedUser.id) : null;

                                      return (
                                          <div
                                              key={task.id}
                                              onClick={() => handleTaskClick(task)}
                                              className={`${column.color} border border-gray-200 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow${pendingClass(task)}`}
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
                                                      {estimateLabel(task.estimatedHours)}
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

                                  {/* Was a decorative strip under a column-wide click target.
                                      The target is gone, so this is the button now. */}
                                  <button
                                      onClick={handleNewTask}
                                      className="w-full flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-gray-200 text-xs text-gray-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:border-blue-300 hover:text-blue-600 transition-all"
                                  >
                                      <Plus className="w-3.5 h-3.5" />
                                      New task
                                  </button>
                              </div>
                          </div>
                      );
                  })}
              </div>
          </div>
      );
  };
  const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low'];
  const STATUSES: string[] = ['new_request', 'in_progress', 'scheduled', 'accepted', 'in_review', 'on_hold', 'completed', 'cancelled'];

  const activeCount = filterPriority.length + filterStatus.length + filterBrand.length + filterRegion.length + filterTag.length + filterAssignee.length + filterSkill.length;


  const kpis = [
      { label: 'Completed Tasks', value: filteredTasks.filter(t => t.status === 'completed').length, color: '#111827' },
      { label: 'In Review', value: filteredTasks.filter(t => t.status === 'in_review').length, color: '#f59e0b' },
      { label: 'In Progress', value: filteredTasks.filter(t => t.status === 'in_progress').length, color: '#10b981' },
      { label: 'Scheduled', value: filteredTasks.filter(t => t.status === 'scheduled').length, color: '#3b82f6' },
      { label: 'On Hold', value: filteredTasks.filter(t => t.status === 'on_hold').length, color: '#ef4444' },
  ];

  // min-h-full, not min-h-screen: this renders below the dashboard header, so a full
  // viewport of height here overflows the pane it sits in by exactly that header.
  if (loading) return <PageSkeleton variant="reports" />;

  return (
    <div className="min-h-full font-sans" style={{ backgroundColor: '#f9fafb' }}>
        {/* Header */}
        <div className="bg-white border-b border-gray-100">
            <div className="max-w-screen-xl mx-auto w-full px-8 pt-5 pb-3">
                
                {/* Row 1: title + KPIs */}
                <div className="flex items-start justify-between gap-8 mb-4">
                    <div className="shrink-0">
                        <h1 className="text-lg font-semibold text-gray-900 tracking-tight">Tasks</h1>
                        <p className="text-sm text-gray-400 mt-0.5">Manage and track your tasks</p>
                    </div>
                    <div className="flex items-center gap-6">
                        {kpis.map(({ label, value, color }) => (
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
                        value={filterTeam}
                        onChange={e => setFilterTeam(e.target.value)}
                        className="h-8 pl-3 pr-7 text-xs text-gray-700 bg-white border border-gray-200 rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer"
                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5l3.5 3.5 3.5-3.5' stroke='%239ca3af' stroke-width='1.3' stroke-linecap='round' fill='none'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
                    >
                        <option value="all">All Teams</option>
                        {visibleTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>

                    {pageMode === 'calendar' && (
                        <>
                            {/* Timescale */}
                            <div className="flex items-center h-8 bg-gray-100 rounded-lg p-0.5">
                                {(['day', 'week', 'month'] as CalendarView[]).map(s => (
                                    <button key={s} onClick={() => setViewMode(s)}
                                        className={`px-3 h-full rounded-md text-xs font-medium transition-colors ${viewMode === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                                        {s.charAt(0).toUpperCase() + s.slice(1)}
                                    </button>
                                ))}
                            </div>
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
                        {pageModes.map(key => (
                            <button key={key} title={key} onClick={() => setPageMode(key)}
                                className={`w-7 h-full flex items-center justify-center rounded-md transition-all ${pageMode === key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                                {ViewIcons[key as keyof typeof ViewIcons]}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={() => handleNewTask()}
                        className="h-8 px-3 ml-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 flex items-center gap-1.5 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        New Task
                    </button>
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
                                <PriorityPill key={p} priority={p}
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
                                <Pill key={s} label={formatStatusLabel(s)} color={STATUS_CONFIG[s]?.color || '#94a3b8'} dot
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
                            {clients.map(brand => {
                                const domainMap: Record<string, string> = {
                                    'CareStack': 'carestack.com', 'VoiceStack': 'voicestack.com',
                                    'OS Dental': 'osdental.com', 'ACE DSN': 'acedsn.com', 'Aeka': 'aeka.com'
                                };
                                let domain = '';
                                try { if (brand.website) domain = new URL(brand.website).hostname; } catch (e) {}
                                if (!domain) domain = domainMap[brand.name];
                                const logoUrl = brand.favicon || (domain ? `https://logo.clearbit.com/${domain}` : undefined);
                                return (
                                    <Pill key={brand.id} label={brand.name} color={BRAND_CONFIG[brand.name as Brand]?.color || '#3b82f6'}
                                        logoUrl={logoUrl}
                                        active={filterBrand.includes(brand.id)}
                                        onClick={() => {
                                            if (filterBrand.includes(brand.id)) setFilterBrand(filterBrand.filter(x => x !== brand.id));
                                            else setFilterBrand([...filterBrand, brand.id]);
                                        }}
                                    />
                                );
                            })}
                        </div>
                    </div>

                    <div className="w-px self-stretch bg-gray-100 shrink-0" />

                    <div className="flex flex-col gap-2">
                        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Region</span>
                        <div className="flex items-center gap-1 flex-wrap">
                            {regions.map(region => (
                                <Pill key={region.id} label={region.name} color="#475569" prefix={region.flag ? `${region.flag} ` : ''}
                                    active={filterRegion.includes(region.id)}
                                    onClick={() => {
                                        if (filterRegion.includes(region.id)) setFilterRegion(filterRegion.filter(x => x !== region.id));
                                        else setFilterRegion([...filterRegion, region.id]);
                                    }}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Assignee and tag have no pill row of their own — one per person and one
                        per tag would swamp the panel — so they appear only once something has
                        set them, which today means arriving from global search. Showing the
                        chip is what makes that filter visible and undoable. */}
                    {filterAssignee.length > 0 && (
                        <>
                            <div className="w-px self-stretch bg-gray-100 shrink-0" />
                            <div className="flex flex-col gap-2">
                                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Assignee</span>
                                <div className="flex items-center gap-1 flex-wrap">
                                    {filterAssignee.map(id => (
                                        <Pill key={id} label={users.find(u => u.id === id)?.name || 'Unknown'} color="#2563eb" active
                                            onClick={() => setFilterAssignee(filterAssignee.filter(x => x !== id))}
                                        />
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    {filterSkill.length > 0 && (
                        <>
                            <div className="w-px self-stretch bg-gray-100 shrink-0" />
                            <div className="flex flex-col gap-2">
                                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Skill</span>
                                <div className="flex items-center gap-1 flex-wrap">
                                    {filterSkill.map(id => (
                                        <Pill key={id} label={skills.find(s => s.id === id)?.name || 'Unknown'} color="#7c3aed" active
                                            onClick={() => setFilterSkill(filterSkill.filter(x => x !== id))}
                                        />
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    {filterTag.length > 0 && (
                        <>
                            <div className="w-px self-stretch bg-gray-100 shrink-0" />
                            <div className="flex flex-col gap-2">
                                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Tag</span>
                                <div className="flex items-center gap-1 flex-wrap">
                                    {filterTag.map(id => {
                                        const tag = allTags.find(t => t.id === id);
                                        return (
                                            <Pill key={id} label={tag?.name || 'Unknown'} color={tag?.color || '#475569'} active
                                                onClick={() => setFilterTag(filterTag.filter(x => x !== id))}
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        </>
                    )}

                    {activeCount > 0 && (
                        <>
                            <div className="w-px self-stretch bg-gray-100 shrink-0" />
                            <div className="flex flex-col gap-2">
                                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest opacity-0">·</span>
                                <button onClick={() => {
                                    setFilterTeam('all');
                                    setFilterPriority([]);
                                    setFilterStatus([]);
                                    setFilterBrand([]);
                                    setFilterRegion([]);
                                    setFilterTag([]);
                                    setFilterAssignee([]);
                                    setFilterSkill([]);
                                }}
                                    className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md text-xs font-medium text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-all border border-transparent hover:border-gray-200">
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
        
        <div className="max-w-screen-xl mx-auto px-8 py-6 w-full space-y-6">

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
      {pageMode === 'timeline' && showTimeline && renderTimelineView()}
      
      {/* Render Calendar Views */}
      {pageMode === 'calendar' && viewMode === 'month' && renderMonthView()}
      {pageMode === 'calendar' && viewMode === 'week' && renderWeekView()}
      {pageMode === 'calendar' && viewMode === 'day' && renderDayView()}

      {/* Task Details Panel */}
      <TaskDetailsPanel
        task={selectedTask}
        isOpen={isTaskPanelOpen}
        onClose={closeTaskPanel}
        currentUser={currentUser}
        onStatusChange={handleStatusChange}
      />
      </div>
    </div>
  );
}
