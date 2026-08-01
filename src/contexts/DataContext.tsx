import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { User, Team, Skill, WorkCategory, Client, Task, Comment, Leave, Assignment, Notification, UserSkill, Tag, Region } from '../types/types';

interface DataContextType {
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
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export function DataProvider({ children }: { children: React.ReactNode }) {
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
                { data: commentsData },
                { data: tagsData },
                { data: regionsData },
                { data: skillsData },
                { data: teamSkillsData }
            ] = await Promise.all([
                supabase.from('users').select('*'),
                supabase.from('teams').select('*'),
                supabase.from('team_members').select('*'),
                supabase.from('clients').select('*'),
                supabase.from('tasks').select('*, task_tags(tags(*)), region:regions(*)'),
                supabase.from('comments').select('*'),
                supabase.from('tags').select('*'),
                supabase.from('regions').select('*'),
                supabase.from('skills').select('*'),
                supabase.from('team_skills').select('*')
            ]);

            if (usersData) {
                const members = teamMembersData || [];
                const teams = teamsData || [];
                const transformedUsers = usersData.map((u: any) => {
                    const memberTeams = members.filter((m: any) => m.user_id === u.id).map((m: any) => m.team_id);
                    const ledTeams = teams.filter((t: any) => t.leader_id === u.id).map((t: any) => t.id);
                    const userTeams = Array.from(new Set([...memberTeams, ...ledTeams]));
                    return {
                        id: u.id,
                        name: u.name,
                        email: u.email,
                        role: u.role,
                        skillIds: u.skills || [],
                        teamIds: userTeams,
                        dailyCapacity: 8,
                        avatar: u.avatar,
                        isActive: true
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
                        leaderId: t.leader_id,
                        color: t.color,
                        memberIds: teamMembers,
                        skillIds: tSkillIds
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
                const transformedTasks = tasksData.map((t: any) => ({
                    id: t.id,
                    title: t.title,
                    description: t.description,
                    status: t.status,
                    priority: t.priority,
                    assignedToId: t.assignee_id,
                    requesterId: t.requester_id,
                    clientId: t.client_id,
                    regionId: t.region_id,
                    region: t.region || undefined,
                    parentTaskId: t.parent_task_id,
                    dueDate: t.due_date,
                    proposedStartDate: t.proposed_start_date,
                    proposedEndDate: t.proposed_end_date,
                    estimatedHours: t.estimated_hours,
                    tags: (t.task_tags || []).map((tt: any) => tt.tags).filter(Boolean),
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
            { data: teamsData }
        ] = await Promise.all([
            supabase.from('users').select('*'),
            supabase.from('team_members').select('*'),
            supabase.from('teams').select('*')
        ]);
        if (usersData) {
            const members = teamMembersData || [];
            const teams = teamsData || [];
            const transformedUsers = usersData.map((u: any) => {
                const memberTeams = members.filter((m: any) => m.user_id === u.id).map((m: any) => m.team_id);
                const ledTeams = teams.filter((t: any) => t.leader_id === u.id).map((t: any) => t.id);
                const userTeams = Array.from(new Set([...memberTeams, ...ledTeams]));
                
                return {
                    id: u.id,
                    name: u.name,
                    email: u.email,
                    role: u.role,
                    avatar: u.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${u.name}&backgroundColor=3b82f6`,
                    teamIds: userTeams,
                    skillIds: [], // We'd need user_skills table for this, using empty for now
                    dailyCapacity: 8
                };
            }) as unknown as User[];
            setUsers(transformedUsers);
        }
    };

    const refreshTasks = async () => {
        const { data: tasksData } = await supabase.from('tasks').select('*, task_tags(tags(*)), region:regions(*)');
        if (tasksData) {
            const transformedTasks = tasksData.map((t: any) => ({
                id: t.id,
                title: t.title,
                description: t.description,
                status: t.status,
                priority: t.priority,
                assignedToId: t.assignee_id,
                requesterId: t.requester_id,
                clientId: t.client_id,
                regionId: t.region_id,
                region: t.region || undefined,
                parentTaskId: t.parent_task_id,
                dueDate: t.due_date,
                proposedStartDate: t.proposed_start_date,
                proposedEndDate: t.proposed_end_date,
                estimatedHours: t.estimated_hours,
                tags: (t.task_tags || []).map((tt: any) => tt.tags).filter(Boolean),
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
                    leaderId: t.leader_id,
                    color: t.color,
                    memberIds: teamMembers,
                    skillIds: tSkillIds
                };
            }) as unknown as Team[];
            setTeams(transformedTeams);
        }
    };

    const refreshSkills = async () => {
        const { data: skillsData } = await supabase.from('skills').select('*');
        if (skillsData) {
            const transformedSkills = skillsData.map((s: any) => ({
                id: s.id,
                name: s.name,
                category: s.category || 'General',
                teamIds: []
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

    useEffect(() => {
        fetchData();
    }, []);

    return (
        <DataContext.Provider value={{
            users, teams, skills, workCategories, clients, tasks, 
            leaves, assignments, notifications, comments, allTags, regions, loading, refreshTasks, refreshTeams, refreshTags, refreshRegions, refreshClients, refreshSkills, refreshUsers
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
