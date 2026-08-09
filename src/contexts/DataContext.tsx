import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '../types/database';
import toast from 'react-hot-toast';
import { useAuth } from './AuthContext';
import { User, Team, Skill, WorkCategory, Client, Task, Comment, Leave, Assignment, Notification, UserSkill, Tag, Region } from '../types/types';
import { captureOperationalError } from '../lib/observability';

// Keep the test-sandbox proxy as the single client while giving every data-layer query the
// generated schema. Other feature code can migrate independently without weakening these reads.
const db = supabase as SupabaseClient<Database>;
type AssignmentRow = Pick<Tables<'assignments'>,
    'id' | 'task_id' | 'user_id' | 'status' | 'assigned_date' | 'assigned_by_id' |
    'response_date' | 'proposed_start_date' | 'proposed_end_date' | 'estimated_hours' | 'rejection_reason'>;
type NotificationRow = Tables<'notifications'>;
type WorkCategoryRow = Tables<'work_categories'>;
type TaskDependencyRow = Tables<'task_dependencies'>;

export interface DataContextType {
    users: User[];
    teams: Team[];
    skills: Skill[];
    workCategories: WorkCategory[];
    clients: Client[];
    tasks: Task[];
    leaves: Leave[];
    assignments: Assignment[];
    notifications: Notification[];
    comments: Comment[];
    allTags: Tag[];
    regions: Region[];
    loading: boolean;
    loadIssues: string[];
    retryDataLoad: () => Promise<void>;
    hasMoreTasks: boolean;
    loadingMoreTasks: boolean;
    loadMoreTasks: () => Promise<void>;
    refreshTasks: () => Promise<void>;
    refreshTeams: () => Promise<void>;
    refreshTags: () => Promise<void>;
    refreshRegions: () => Promise<void>;
    refreshClients: () => Promise<void>;
    refreshSkills: () => Promise<void>;
    refreshUsers: () => Promise<void>;
    refreshAssignments: () => Promise<void>;
    refreshNotifications: () => Promise<void>;
}

// Rows in the shape the database hands them over, mapped once here so nothing downstream has
// to know both spellings.
const toAssignment = (a: AssignmentRow): Assignment => ({
    id: a.id,
    taskId: a.task_id,
    userId: a.user_id,
    status: a.status as Assignment['status'],
    assignedDate: a.assigned_date,
    assignedById: a.assigned_by_id || undefined,
    responseDate: a.response_date || undefined,
    proposedStartDate: a.proposed_start_date || undefined,
    proposedEndDate: a.proposed_end_date || undefined,
    estimatedHours: a.estimated_hours ?? undefined,
    rejectionReason: a.rejection_reason || undefined
});

const toNotification = (n: NotificationRow): Notification => ({
    id: n.id,
    userId: n.user_id || '',
    type: n.type,
    title: n.title,
    message: n.message,
    createdDate: n.created_at || '',
    isRead: n.is_read === true,
    link: n.link || undefined
});

const toWorkCategory = (c: WorkCategoryRow): WorkCategory => ({
    id: c.id,
    name: c.name,
    defaultHours: c.default_hours ?? 0,
    icon: c.icon || undefined,
    isActive: c.is_active !== false,
    teamIds: [],
    skillIds: []
});

// Explicit column lists, not select('*'). Two reasons beyond payload size: the reply stops
// carrying columns no screen reads (sessions_revoked_at, deleted_email, proficiency_level),
// and adding a column to a table can no longer silently change what every page receives.
const USER_COLUMNS = 'id, name, email, role, daily_capacity, avatar, is_active, onboarding_completed, deleted_at';
const TEAM_COLUMNS = 'id, name, description, color, is_home_team';

const ASSIGNMENT_COLUMNS = 'id, task_id, user_id, status, assigned_date, assigned_by_id, response_date, proposed_start_date, proposed_end_date, estimated_hours, rejection_reason' as const;

const NOTIFICATION_COLUMNS = 'id, user_id, type, title, message, created_at, is_read, link';

