import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from './AuthContext';
import { User, Team, Skill, WorkCategory, Client, Task, Comment, Leave, Assignment, Notification, UserSkill, Tag, Region } from '../types/types';

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
const toAssignment = (a: any): Assignment => ({
    id: a.id,
    taskId: a.task_id,
    userId: a.user_id,
    status: a.status,
    assignedDate: a.assigned_date,
    assignedById: a.assigned_by_id || undefined,
    responseDate: a.response_date || undefined,
    proposedStartDate: a.proposed_start_date || undefined,
    proposedEndDate: a.proposed_end_date || undefined,
    estimatedHours: a.estimated_hours ?? undefined,
    rejectionReason: a.rejection_reason || undefined
});

const toNotification = (n: any): Notification => ({
    id: n.id,
    userId: n.user_id,
    type: n.type,
    title: n.title,
    message: n.message,
    createdDate: n.created_at,
    isRead: n.is_read === true,
    link: n.link || undefined
});

const toWorkCategory = (c: any): WorkCategory => ({
    id: c.id,
    name: c.name,
    defaultHours: c.default_hours ?? 0,
    icon: c.icon || undefined,
    isActive: c.is_active !== false,
    teamIds: [],
    skillIds: []
});

const ASSIGNMENT_COLUMNS =
    'id, task_id, user_id, status, assigned_date, assigned_by_id, response_date, ' +
    'proposed_start_date, proposed_end_date, estimated_hours, rejection_reason';

