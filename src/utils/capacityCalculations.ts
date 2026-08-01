import { Task, User, Leave, CapacityData, WorkloadStatus } from '../types/types';

export function getWorkloadStatus(utilization: number): WorkloadStatus {
    if (utilization >= 100) return 'overallocated';
    if (utilization >= 80) return 'near_capacity';
    if (utilization >= 50) return 'balanced';
    return 'available';
}

export function getWorkloadColor(status: WorkloadStatus): string {
    switch (status) {
        case 'available': return '#10B981';
        case 'balanced': return '#3B82F6';
        case 'near_capacity': return '#F59E0B';
        case 'overallocated': return '#EF4444';
        default: return '#6B7280';
    }
    return '#6B7280';
}

export function calculateDailyCapacity(
    user: User,
    date: string,
    tasks: Task[],
    leaves: Leave[]
): CapacityData {
    // Parse date once for all comparisons
    const dateTs = new Date(date).getTime();

    // Check if user is on leave
    const onLeave = leaves.some(leave =>
        leave.userId === user.id &&
        new Date(leave.startDate).getTime() <= dateTs &&
        new Date(leave.endDate).getTime() >= dateTs
    );

    const totalCapacity = onLeave ? 0 : user.dailyCapacity;

    // Calculate scheduled hours for this date
    const userTasks = tasks.filter(task =>
        task.assignedToId === user.id &&
        task.status !== 'completed' &&
        task.status !== 'cancelled' &&
        task.proposedStartDate &&
        task.proposedEndDate &&
        new Date(task.proposedStartDate).getTime() <= dateTs &&
        new Date(task.proposedEndDate).getTime() >= dateTs
    );

    let scheduledHours = 0;
    let provisionalHours = 0;

    userTasks.forEach(task => {
        const hoursPerDay = calculateTaskHoursPerDay(task);

        if (task.status === 'accepted' || task.status === 'in_progress' || task.status === 'scheduled') {
            scheduledHours += hoursPerDay;
        } else if (task.status === 'awaiting_employee_approval' || task.status === 'provisional_assignment') {
            provisionalHours += hoursPerDay;
        }
    });

    const availableHours = Math.max(0, totalCapacity - scheduledHours);
    const utilization = totalCapacity > 0 ? (scheduledHours / totalCapacity) * 100 : 0;
    const status = getWorkloadStatus(utilization);

    return {
        date,
        totalCapacity,
        scheduledHours,
        provisionalHours,
        blockedHours: 0,
        leaveHours: onLeave ? user.dailyCapacity : 0,
        availableHours,
        utilization,
        status,
        taskCount: userTasks.length
    };
}

function calculateTaskHoursPerDay(task: Task): number {
    if (!task.proposedStartDate || !task.proposedEndDate) return 0;

    const start = new Date(task.proposedStartDate);
    const end = new Date(task.proposedEndDate);

    const daysDiff = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    // Distribute hours evenly across days
    return task.estimatedHours / daysDiff;
}

export function getDatesInRange(startDate: string, days: number): string[] {
    const dates: string[] = [];
    const start = new Date(startDate);

    for (let i = 0; i < days; i++) {
        const date = new Date(start);
        date.setDate(start.getDate() + i);
        dates.push(date.toISOString().split('T')[0]);
    }

    return dates;
}

export function formatDate(dateString: string): string {
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
        return 'Today';
    }
    if (date.toDateString() === tomorrow.toDateString()) {
        return 'Tomorrow';
    }

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function getTasksForDateRange(tasks: Task[], startDate: string, endDate: string): Task[] {
    return tasks.filter(task => {
        if (!task.proposedStartDate || !task.proposedEndDate) return false;

        const taskStart = new Date(task.proposedStartDate);
        const taskEnd = new Date(task.proposedEndDate);
        const rangeStart = new Date(startDate);
        const rangeEnd = new Date(endDate);

        return taskStart <= rangeEnd && taskEnd >= rangeStart;
    });
}

export function getPriorityColor(priority?: string): string {
    if (!priority) return '#9CA3AF'; // default gray
    switch (priority.toLowerCase()) {
        case 'urgent': return '#EF4444';
        case 'high': return '#F59E0B';
        case 'normal': return '#3B82F6';
        case 'low': return '#6B7280';
        default: return '#6B7280';
    }
}

export const getStatusBadgeColor = (status: string): string => {
    switch (status) {
        case 'planning':
            return 'bg-indigo-100 text-indigo-800';
        case 'in_progress':
            return 'bg-blue-100 text-blue-800';
        case 'in_review':
            return 'bg-yellow-100 text-yellow-800';
        case 'on_hold':
            return 'bg-red-100 text-red-800';
        case 'completed':
            return 'bg-green-100 text-green-800';
        // legacy request statuses (for request panels)
        case 'pending':
            return 'bg-yellow-100 text-yellow-800';
        case 'assigned':
            return 'bg-blue-100 text-blue-800';
        case 'accepted':
            return 'bg-green-100 text-green-800';
        case 'rejected':
            return 'bg-red-100 text-red-800';
        case 'cancelled':
            return 'bg-red-100 text-red-800';
        case 'scheduled':
            return 'bg-purple-100 text-purple-800';
        default:
            return 'bg-gray-100 text-gray-600';
    }
};