// Named columns rather than `*`, and every one of them is read by something. The embedded
// tags and region are narrowed too: the old `tags(*)` and `regions(*)` pulled created_at on
// every tag of every task.
const TASK_COLUMNS = 'id, request_id, title, description, status, priority, estimated_hours, actual_hours, due_date, created_at, completed_date, assignee_id, assigned_date, assigned_by_id, accepted_date, proposed_start_date, proposed_end_date, parent_task_id, is_subtask, sort_order, checklist, region_id, client_id, category_id, department, requester_id, requester_name, requester_email, custom_fields, task_tags(tags(id, name, color)), region:regions(id, name, code, flag)' as const;
const TASK_PAGE_SIZE = 250;

type TaskRelations = {
    subtaskIds: string[];
    blockedByIds: string[];
    blocksIds: string[];
    linkedTaskIds: string[];
};

const buildTaskRelations = (
    taskRows: Array<{ id: string; parent_task_id: string | null; sort_order?: number | null }>,
    dependencyRows: TaskDependencyRow[]
) => {
    const byTask = new Map<string, TaskRelations>();
    const get = (id: string) => {
        let relations = byTask.get(id);
        if (!relations) {
            relations = { subtaskIds: [], blockedByIds: [], blocksIds: [], linkedTaskIds: [] };
            byTask.set(id, relations);
        }
        return relations;
    };

    taskRows.forEach(row => {
        get(row.id);
        if (row.parent_task_id) get(row.parent_task_id).subtaskIds.push(row.id);
    });

    const orderById = new Map(taskRows.map(row => [row.id, row.sort_order ?? 0]));
    byTask.forEach(relations => {
        relations.subtaskIds.sort((a, b) => (orderById.get(a) ?? 0) - (orderById.get(b) ?? 0));
    });

    dependencyRows.forEach(row => {
        const task = get(row.task_id);
        const other = get(row.depends_on_task_id);
        if (row.type === 'linked') {
            task.linkedTaskIds.push(row.depends_on_task_id);
            other.linkedTaskIds.push(row.task_id);
        } else if (row.type === 'blocks') {
            task.blocksIds.push(row.depends_on_task_id);
            other.blockedByIds.push(row.task_id);
        } else {
            task.blockedByIds.push(row.depends_on_task_id);
            other.blocksIds.push(row.task_id);
        }
    });

    return byTask;
};

const groupValues = <T extends Record<string, any>>(
    rows: T[], key: keyof T, value: keyof T
) => {
    const grouped = new Map<string, string[]>();
    rows.forEach(row => {
        const owner = String(row[key]);
        const values = grouped.get(owner) || [];
        values.push(String(row[value]));
        grouped.set(owner, values);
    });
    return grouped;
};

const transformTaskRows = (
    rows: any[], taskTeams: any[], taskSkills: any[], taskDependencies: TaskDependencyRow[]
): Task[] => {
    const teamsByTask = groupValues(taskTeams, 'task_id', 'team_id');
    const skillsByTask = groupValues(taskSkills, 'task_id', 'skill_id');
    const relations = buildTaskRelations(rows, taskDependencies);
    return rows.map(t => ({
        id: t.id, title: t.title, description: t.description, status: t.status,
        priority: t.priority, assignedToId: t.assignee_id, requesterId: t.requester_id,
        requesterName: t.requester_name || undefined, requesterEmail: t.requester_email || undefined,
        clientId: t.client_id, categoryId: t.category_id, department: t.department || undefined,
        customFields: t.custom_fields || {}, regionId: t.region_id, region: t.region || undefined,
        parentTaskId: t.parent_task_id, sortOrder: t.sort_order ?? 0, dueDate: t.due_date,
        proposedStartDate: t.proposed_start_date, proposedEndDate: t.proposed_end_date,
        estimatedHours: t.estimated_hours, actualHours: t.actual_hours ?? undefined,
        completedDate: t.completed_date || undefined, assignedDate: t.assigned_date || undefined,
        assignedById: t.assigned_by_id || undefined, acceptedDate: t.accepted_date || undefined,
        requestId: t.request_id || undefined,
        tags: (t.task_tags || []).map((tt: any) => tt.tags).filter(Boolean),
        teamIds: teamsByTask.get(t.id) || [], requiredSkillIds: skillsByTask.get(t.id) || [],
        isSubtask: t.is_subtask, createdDate: t.created_at,
        subtaskIds: relations.get(t.id)?.subtaskIds || [],
        dependencyIds: relations.get(t.id)?.blockedByIds || [],
        blockedByIds: relations.get(t.id)?.blockedByIds || [],
        blocksIds: relations.get(t.id)?.blocksIds || [],
        linkedTaskIds: relations.get(t.id)?.linkedTaskIds || [],
        checklist: Array.isArray(t.checklist) ? t.checklist as Task['checklist'] : []
    })) as unknown as Task[];
};