const NOTIFICATION_COLUMNS = 'id, user_id, type, title, message, created_at, is_read, link';

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

    const fetchData = async () => {
        setLoading(true);
        try {
            const [
                { data: usersData },
                { data: teamsData },
                { data: teamMembersData },
                { data: clientsData },
                { data: tasksData },
                { data: taskTeamsData },
                { data: commentsData },
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
            ] = await Promise.all([
                supabase.from('users').select('*'),
                supabase.from('teams').select('*'),
                supabase.from('team_members').select('*'),
                supabase.from('clients').select('*'),
                supabase.from('tasks').select('*, task_tags(tags(*)), region:regions(*)'),
                // Which team a task belongs to. Task.teamIds has always been on the type and
                // read by the dashboard, workload filters and the review queue, and this is
                // the table behind it -- it was simply never loaded, so every task arrived
                // with the field missing and those screens counted nothing.
                supabase.from('task_teams').select('task_id, team_id'),
                supabase.from('comments').select('*'),
                supabase.from('tags').select('*'),
                supabase.from('regions').select('*'),
                supabase.from('skills').select('id, name, category'),
                supabase.from('team_skills').select('*'),
                supabase.from('user_skills').select('*'),
                supabase.from('user_clients').select('*'),
                supabase.from('user_regions').select('*'),
                // The categories every task carries a category_id for. The table has always
                // been here and the type has always been on the context; the query was
                // missing, so workCategories arrived empty and every screen that names a
                // task's category showed a blank.
                supabase.from('work_categories').select('id, name, default_hours, icon, is_active'),
                // Whose offer is outstanding, and what was agreed when one was accepted. RLS
                // narrows this to the caller's own rows unless they place work.
                supabase.from('assignments').select(ASSIGNMENT_COLUMNS),
                // Addressed to this person by RLS as well; the filter is what keeps the reply
                // small rather than what keeps it private.
                supabase.from('notifications')
                    .select(NOTIFICATION_COLUMNS)
                    .eq('user_id', session!.user.id)
                    .order('created_at', { ascending: false })
                    .limit(50)
            ]);

            if (usersData) {
                const members = teamMembersData || [];
                const uSkills = userSkillsData || [];
                const uClients = userClientsData || [];
                const uRegions = userRegionsData || [];
                const transformedUsers = usersData.map((u: any) => {
                    const userTeams = Array.from(new Set(members.filter((m: any) => m.user_id === u.id).map((m: any) => m.team_id)));
                    return {
                        id: u.id,
                        name: u.name,
                        email: u.email,
                        role: u.role,
                        skillIds: uSkills.filter((us: any) => us.user_id === u.id).map((us: any) => us.skill_id),
                        clientIds: uClients.filter((uc: any) => uc.user_id === u.id).map((uc: any) => uc.client_id),
                        regionIds: uRegions.filter((ur: any) => ur.user_id === u.id).map((ur: any) => ur.region_id),
                        teamIds: userTeams,
                        dailyCapacity: 8,
                        avatar: u.avatar,
                        isActive: u.is_active !== false,
                        onboardingCompleted: u.onboarding_completed === true,
                        deletedAt: u.deleted_at || null
                    };
                }) as unknown as User[];
                setUsers(transformedUsers);
            }
            if (teamsData) {
                const members = teamMembersData || [];
                const tSkills = teamSkillsData || [];
                const transformedTeams = teamsData.map((t: any) => {
                    const teamMembers = members.filter((m: any) => m.team_id === t.id).map((m: any) => m.user_id);
                    const tSkillIds = tSkills.filter((ts: any) => ts.team_id === t.id).map((ts: any) => ts.skill_id);
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
            if (skillsData) {
                const transformedSkills = skillsData.map((s: any) => ({
                    id: s.id,
                    name: s.name,
                    category: s.category || 'General',
                    teamIds: teamSkillsData?.filter((ts: any) => ts.skill_id === s.id).map((ts: any) => ts.team_id) || []
                }));
                setSkills(transformedSkills);
            }
            if (clientsData) setClients(clientsData);
            if (tasksData) {
                const taskTeams = taskTeamsData || [];
                const transformedTasks = tasksData.map((t: any) => ({
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
                    dueDate: t.due_date,
                    proposedStartDate: t.proposed_start_date,
                    proposedEndDate: t.proposed_end_date,
                    estimatedHours: t.estimated_hours,
                    tags: (t.task_tags || []).map((tt: any) => tt.tags).filter(Boolean),
                    teamIds: taskTeams.filter((tt: any) => tt.task_id === t.id).map((tt: any) => tt.team_id),
                    isSubtask: t.is_subtask,
                    createdDate: t.created_at,
                    subtaskIds: t.subtask_ids || [],
                    dependencyIds: t.dependency_ids || [],
                    linkedTaskIds: t.linked_task_ids || [],
                    checklist: t.checklist || []
                })) as unknown as Task[];
                setTasks(transformedTasks);
            }
            if (tagsData) {
                setAllTags(tagsData);
            }
            if (regionsData) {
                setRegions(regionsData);
            }
            if (commentsData) {
                const transformedComments = commentsData.map((c: any) => ({
                    id: c.id,
                    taskId: c.task_id,
                    userId: c.user_id,
                    text: c.text,
                    content: c.text,
                    timestamp: c.created_at,
                    createdDate: c.created_at,
                    isInternal: false
                })) as unknown as Comment[];
                setComments(transformedComments);
            }
            if (workCategoriesData) setWorkCategories(workCategoriesData.map(toWorkCategory));
            if (assignmentsData) setAssignments(assignmentsData.map(toAssignment));
            if (notificationsData) setNotifications(notificationsData.map(toNotification));
        } catch (error) {
            console.error('Error fetching data from Supabase:', error);
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
            supabase.from('users').select('*'),
            supabase.from('team_members').select('*'),
            supabase.from('user_skills').select('*'),
            supabase.from('user_clients').select('*'),
            supabase.from('user_regions').select('*')
        ]);
        if (usersData) {
            const members = teamMembersData || [];
            const uSkills = userSkillsData || [];
            const uClients = userClientsData || [];
            const uRegions = userRegionsData || [];
            const transformedUsers = usersData.map((u: any) => {
                const userTeams = Array.from(new Set(members.filter((m: any) => m.user_id === u.id).map((m: any) => m.team_id)));
                return {
                    id: u.id,
                    name: u.name,
                    email: u.email,
                    role: u.role,
                    avatar: u.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${u.name}&backgroundColor=3b82f6`,
                    teamIds: userTeams,
                    skillIds: uSkills.filter((us: any) => us.user_id === u.id).map((us: any) => us.skill_id),
                    clientIds: uClients.filter((uc: any) => uc.user_id === u.id).map((uc: any) => uc.client_id),
                    regionIds: uRegions.filter((ur: any) => ur.user_id === u.id).map((ur: any) => ur.region_id),
                    dailyCapacity: 8,
                    isActive: u.is_active !== false,
                    onboardingCompleted: u.onboarding_completed === true,
                    deletedAt: u.deleted_at || null
                };
            }) as unknown as User[];
            setUsers(transformedUsers);
        }
    };

    const refreshTasks = async () => {
        const [{ data: tasksData }, { data: taskTeamsData }] = await Promise.all([
            supabase.from('tasks').select('*, task_tags(tags(*)), region:regions(*)'),
            supabase.from('task_teams').select('task_id, team_id')
        ]);
        if (tasksData) {
            const taskTeams = taskTeamsData || [];
            const transformedTasks = tasksData.map((t: any) => ({
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
                dueDate: t.due_date,
                proposedStartDate: t.proposed_start_date,
                proposedEndDate: t.proposed_end_date,
                estimatedHours: t.estimated_hours,
                tags: (t.task_tags || []).map((tt: any) => tt.tags).filter(Boolean),
                teamIds: taskTeams.filter((tt: any) => tt.task_id === t.id).map((tt: any) => tt.team_id),
                isSubtask: t.is_subtask,
                createdDate: t.created_at,
                subtaskIds: t.subtask_ids || [],
                dependencyIds: t.dependency_ids || [],
                linkedTaskIds: t.linked_task_ids || [],
                checklist: t.checklist || []
            })) as unknown as Task[];
            setTasks(transformedTasks);
        }
    };

    const refreshTeams = async () => {
        const [
            { data: teamsData },
            { data: teamMembersData },
            { data: teamSkillsData }
        ] = await Promise.all([
            supabase.from('teams').select('*'),
            supabase.from('team_members').select('*'),
            supabase.from('team_skills').select('*')
        ]);
        if (teamsData) {
            const members = teamMembersData || [];
            const tSkills = teamSkillsData || [];
            const transformedTeams = teamsData.map((t: any) => {
                const teamMembers = members.filter((m: any) => m.team_id === t.id).map((m: any) => m.user_id);
                const tSkillIds = tSkills.filter((ts: any) => ts.team_id === t.id).map((ts: any) => ts.skill_id);
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
            supabase.from('skills').select('id, name, category'),
            supabase.from('team_skills').select('*')
        ]);
        if (skillsData) {
            const transformedSkills = skillsData.map((s: any) => ({
                id: s.id,
                name: s.name,
                category: s.category || 'General',
                teamIds: (teamSkillsData || []).filter((ts: any) => ts.skill_id === s.id).map((ts: any) => ts.team_id)
            }));
            setSkills(transformedSkills);
        }
    };

    const refreshTags = async () => {
        const { data: tagsData } = await supabase.from('tags').select('*');
        if (tagsData) {
            setAllTags(tagsData);
        }
    };

    const refreshRegions = async () => {
        const { data: regionsData } = await supabase.from('regions').select('*');
        if (regionsData) {
            setRegions(regionsData);
        }
    };

    const refreshClients = async () => {
        const { data: clientsData } = await supabase.from('clients').select('*');
        if (clientsData) {
            setClients(clientsData);
        }
    };

    const refreshAssignments = async () => {
        const { data } = await supabase.from('assignments').select(ASSIGNMENT_COLUMNS);
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
            setLoading(false);
            return;
        }
        fetchData();
    }, [session?.user?.id]);

    return (
        <DataContext.Provider value={{
            users, teams, skills, workCategories, clients, tasks, 
            leaves, assignments, notifications, comments, allTags, regions, loading, refreshTasks, refreshTeams, refreshTags, refreshRegions, refreshClients, refreshSkills, refreshUsers,
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
