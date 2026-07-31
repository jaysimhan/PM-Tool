import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { User, Team, Skill, WorkCategory, Client, Task, Comment, Leave, Assignment, Notification, UserSkill, Tag } from '../types/types';

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
    loading: boolean;
    refreshTasks: () => Promise<void>;
    refreshTeams: () => Promise<void>;
    refreshTags: () => Promise<void>;
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
                { data: tagsData }
            ] = await Promise.all([
                supabase.from('users').select('*'),
                supabase.from('teams').select('*'),
                supabase.from('team_members').select('*'),
                supabase.from('clients').select('*'),
                supabase.from('tasks').select('*, task_tags(tags(*))'),
                supabase.from('comments').select('*'),
                supabase.from('tags').select('*')
            ]);

            if (usersData) {
                const transformedUsers = usersData.map((u: any) => ({
                    id: u.id,
                    name: u.name,
                    email: u.email,
                    role: u.role,
                    skillIds: u.skills || [],
                    teamIds: [],
                    dailyCapacity: 8,
                    avatar: u.avatar,
                    isActive: true
                })) as unknown as User[];
                setUsers(transformedUsers);
            }
            if (teamsData) {
                const members = teamMembersData || [];
                const transformedTeams = teamsData.map((t: any) => {
                    const teamMembers = members.filter((m: any) => m.team_id === t.id).map((m: any) => m.user_id);
                    return {
                        id: t.id,
                        name: t.name,
                        description: t.description,
                        leaderId: t.leader_id,
                        color: t.color,
                        memberIds: teamMembers,
                        skillIds: []
                    };
                }) as unknown as Team[];
                setTeams(transformedTeams);
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
                    parentTaskId: t.parent_task_id,
                    dueDate: t.due_date,
                    proposedStartDate: t.proposed_start_date,
                    proposedEndDate: t.proposed_end_date,
                    estimatedHours: t.estimated_hours,
                    tags: (t.task_tags || []).map((tt: any) => tt.tags).filter(Boolean),
                    isSubtask: t.is_subtask,
                    createdDate: t.created_at,
                    subtaskIds: [],
                    dependencyIds: [],
                    linkedTaskIds: []
                })) as unknown as Task[];
                setTasks(transformedTasks);
            }
            if (tagsData) {
                setAllTags(tagsData);
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

    const refreshTasks = async () => {
        const { data: tasksData } = await supabase.from('tasks').select('*, task_tags(tags(*))');
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
                parentTaskId: t.parent_task_id,
                dueDate: t.due_date,
                proposedStartDate: t.proposed_start_date,
                proposedEndDate: t.proposed_end_date,
                estimatedHours: t.estimated_hours,
                tags: (t.task_tags || []).map((tt: any) => tt.tags).filter(Boolean),
                isSubtask: t.is_subtask,
                createdDate: t.created_at,
                subtaskIds: [],
                dependencyIds: [],
                linkedTaskIds: []
            })) as unknown as Task[];
            setTasks(transformedTasks);
        }
    };

    const refreshTeams = async () => {
        const [
            { data: teamsData },
            { data: teamMembersData }
        ] = await Promise.all([
            supabase.from('teams').select('*'),
            supabase.from('team_members').select('*')
        ]);
        if (teamsData) {
            const members = teamMembersData || [];
            const transformedTeams = teamsData.map((t: any) => {
                const teamMembers = members.filter((m: any) => m.team_id === t.id).map((m: any) => m.user_id);
                return {
                    id: t.id,
                    name: t.name,
                    description: t.description,
                    leaderId: t.leader_id,
                    color: t.color,
                    memberIds: teamMembers,
                    skillIds: []
                };
            }) as unknown as Team[];
            setTeams(transformedTeams);
        }
    };

    const refreshTags = async () => {
        const { data: tagsData } = await supabase.from('tags').select('*');
        if (tagsData) {
            setAllTags(tagsData);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    return (
        <DataContext.Provider value={{
            users, teams, skills, workCategories, clients, tasks, 
            leaves, assignments, notifications, comments, allTags, loading, refreshTasks, refreshTeams, refreshTags
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