// Exported so the test environment can re-provide it with invented data — see
// TestDataProvider. Nothing else should reach past useData() to touch it.
export const DataContext = createContext<DataContextType | undefined>(undefined);

export function DataProvider({ children }: { children: React.ReactNode }) {
    const { session } = useAuth();
    const [users, setUsers] = useState<User[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);
    const [skills, setSkills] = useState<Skill[]>([]);
    const [workCategories, setWorkCategories] = useState<WorkCategory[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [leaves, setLeaves] = useState<Leave[]>([]);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [comments, setComments] = useState<Comment[]>([]);
    const [allTags, setAllTags] = useState<Tag[]>([]);
    const [regions, setRegions] = useState<Region[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadIssues, setLoadIssues] = useState<string[]>([]);
    const [taskLimit, setTaskLimit] = useState(TASK_PAGE_SIZE);
    const [hasMoreTasks, setHasMoreTasks] = useState(false);
    const [loadingMoreTasks, setLoadingMoreTasks] = useState(false);

    const fetchData = async () => {
        setLoading(true);
        setLoadIssues([]);
        try {
            const datasetNames = [
                'people', 'teams', 'team memberships', 'clients', 'tasks', 'task teams',
                'task skills', 'task relationships', 'tags', 'regions', 'skills',
                'team skills', 'user skills', 'user clients', 'user regions',
                'work categories', 'assignments', 'notifications'
            ];
            const queryResults = await Promise.all([
                db.from('users').select(USER_COLUMNS),
                db.from('teams').select(TEAM_COLUMNS),
                db.from('team_members').select('team_id, user_id'),
                db.from('clients').select('id, name, department, website, favicon'),
                db.from('tasks').select(TASK_COLUMNS).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(TASK_PAGE_SIZE),
                db.from('task_teams').select('task_id, team_id'),
                db.from('task_skills').select('task_id, skill_id'),
                db.from('task_dependencies').select('task_id, depends_on_task_id, type'),
                db.from('tags').select('id, name, color'),
                db.from('regions').select('id, name, code, flag'),
                db.from('skills').select('id, name, category'),
                db.from('team_skills').select('team_id, skill_id'),
                db.from('user_skills').select('user_id, skill_id'),
                db.from('user_clients').select('user_id, client_id'),
                db.from('user_regions').select('user_id, region_id'),
                db.from('work_categories').select('id, name, default_hours, icon, is_active'),
                db.from('assignments').select(ASSIGNMENT_COLUMNS),
                db.from('notifications')
                    .select(NOTIFICATION_COLUMNS)
                    .eq('user_id', session!.user.id)
                    .order('created_at', { ascending: false })
                    .limit(50)
            ]);
            const failedDatasets = queryResults.flatMap((result, index) =>
                result.error ? [datasetNames[index]] : []
            );
            setLoadIssues(failedDatasets);
            if (failedDatasets.length) {
                toast.error(`Could not load: ${failedDatasets.join(', ')}. Other data is still available.`);
                failedDatasets.forEach(dataset => captureOperationalError('data_query', new Error(), { dataset }));
            }
            const [
                { data: usersData },
                { data: teamsData },
                { data: teamMembersData },
                { data: clientsData },
                { data: tasksData },
                { data: taskTeamsData },
                { data: taskSkillsData },
                { data: taskDependenciesData },
                { data: tagsData },
                { data: regionsData },
                { data: skillsData },
                { data: teamSkillsData },
                { data: userSkillsData },
                { data: userClientsData },
                { data: userRegionsData },
                { data: workCategoriesData },
                { data: assignmentsData },
                { data: notificationsData }
            ] = queryResults;

            const memberTeams = groupValues(teamMembersData || [], 'user_id', 'team_id');
            const teamMembers = groupValues(teamMembersData || [], 'team_id', 'user_id');
            const userSkills = groupValues(userSkillsData || [], 'user_id', 'skill_id');
            const userClients = groupValues(userClientsData || [], 'user_id', 'client_id');
            const userRegions = groupValues(userRegionsData || [], 'user_id', 'region_id');
            const skillsByTeam = groupValues(teamSkillsData || [], 'team_id', 'skill_id');
            const teamsBySkill = groupValues(teamSkillsData || [], 'skill_id', 'team_id');
            const teamsByTask = groupValues(taskTeamsData || [], 'task_id', 'team_id');
            const skillsByTask = groupValues(taskSkillsData || [], 'task_id', 'skill_id');

            if (usersData) {
                const transformedUsers = usersData.map((u) => {
                    return {
                        id: u.id,
                        name: u.name,
                        email: u.email,
                        role: u.role,
                        skillIds: userSkills.get(u.id) || [],
                        clientIds: userClients.get(u.id) || [],
                        regionIds: userRegions.get(u.id) || [],
                        teamIds: Array.from(new Set(memberTeams.get(u.id) || [])),
                        // Was hardcoded to 8 for everybody. The column has always been there
                        // and the capacity bars have always summed it, so a team of part-time
                        // people read as though they had a full week of hours available.
                        dailyCapacity: u.daily_capacity ?? 8,
                        avatar: u.avatar,
                        isActive: u.is_active !== false,
                        onboardingCompleted: u.onboarding_completed === true,
                        deletedAt: u.deleted_at || null
                    };
                }) as unknown as User[];
                setUsers(transformedUsers);
            }
            if (teamsData) {
                const transformedTeams = teamsData.map((t) => {
                    return {
                        id: t.id,
                        name: t.name,
                        description: t.description,
                        color: t.color,
                        memberIds: teamMembers.get(t.id) || [],
                        skillIds: skillsByTeam.get(t.id) || [],
                        isHomeTeam: !!t.is_home_team
                    };
                }) as unknown as Team[];
                setTeams(transformedTeams);
            }
            if (skillsData) {
                const transformedSkills = skillsData.map((s) => ({
                    id: s.id,
                    name: s.name,
                    category: s.category || 'General',
                    teamIds: teamsBySkill.get(s.id) || []
                }));
                setSkills(transformedSkills);
            }
            if (clientsData) setClients(clientsData.map(c => ({ ...c, department: c.department || undefined, website: c.website || undefined, favicon: c.favicon || undefined })));
            if (tasksData) {
                setHasMoreTasks(tasksData.length === TASK_PAGE_SIZE);
                const relations = buildTaskRelations(tasksData, taskDependenciesData || []);
                const transformedTasks = tasksData.map((t) => ({
                    id: t.id,
                    title: t.title,
                    description: t.description,
                    status: t.status,
                    priority: t.priority,
                    assignedToId: t.assignee_id,
                    requesterId: t.requester_id,
                    requesterName: t.requester_name || undefined,
                    requesterEmail: t.requester_email || undefined,
                    clientId: t.client_id,
                    categoryId: t.category_id,
                    // department was on the Task type and in the database, but never made
                    // the trip between them -- the request form has always captured it.
                    department: t.department || undefined,
                    customFields: t.custom_fields || {},
                    regionId: t.region_id,
                    region: t.region || undefined,
                    parentTaskId: t.parent_task_id,
                    sortOrder: t.sort_order ?? 0,
                    dueDate: t.due_date,
                    proposedStartDate: t.proposed_start_date,
                    proposedEndDate: t.proposed_end_date,
                    estimatedHours: t.estimated_hours,
                    // Six fields the Task type has always declared and screens have always
                    // read, which this transform never filled in: the activity feed's
                    // "assigned" entries checked task.assignedDate and so never rendered,
                    // reports summed actualHours that were always undefined, and the request
                    // id shown on the panel fell back to a slice of the uuid.
                    actualHours: t.actual_hours ?? undefined,
                    completedDate: t.completed_date || undefined,
                    assignedDate: t.assigned_date || undefined,
                    assignedById: t.assigned_by_id || undefined,
                    acceptedDate: t.accepted_date || undefined,
                    requestId: t.request_id || undefined,
                    tags: (t.task_tags || []).map((tt) => tt.tags).filter(Boolean),
                    teamIds: teamsByTask.get(t.id) || [],
                    requiredSkillIds: skillsByTask.get(t.id) || [],
                    isSubtask: t.is_subtask,
                    createdDate: t.created_at,
                    // No such columns exist on tasks; subtasks are found by parent_task_id and
                    // dependencies live in task_dependencies. Kept as empty arrays because
                    // callers index into them, but nothing here can populate them.
                    subtaskIds: relations.get(t.id)?.subtaskIds || [],
                    dependencyIds: relations.get(t.id)?.blockedByIds || [],
                    blockedByIds: relations.get(t.id)?.blockedByIds || [],
                    blocksIds: relations.get(t.id)?.blocksIds || [],
                    linkedTaskIds: relations.get(t.id)?.linkedTaskIds || [],
                    checklist: Array.isArray(t.checklist) ? t.checklist as unknown as Task['checklist'] : []
                })) as unknown as Task[];
                setTasks(transformedTasks);
            }
            if (tagsData) {
                setAllTags(tagsData);
            }
            if (regionsData) {
                setRegions(regionsData.map(r => ({ ...r, flag: r.flag || undefined })));
            }
            if (workCategoriesData) setWorkCategories(workCategoriesData.map(c => toWorkCategory(c as WorkCategoryRow)));
            if (assignmentsData) setAssignments(assignmentsData.map(toAssignment));
            if (notificationsData) setNotifications(notificationsData.map(toNotification));
        } catch (error) {
            console.error('Error fetching data from Supabase:', error);
            captureOperationalError('data_query', error, { dataset: 'initial_load' });
            toast.error('Some application data could not be loaded. Please retry.');
            setLoadIssues(['application data']);
        } finally {
            setLoading(false);
        }
    };

    const refreshUsers = async () => {
        const [
            { data: usersData },
            { data: teamMembersData },
            { data: userSkillsData },
            { data: userClientsData },
            { data: userRegionsData }
        ] = await Promise.all([
            db.from('users').select(USER_COLUMNS),
            db.from('team_members').select('team_id, user_id'),
            db.from('user_skills').select('user_id, skill_id'),
            db.from('user_clients').select('user_id, client_id'),
            db.from('user_regions').select('user_id, region_id')
        ]);
        if (usersData) {
            const members = teamMembersData || [];
            const uSkills = userSkillsData || [];
            const uClients = userClientsData || [];
            const uRegions = userRegionsData || [];
            const transformedUsers = usersData.map((u) => {
                const userTeams = Array.from(new Set(members.filter((m) => m.user_id === u.id).map((m) => m.team_id)));
                return {
                    id: u.id,
                    name: u.name,
                    email: u.email,
                    role: u.role,
                    avatar: u.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${u.name}&backgroundColor=3b82f6`,
                    teamIds: userTeams,
                    skillIds: uSkills.filter((us) => us.user_id === u.id).map((us) => us.skill_id),
                    clientIds: uClients.filter((uc) => uc.user_id === u.id).map((uc) => uc.client_id),
                    regionIds: uRegions.filter((ur) => ur.user_id === u.id).map((ur) => ur.region_id),
                    dailyCapacity: u.daily_capacity ?? 8,
                    isActive: u.is_active !== false,
                    onboardingCompleted: u.onboarding_completed === true,
                    deletedAt: u.deleted_at || null
                };
            }) as unknown as User[];
            setUsers(transformedUsers);
        }
    };

    const refreshTasks = async (limit = taskLimit) => {
        const [{ data: tasksData }, { data: taskTeamsData }, { data: taskSkillsData }, { data: taskDependenciesData }] = await Promise.all([
            db.from('tasks').select(TASK_COLUMNS).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit),
            db.from('task_teams').select('task_id, team_id'),
            db.from('task_skills').select('task_id, skill_id'),
            db.from('task_dependencies').select('task_id, depends_on_task_id, type')
        ]);
        if (tasksData) {
            setHasMoreTasks(tasksData.length === limit);
            const teamsByTask = groupValues(taskTeamsData || [], 'task_id', 'team_id');
            const skillsByTask = groupValues(taskSkillsData || [], 'task_id', 'skill_id');
            const relations = buildTaskRelations(tasksData, taskDependenciesData || []);
            const transformedTasks = tasksData.map((t) => ({
                id: t.id,
                title: t.title,
                description: t.description,
                status: t.status,
                priority: t.priority,
                assignedToId: t.assignee_id,
                requesterId: t.requester_id,
                requesterName: t.requester_name || undefined,
                requesterEmail: t.requester_email || undefined,
                clientId: t.client_id,
                categoryId: t.category_id,
                department: t.department || undefined,
                customFields: t.custom_fields || {},
                regionId: t.region_id,
                region: t.region || undefined,
                parentTaskId: t.parent_task_id,
                sortOrder: t.sort_order ?? 0,
                dueDate: t.due_date,
                proposedStartDate: t.proposed_start_date,
                proposedEndDate: t.proposed_end_date,
                estimatedHours: t.estimated_hours,
                // Same six fields as the initial load; a refresh must not quietly return a
                // thinner task than the one the page started with.
                actualHours: t.actual_hours ?? undefined,
                completedDate: t.completed_date || undefined,
                assignedDate: t.assigned_date || undefined,
                assignedById: t.assigned_by_id || undefined,
                acceptedDate: t.accepted_date || undefined,
                requestId: t.request_id || undefined,
                tags: (t.task_tags || []).map((tt) => tt.tags).filter(Boolean),
                teamIds: teamsByTask.get(t.id) || [],
                requiredSkillIds: skillsByTask.get(t.id) || [],
                isSubtask: t.is_subtask,
                createdDate: t.created_at,
                subtaskIds: relations.get(t.id)?.subtaskIds || [],
                dependencyIds: relations.get(t.id)?.blockedByIds || [],
                blockedByIds: relations.get(t.id)?.blockedByIds || [],
                blocksIds: relations.get(t.id)?.blocksIds || [],
                linkedTaskIds: relations.get(t.id)?.linkedTaskIds || [],
                checklist: Array.isArray(t.checklist) ? t.checklist as unknown as Task['checklist'] : []
            })) as unknown as Task[];
            setTasks(transformedTasks);
        }
    };

    const loadMoreTasks = async () => {
        if (loadingMoreTasks || !hasMoreTasks || tasks.length === 0) return;
        setLoadingMoreTasks(true);
        try {
            const cursor = tasks[tasks.length - 1];
            const { data: page, error } = await db.from('tasks')
                .select(TASK_COLUMNS)
                .or(`created_at.lt.${cursor.createdDate},and(created_at.eq.${cursor.createdDate},id.lt.${cursor.id})`)
                .order('created_at', { ascending: false })
                .order('id', { ascending: false })
                .limit(TASK_PAGE_SIZE);
            if (error) throw error;
            const ids = (page || []).map(row => row.id);
            if (!ids.length) { setHasMoreTasks(false); return; }
            const [{ data: taskTeams }, { data: taskSkills }, { data: dependencies }] = await Promise.all([
                db.from('task_teams').select('task_id, team_id').in('task_id', ids),
                db.from('task_skills').select('task_id, skill_id').in('task_id', ids),
                db.from('task_dependencies').select('task_id, depends_on_task_id, type').in('task_id', ids),
            ]);
            const additional = transformTaskRows(page || [], taskTeams || [], taskSkills || [], dependencies || []);
            setTasks(current => {
                const known = new Set(current.map(item => item.id));
                return [...current, ...additional.filter(item => !known.has(item.id))];
            });
            setTaskLimit(current => current + additional.length);
            setHasMoreTasks((page || []).length === TASK_PAGE_SIZE);
        } catch (error) {
            captureOperationalError('data_query', error, { dataset: 'older_tasks' });
            toast.error('Could not load older tasks. Please retry.');
        } finally {
            setLoadingMoreTasks(false);
        }
    };

    const refreshTeams = async () => {
        const [
            { data: teamsData },
            { data: teamMembersData },
            { data: teamSkillsData }
        ] = await Promise.all([
            db.from('teams').select(TEAM_COLUMNS),
            db.from('team_members').select('team_id, user_id'),
            db.from('team_skills').select('team_id, skill_id')
        ]);
        if (teamsData) {
            const members = teamMembersData || [];
            const tSkills = teamSkillsData || [];
            const transformedTeams = teamsData.map((t) => {
                const teamMembers = members.filter((m) => m.team_id === t.id).map((m) => m.user_id);
                const tSkillIds = tSkills.filter((ts) => ts.team_id === t.id).map((ts) => ts.skill_id);
                return {
                    id: t.id,
                    name: t.name,
                    description: t.description,
                    color: t.color,
                    memberIds: teamMembers,
                    skillIds: tSkillIds,
                    isHomeTeam: !!t.is_home_team
                };
            }) as unknown as Team[];
            setTeams(transformedTeams);
        }
    };

    const refreshSkills = async () => {
        const [{ data: skillsData }, { data: teamSkillsData }] = await Promise.all([
            db.from('skills').select('id, name, category'),
            db.from('team_skills').select('team_id, skill_id')
        ]);
        if (skillsData) {
            const transformedSkills = skillsData.map((s) => ({
                id: s.id,
                name: s.name,
                category: s.category || 'General',
                teamIds: (teamSkillsData || []).filter((ts) => ts.skill_id === s.id).map((ts) => ts.team_id)
            }));
            setSkills(transformedSkills);
        }
    };

    const refreshTags = async () => {
        const { data: tagsData } = await db.from('tags').select('id, name, color');
        if (tagsData) {
            setAllTags(tagsData);
        }
    };

    const refreshRegions = async () => {
        const { data: regionsData } = await db.from('regions').select('id, name, code, flag');
        if (regionsData) {
            setRegions(regionsData.map(r => ({ ...r, flag: r.flag || undefined })));
        }
    };

    const refreshClients = async () => {
        const { data: clientsData } = await db.from('clients').select('id, name, department, website, favicon');
        if (clientsData) {
            setClients(clientsData.map(c => ({ ...c, department: c.department || undefined, website: c.website || undefined, favicon: c.favicon || undefined })));
        }
    };

    const refreshAssignments = async () => {
        const { data } = await db.from('assignments').select(ASSIGNMENT_COLUMNS);
        if (data) setAssignments(data.map(toAssignment));
    };

    const refreshNotifications = async () => {
        if (!session?.user?.id) return;
        const { data } = await supabase
            .from('notifications')
            .select(NOTIFICATION_COLUMNS)
            .eq('user_id', session.user.id)
            .order('created_at', { ascending: false })
            .limit(50);
        if (data) setNotifications(data.map(toNotification));
    };

    // Keyed on the session, not on mount.
    //
    // Every table here is behind RLS now, so a request made before the session has been
    // restored from storage comes back empty rather than with the org's data -- and this used
    // to fire exactly once, which would have left a signed-in person looking at a blank
    // dashboard until they reloaded. It also stops the login screen and the public request
    // form from asking for data they are not entitled to.
    useEffect(() => {
        if (!session) {
            // Nothing to show, and nothing left over from whoever was signed in before.
            setUsers([]);
            setTeams([]);
            setSkills([]);
            setClients([]);
            setTasks([]);
            setComments([]);
            setAllTags([]);
            setRegions([]);
            // Notifications are addressed to one person and assignments say what they were
            // asked to do, so these are the last two that may survive a sign-out.
            setWorkCategories([]);
            setAssignments([]);
            setNotifications([]);
            setLeaves([]);
            setTaskLimit(TASK_PAGE_SIZE);
            setHasMoreTasks(false);
            setLoading(false);
            return;
        }
        fetchData();
    }, [session?.user?.id]);

    return (
        <DataContext.Provider value={{
            users, teams, skills, workCategories, clients, tasks, 
            leaves, assignments, notifications, comments, allTags, regions, loading, loadIssues, retryDataLoad: fetchData, hasMoreTasks, loadingMoreTasks, loadMoreTasks, refreshTasks, refreshTeams, refreshTags, refreshRegions, refreshClients, refreshSkills, refreshUsers,
            refreshAssignments, refreshNotifications
        }}>
            {children}
        </DataContext.Provider>
    );
}

export function useData() {
    const context = useContext(DataContext);
    if (context === undefined) {
        throw new Error('useData must be used within a DataProvider');
    }
    return context;
}
