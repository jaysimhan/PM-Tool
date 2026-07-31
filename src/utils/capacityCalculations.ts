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
            return 'bg-gray-100 text-gray-600';
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
        case 'on_hold':     return 'bg-gray-400';
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