export const formatStatusLabel = (status: string): string => {
    switch (status) {
        case 'new_request': return 'New Request';
        case 'planning': return 'Planning';
        case 'in_progress': return 'In Progress';
        case 'in_review': return 'In Review';
        case 'on_hold': return 'On Hold';
        case 'completed': return 'Completed';
        // legacy
        case 'pending': return 'Pending';
        case 'assigned': return 'Assigned';
        case 'accepted': return 'Accepted';
        case 'rejected': return 'Rejected';
        case 'cancelled': return 'Cancelled';
        case 'scheduled': return 'Scheduled';
        default: return status.replace(/_/g, ' ');
    }
};

export const getStatusDotColor = (status: string): string => {
    switch (status) {
        case 'planning':    return 'bg-indigo-500';
        case 'in_progress': return 'bg-blue-500';
        case 'in_review':   return 'bg-yellow-500';
        case 'on_hold':     return 'bg-red-500';
        case 'completed':   return 'bg-green-500';
        case 'pending':     return 'bg-yellow-400';
        case 'assigned':    return 'bg-blue-400';
        case 'accepted':    return 'bg-green-400';
        case 'rejected':    return 'bg-red-500';
        case 'cancelled':   return 'bg-red-500';
        case 'scheduled':   return 'bg-purple-500';
        default:            return 'bg-gray-400';
    }
};

export interface TimelineBounds {
    start: Date;
    end: Date;
}

export interface TimelineColumn {
    date: Date;
    endDate: Date;
    label: string;
    subLabel?: string;
    isWeekend?: boolean;
}

export function getProjectTimelineBounds(tasks: Task[]): TimelineBounds {
    if (!tasks || tasks.length === 0) {
        const today = new Date();
        const start = new Date(today);
        start.setDate(start.getDate() - 7);
        const end = new Date(today);
        end.setDate(end.getDate() + 28);
        return { start, end };
    }

    let minStart = new Date(3000, 0, 1).getTime();
    let maxEnd = new Date(1970, 0, 1).getTime();

    tasks.forEach(t => {
        if (t.proposedStartDate) {
            const start = new Date(t.proposedStartDate).getTime();
            if (start < minStart) minStart = start;
        }
        if (t.proposedEndDate) {
            const end = new Date(t.proposedEndDate).getTime();
            if (end > maxEnd) maxEnd = end;
        }
    });

    if (minStart > maxEnd) {
        const today = new Date();
        minStart = today.getTime() - 7 * 24 * 60 * 60 * 1000;
        maxEnd = today.getTime() + 28 * 24 * 60 * 60 * 1000;
    }

    const startDate = new Date(minStart);
    startDate.setDate(startDate.getDate() - 7); // Pad start

    const endDate = new Date(maxEnd);
    endDate.setDate(endDate.getDate() + 14); // Pad end

    return { start: startDate, end: endDate };
}

export function getTimelineColumns(bounds: TimelineBounds, scale: 'day' | 'week' | 'month'): TimelineColumn[] {
    const columns: TimelineColumn[] = [];
    const current = new Date(bounds.start);
    current.setHours(0, 0, 0, 0);

    const end = new Date(bounds.end);
    end.setHours(23, 59, 59, 999);

    if (scale === 'day') {
        while (current <= end) {
            const colEnd = new Date(current);
            colEnd.setHours(23, 59, 59, 999);
            const isWeekend = current.getDay() === 0 || current.getDay() === 6;
            columns.push({
                date: new Date(current),
                endDate: colEnd,
                label: current.getDate().toString(),
                subLabel: current.toLocaleDateString('en-US', { weekday: 'narrow' }),
                isWeekend
            });
            current.setDate(current.getDate() + 1);
        }
    } else if (scale === 'week') {
        const day = current.getDay();
        const diff = current.getDate() - day + (day === 0 ? -6 : 1); // adjust to Monday
        current.setDate(diff);

        while (current <= end) {
            const weekEnd = new Date(current);
            weekEnd.setDate(current.getDate() + 6);
            weekEnd.setHours(23, 59, 59, 999);
            columns.push({
                date: new Date(current),
                endDate: weekEnd,
                label: `W${Math.ceil(current.getDate() / 7)}`,
                subLabel: `${current.getMonth() + 1}/${current.getDate()}`
            });
            current.setDate(current.getDate() + 7);
        }
    } else if (scale === 'month') {
        current.setDate(1);
        while (current <= end) {
            const colEnd = new Date(current);
            colEnd.setMonth(current.getMonth() + 1);
            colEnd.setDate(0);
            colEnd.setHours(23, 59, 59, 999);
            columns.push({
                date: new Date(current),
                endDate: colEnd,
                label: current.toLocaleDateString('en-US', { month: 'short' }),
                subLabel: current.getFullYear().toString()
            });
            current.setMonth(current.getMonth() + 1);
        }
    }

    return columns;
}