// Type definitions for the workload management system

// 'requester' and 'invitee' are the two states before membership, and the difference between
// them is approval: a requester asked to be let in and has no account, an invitee was approved
// and has an account waiting for a password. Neither can be assigned work, so both are filtered
// out of the member pickers; only an invitee can complete setup.
export type UserRole = 'super_admin' | 'admin' | 'manager' | 'team_leader' | 'team_member' | 'invitee' | 'requester';

/** Everyone who is not a member yet. Not assignable, not shown in workload pickers. */
export const PRE_MEMBER_ROLES: UserRole[] = ['invitee', 'requester'];

export const isPreMember = (role: UserRole) => PRE_MEMBER_ROLES.includes(role);

export type TaskStatus =
    | 'new_request'
    | 'awaiting_assignment'
    | 'provisional_assignment'
    | 'awaiting_employee_approval'
    | 'manager_review_required'
    | 'accepted'
    | 'scheduled'
    | 'in_progress'
    | 'in_review'
    | 'waiting_for_information'
    | 'waiting_for_approval'
    | 'blocked'
    | 'changes_requested'
    | 'completed'
    | 'cancelled'
    | 'on_hold';

export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export type WorkloadStatus = 'available' | 'balanced' | 'near_capacity' | 'overallocated';

export interface User {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    teamIds: string[];
    skillIds: string[];
    // The brands and regions this person wants work from. Round-robin assignment honours them;
    // assigning by hand does not, since it exists for work nobody's preferences covered.
    clientIds: string[];
    regionIds: string[];
    dailyCapacity: number; // hours per day
    avatar?: string;
    isActive: boolean;
    // False for someone who has been invited but has not set a password and picked a
    // team/skills yet. Their profile row exists from the moment the invite is issued,
    // so absence of a row cannot stand in for this.
    onboardingCompleted: boolean;
    // Set on a deleted account. The row survives its login so a reactivation request has a
    // name to show; nothing else in the app should treat it as a person. Coming back means a
    // fresh invite and a new row, not the return of this one.
    deletedAt?: string | null;
}

export interface AccessRequest {
    id: string;
    kind: 'access' | 'reactivation';
    userId?: string | null;
    name: string;
    email: string;
    note?: string | null;
    status: 'pending' | 'invited' | 'dismissed';
    createdAt: string;
}

export interface Team {
    id: string;
    name: string;
    description: string;
    memberIds: string[];
    skillIds: string[];
    color: string;
    isHomeTeam: boolean; // the one team the sole super_admin always belongs to
}

export interface Skill {
    id: string;
    name: string;
    category: string;
    teamIds: string[];
}

export interface UserSkill {
    userId: string;
    skillId: string;
    proficiencyLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
}

export interface Tag {
    id: string;
    name: string;
    color: string;
}

export interface WorkCategory {
    id: string;
    name: string;
    teamIds: string[];
    skillIds: string[];
    defaultHours: number;
    icon?: string;
    isActive: boolean;
}

export interface Client {
    id: string;
    name: string;
    department?: string;
    website?: string;
    favicon?: string;
}

export interface Region {
    id: string;
    name: string;
    code: string;
    flag?: string;
    created_at?: string;
}

export interface Task {
    id: string;
    requestId: string;
    title: string;
    description: string;
    categoryId: string;
    clientId: string;
    regionId?: string;
    region?: Region;
    department?: string;
    requesterId: string;
    // Set for requests that came in through the public share link. Whoever submitted has
    // no account, so requesterId is null and these carry the identity instead.
    requesterName?: string;
    requesterEmail?: string;
    priority?: Priority;
    status: TaskStatus;
    estimatedHours: number;
    actualHours?: number;
    dueDate: string;
    createdDate: string;
    completedDate?: string;
    teamIds: string[];
    requiredSkillIds: string[];
    subtaskIds: string[];
    assignedToId?: string;
    assignedDate?: string;
    assignedById?: string;   // who assigned/accepted (admin, manager, or self-accepted)
    acceptedDate?: string;
    proposedStartDate?: string;
    proposedEndDate?: string;
    parentTaskId?: string;
    sortOrder?: number;
    dependencyIds: string[]; // Legacy, kept for compatibility
    blockedByIds?: string[];
    blocksIds?: string[];
    linkedTaskIds?: string[];
    tags: Tag[];
    isSubtask: boolean;
    checklist?: { id: string; text: string; completed: boolean; assigneeId?: string }[];
    // Answers to the fields an admin added in Customize Request Form, keyed by field_key.
    // Core fields keep their own columns; only these live in tasks.custom_fields.
    customFields?: Record<string, string | number | boolean>;
}

export interface Leave {
    id: string;
    userId: string;
    startDate: string;
    endDate: string;
    type: 'vacation' | 'sick' | 'personal' | 'holiday' | 'meeting' | 'training' | 'blocked';
    hours?: number;
    description?: string;
}

export interface Assignment {
    id: string;
    taskId: string;
    userId: string;
    status: 'pending' | 'accepted' | 'rejected' | 'reassigned';
    assignedDate: string;
    assignedById?: string;
    responseDate?: string;
    proposedStartDate?: string;
    proposedEndDate?: string;
    estimatedHours?: number;
    rejectionReason?: string;
}

export interface Comment {
    id: string;
    taskId: string;
    userId: string;
    content: string;
    createdDate: string;
    isInternal: boolean;
}

export interface Notification {
    id: string;
    userId: string;
    type: string;
    title: string;
    message: string;
    createdDate: string;
    isRead: boolean;
    link?: string;
}

/**
 * Something that happened to a task, written down because the task's own columns cannot imply
 * it. The first of these is the assignee revising the deadline or the hours on the way to
 * accepting: those figures are overwritten in place, so without a record the numbers the
 * requester actually asked for are gone.
 *
 * Written only by definer functions in the database — see the task acceptance migration —
 * which is what makes it a history rather than a field anyone can rewrite.
 */
export interface TaskActivity {
    id: string;
    taskId: string;
    actorId?: string;
    type: 'estimates_revised_on_accept' | string;
    detail: TaskActivityDetail;
    createdDate: string;
}

export interface TaskActivityDetail {
    dueDateChanged?: boolean;
    previousDueDate?: string | null;
    newDueDate?: string | null;
    estimatedHoursChanged?: boolean;
    previousEstimatedHours?: number | null;
    newEstimatedHours?: number | null;
    [key: string]: unknown;
}

export interface AuditLog {
    id: string;
    userId: string;
    action: string;
    entityType: string;
    entityId: string;
    changes: Record<string, any>;
    timestamp: string;
}

export interface CapacityData {
    date: string;
    totalCapacity: number;
    scheduledHours: number;
    provisionalHours: number;
    blockedHours: number;
    leaveHours: number;
    availableHours: number;
    utilization: number;
    status: WorkloadStatus;
    taskCount: number;
}

export interface DailyWorkload {
    userId: string;
    date: string;
    capacity: CapacityData;
    tasks: Task[];
}

export interface TeamCapacity {
    teamId: string;
    date: string;
    totalCapacity: number;
    availableCapacity: number;
    scheduledHours: number;
    provisionalHours: number;
    utilization: number;
    availableMembers: number;
    overloadedMembers: number;
    status: WorkloadStatus;
}
