import React, { useState, useEffect, useRef } from 'react';
import { Task, User, Comment, Team, Priority, Tag as TagType } from '../types/types';
import { supabase } from '../lib/supabaseClient';
import { useData } from '../contexts/DataContext';
import { clients, workCategories, teams, tasks as allTasks, mockComments } from '../data/mockData';
import {
    X, Calendar, User as UserIcon, Paperclip,
    CheckCircle, Link as LinkIcon, Plus, Clock,
    ChevronDown, Search, AlertCircle, ExternalLink,
    MessageSquare, AtSign, Hash, Send, Maximize2, Minimize2, Flag, Ban, Check, MoreHorizontal, Tag, Settings, CornerDownLeft, Trash2, Workflow, GitBranch, ListChecks, SlidersHorizontal, GripVertical, ChevronRight, UserPlus, EyeOff, Circle, Copy
} from 'lucide-react';
import { getRandomColor, getDiverseColors, getTagStyle } from '../utils/colors';
import { useConfirm } from '../contexts/ConfirmContext';
import { formatCustomValue, useRequestFormConfig } from '../lib/requestFormConfig';

const TAG_COLORS = [
    { name: 'default', class: 'bg-gray-100 text-gray-700' },
    { name: 'gray', class: 'bg-gray-200 text-gray-700' },
    { name: 'purple', class: 'bg-purple-200 text-purple-800' },
    { name: 'blue', class: 'bg-blue-200 text-blue-800' },
    { name: 'sky', class: 'bg-sky-200 text-sky-800' },
    { name: 'green', class: 'bg-green-200 text-green-800' },
    { name: 'yellow', class: 'bg-yellow-200 text-yellow-800' },
    { name: 'orange', class: 'bg-orange-200 text-orange-800' },
    { name: 'red', class: 'bg-red-200 text-red-800' },
    { name: 'pink', class: 'bg-pink-200 text-pink-800' },
    { name: 'darkRed', class: 'bg-red-900 text-white' },
    { name: 'brown', class: 'bg-stone-300 text-stone-800' }
];


import { getPriorityColor, getStatusBadgeColor, formatStatusLabel, getStatusDotColor } from '../utils/capacityCalculations';
import { DateRangePicker } from './DateRangePicker';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { SubtaskIcon } from './icons/SubtaskIcon';
import { AddChecklistIcon } from './icons/AddChecklistIcon';

interface Props {
    task: Task | null;
    isOpen: boolean;
    onClose: () => void;
    currentUser: User;
    onStatusChange?: (taskId: string, newStatus: string) => void;
    isSubPanel?: boolean; // suppresses its own backdrop
    parentTitle?: string;
    depth?: number;
    onNestedDepthChange?: (depth: number) => void;
    activeDepth?: number;
    onActiveDepthChange?: (depth: number) => void;
}

const ALL_STATUSES = [
    { value: 'new_request', label: 'new request' },
    { value: 'planning', label: 'Planning' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'in_review', label: 'In Review' },
    { value: 'on_hold', label: 'On Hold' },
    { value: 'completed', label: 'Completed' },
];

/**
 * Somebody who is deactivated or deleted still owns everything they did -- their comments and
 * their finished tasks keep their name on them. They are shown greyed out so the history
 * stays readable without suggesting they are still around to pick anything up.
 */
const isDormant = (user?: User | null) => !!user && (user.isActive === false || !!user.deletedAt);

// A task being composed carries a temporary id until it is saved, so anything that talks to
// the database has to know the difference.
const SAVED_TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const dormantLabel = (user?: User | null) =>
    user?.deletedAt ? 'deleted' : user && user.isActive === false ? 'deactivated' : null;

function Avatar({ user, size = 'sm' }: { user?: User | null; size?: 'xs' | 'sm' | 'md' }) {
    const sizeClasses = { xs: 'w-6 h-6 text-[10px]', sm: 'w-8 h-8 text-xs', md: 'w-9 h-9 text-sm' };
    const dormant = isDormant(user);

    if (!user) {
        return (
            <div
                className={`${sizeClasses[size]} rounded-full flex items-center justify-center text-white font-medium flex-shrink-0`}
                style={{ backgroundColor: '#9CA3AF' }}
            >
                ?
            </div>
        );
    }

    const initials = user.name.split(' ').map((n: string) => n[0]).join('').toUpperCase();
    const userTeam = user.teamIds?.[0]
        ? teams.find(t => t.id === user.teamIds[0])
        : teams.find(t => t.memberIds.includes(user.id));
    const bgColor = userTeam?.color || '#6B7280';

    if (user.avatar) {
        return (
            <img
                src={user.avatar}
                alt={user.name}
                className={`${sizeClasses[size]} rounded-full object-cover flex-shrink-0 ${dormant ? 'grayscale opacity-60' : ''}`}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
        );
    }

    return (
        <div
            className={`${sizeClasses[size]} rounded-full flex items-center justify-center text-white font-medium flex-shrink-0 ${dormant ? 'opacity-60' : ''}`}
            style={{ backgroundColor: dormant ? '#9CA3AF' : bgColor }}
        >
            {initials}
        </div>
    );
}

function SectionLabel({ children, icon }: { children: React.ReactNode, icon?: React.ReactNode }) {
    return <div className="text-[15px] font-semibold text-gray-900 mb-3 flex items-center gap-2">{icon && <span className="text-gray-400">{icon}</span>}{children}</div>;
}

function FieldRow({ label, icon, children }: { label: React.ReactNode; icon?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="flex items-start gap-3 px-4 py-2.5 border-b border-gray-100 last:border-0">
            <div className="w-28 text-sm text-gray-500 flex-shrink-0 pt-0.5 flex items-center gap-1.5">{icon && <span className="text-gray-400">{icon}</span>}{label}</div>
            <div className="flex-1 min-w-0">{children}</div>
        </div>
    );
}

export default function TaskDetailsPanel({ task, isOpen, onClose, currentUser, onStatusChange, isSubPanel = false, parentTitle = "", depth = 0, onNestedDepthChange, activeDepth, onActiveDepthChange }: Props) {
    const { confirm } = useConfirm();
    // Only needed to turn a stored field_key back into the label the requester saw.
    const { fields: requestFormFields } = useRequestFormConfig();
    const isTeamLeaderOfTask = currentUser.role === 'team_leader' && teams.some(t => task?.teamIds.includes(t.id) && t.memberIds.includes(currentUser.id));
    const canDeleteTask = currentUser.role === 'super_admin' || currentUser.role === 'admin' || isTeamLeaderOfTask || task?.requesterId === currentUser.id;

    const [localStatus, setLocalStatus] = useState(task?.status || '');
    const [title, setTitle] = useState(task?.title || '');
    const [description, setDescription] = useState(task?.description || '');
    const [isEditingDescription, setIsEditingDescription] = useState(false);
    const [comments, setComments] = useState<Comment[]>([]);
    const [newComment, setNewComment] = useState('');
    const [mentionState, setMentionState] = useState<{ type: '@' | '#', query: string } | null>(null);
    const [localCollaborators, setLocalCollaborators] = useState<User[]>([]);
    const [activeTab, setActiveTab] = useState<'activity' | 'comments'>('activity');
    const [depSearch, setDepSearch] = useState('');
    const [showDepPopover, setShowDepPopover] = useState(false);
    const [addingDepType, setAddingDepType] = useState<'blockedBy' | 'blocks' | 'linked' | null>(null);
    const [localBlockedBy, setLocalBlockedBy] = useState<string[]>([]);
    const [localBlocks, setLocalBlocks] = useState<string[]>([]);
    const [localLinked, setLocalLinked] = useState<string[]>([]);
    const [localPriority, setLocalPriority] = useState<Priority | undefined>(task?.priority);
    const [localAssignedToId, setLocalAssignedToId] = useState<string | undefined>(task?.assignedToId);
    const [showAssigneePicker, setShowAssigneePicker] = useState(false);
    const assigneePickerRef = useRef<HTMLDivElement>(null);
    const [showPriorityDropdown, setShowPriorityDropdown] = useState(false);
    const [showStatusDropdown, setShowStatusDropdown] = useState(false);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [showCollabPicker, setShowCollabPicker] = useState(false);
    const [collabSearch, setCollabSearch] = useState('');
    const [showDatePicker, setShowDatePicker] = useState(false);
    const datePickerRef = useRef<HTMLDivElement>(null);
    const [localStartDate, setLocalStartDate] = useState('');
    const [localDueDate, setLocalDueDate] = useState('');
    const [stackedSubtask, setStackedSubtask] = useState<Task | null>(null);
    const [activeSubtasksCount, setActiveSubtasksCount] = useState(0);
    const [localChecklist, setLocalChecklist] = useState<{ id: string, text: string, completed: boolean, assigneeId?: string }[]>([]);
    const [newChecklistItem, setNewChecklistItem] = useState('');
    const [newChecklistAssigneeId, setNewChecklistAssigneeId] = useState<string | undefined>();
    const [showChecklistInput, setShowChecklistInput] = useState(false);
    const [checklistTitle, setChecklistTitle] = useState('Checklist');
    const [isEditingChecklistTitle, setIsEditingChecklistTitle] = useState(false);
    const [hideCompletedChecklistItems, setHideCompletedChecklistItems] = useState(false);
    const [localSubtaskIds, setLocalSubtaskIds] = useState<string[]>(task?.subtaskIds || []);
    const [openSubtaskDatePickerId, setOpenSubtaskDatePickerId] = useState<string | null>(null);
    const [subtasksTitle, setSubtasksTitle] = useState('Subtasks');
    const [isEditingSubtasksTitle, setIsEditingSubtasksTitle] = useState(false);
    const [showPriorityInput, setShowPriorityInput] = useState(false);
    const [localTags, setLocalTags] = useState<TagType[]>(task?.tags || []);
    // users comes from the live data context, not mockData: the assignee and collaborator
    // pickers were reading an array that is empty in every build, so they offered nobody.
    const { allTags, refreshTags, refreshTasks, regions, users } = useData();
    const [tagSearchQuery, setTagSearchQuery] = useState('');
    const [editingTag, setEditingTag] = useState<string | null>(null);
    const [editingTagName, setEditingTagName] = useState('');
    const [editingTagColor, setEditingTagColor] = useState('');
    const tagPopoverRef = useRef<HTMLDivElement>(null);
    const [subtaskContextMenu, setSubtaskContextMenu] = useState<{ sid: string, x: number, y: number } | null>(null);
    const dragSubtaskId = useRef<string | null>(null);
    const [draggingSubtaskId, setDraggingSubtaskId] = useState<string | null>(null);
    const [dragOverSubtaskId, setDragOverSubtaskId] = useState<string | null>(null);

    const editingTagRef = useRef(editingTag);
    const editingTagNameRef = useRef(editingTagName);
    const editingTagColorRef = useRef(editingTagColor);
    const localTagsRef = useRef(localTags);

    useEffect(() => { editingTagRef.current = editingTag; }, [editingTag]);
    useEffect(() => { editingTagNameRef.current = editingTagName; }, [editingTagName]);
    useEffect(() => { editingTagColorRef.current = editingTagColor; }, [editingTagColor]);
    useEffect(() => { localTagsRef.current = localTags; }, [localTags]);

    const [showTagInput, setShowTagInput] = useState(false);
    const [newTag, setNewTag] = useState('');
    const [showMoreMenu, setShowMoreMenu] = useState(false);

    const commentsEndRef = useRef<HTMLDivElement>(null);
    const depPopoverRef = useRef<HTMLDivElement>(null);
    const statusRef = useRef<HTMLDivElement>(null);
    const priorityRef = useRef<HTMLDivElement>(null);
    const collabPickerRef = useRef<HTMLDivElement>(null);
    const moreMenuRef = useRef<HTMLDivElement>(null);

    const [localActiveDepth, setLocalActiveDepth] = useState(0);
    const currentActiveDepth = activeDepth !== undefined ? activeDepth : localActiveDepth;

    const handleActiveDepthChange = (newDepth: number) => {
        if (onActiveDepthChange) {
            onActiveDepthChange(newDepth);
        } else {
            setLocalActiveDepth(newDepth);
        }
    };

    const closeStackedSubtask = () => {
        setStackedSubtask(null);
        setActiveSubtasksCount(0);
        onNestedDepthChange?.(0);
        handleActiveDepthChange(depth);
    };

    const handleSubtaskDepthChange = (childDepth: number) => {
        setActiveSubtasksCount(childDepth + 1);
        onNestedDepthChange?.(childDepth + 1);
    };

    useEffect(() => {
        if (task) {
            setLocalStatus(task.status);
            setLocalPriority(task.priority || 'normal');
            setLocalAssignedToId(task.assignedToId);
            setTitle(task.title);
            setDescription(task.description || '');
            setLocalBlockedBy(task.blockedByIds || []);
            setLocalBlocks(task.blocksIds || []);
            setLocalLinked(task.linkedTaskIds || task.dependencyIds || []);
            setComments(mockComments.filter(c => c.taskId === task.id));
            setLocalStartDate(task.proposedStartDate || '');
            setLocalDueDate(task.dueDate || task.proposedEndDate || '');
            // Build default collaborators: Admins, Assignee, and Team Leads
            const initialCollabs = users.filter(u => {
                if (u.role === 'super_admin' || u.role === 'admin') return true;
                if (u.id === task.assignedToId) return true;
                if (u.role === 'team_leader' && task.teamIds?.some(tid => {
                    const t = teams.find(team => team.id === tid);
                    return t?.memberIds.includes(u.id);
                })) {
                    return true;
                }
                return false;
            });
            setLocalCollaborators(initialCollabs);
            setLocalChecklist(task.checklist || []);
            setLocalTags(task.tags || []);
            setLocalSubtaskIds(task.subtaskIds || []);
            setStackedSubtask(null);
        }
    }, [task]);

    // Reset full-screen when panel closes
    useEffect(() => {
        if (!isOpen) setIsFullScreen(false);
    }, [isOpen]);

    // Close dropdowns on outside click
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (depPopoverRef.current && !depPopoverRef.current.contains(e.target as Node)) {
                setShowDepPopover(false);
                setAddingDepType(null);
            }
            if (statusRef.current && !statusRef.current.contains(e.target as Node)) setShowStatusDropdown(false);
            if (priorityRef.current && !priorityRef.current.contains(e.target as Node)) setShowPriorityDropdown(false);
            if (assigneePickerRef.current && !assigneePickerRef.current.contains(e.target as Node)) setShowAssigneePicker(false);
            if (collabPickerRef.current && !collabPickerRef.current.contains(e.target as Node)) setShowCollabPicker(false);
            if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setShowMoreMenu(false);
            setSubtaskContextMenu(null);
            if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) setShowDatePicker(false);
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (tagPopoverRef.current && !tagPopoverRef.current.contains(e.target as Node)) {
                setEditingTag(null);
                setShowTagInput(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    // What the work needs, to decide who may be handed it. The task's own skills win where it
    // has them; otherwise the work category's stand in, which is where most tasks get theirs.
    const [requiredSkillIds, setRequiredSkillIds] = useState<string[]>([]);
    useEffect(() => {
        // A blank task being composed has no row yet, so there is nothing to look up and its
        // temporary id is not a uuid the query would accept.
        const isSaved = !!task && SAVED_TASK_ID.test(task.id);
        if (!task) {
            setRequiredSkillIds([]);
            return;
        }

        let cancelled = false;
        (async () => {
            let ids: string[] = [];
            if (isSaved) {
                const { data } = await supabase.from('task_skills').select('skill_id').eq('task_id', task.id);
                ids = (data || []).map((r: any) => r.skill_id);
            }
            if (ids.length === 0 && task.categoryId) {
                const { data } = await supabase.from('work_category_skills').select('skill_id').eq('category_id', task.categoryId);
                ids = (data || []).map((r: any) => r.skill_id);
            }
            if (!cancelled) setRequiredSkillIds(ids);
        })();
        return () => { cancelled = true; };
    }, [task?.id, task?.categoryId]);

    if (!task) return null;

    const assignedUser = localAssignedToId ? users.find(u => u.id === localAssignedToId) : null;
    const client = clients.find(c => c.id === task.clientId);
    const category = workCategories.find(c => c.id === task.categoryId);
    const requester = users.find(u => u.id === task.requesterId);
    const assignedByUser = task.assignedById ? users.find(u => u.id === task.assignedById) : null;

    const canManageCollaborators = true; // Anyone can add collaborators

    // Hours progress
    const estimated = task.estimatedHours || 0;
    const actual = task.actualHours || 0;
    const hoursPercent = estimated > 0 ? Math.min(100, (actual / estimated) * 100) : 0;
    const isOverBudget = actual > estimated;

    // Dependencies
    const totalDeps = localBlockedBy.length + localBlocks.length + localLinked.length;
    const allDepIds = new Set([...localBlockedBy, ...localBlocks, ...localLinked]);
    const filteredDepCandidates = allTasks.filter(t =>
        t.id !== task.id &&
        !allDepIds.has(t.id) &&
        t.title.toLowerCase().includes(depSearch.toLowerCase())
    ).slice(0, 8);

    // Collaborator picker candidates. Somebody deactivated or deleted can still be seen on
    // the work they did, but cannot be put on any more of it.
    const filteredCollabCandidates = users.filter(u =>
        !localCollaborators.some(c => c.id === u.id) &&
        !isDormant(u) &&
        u.name.toLowerCase().includes(collabSearch.toLowerCase())
    ).slice(0, 10);

    // Assigning by hand is the fallback for work the round robin could not place, so it is
    // deliberately wider than the round robin: skill is the only requirement. Brand, region
    // and team preferences steer automatic assignment and say nothing about who is allowed to
    // be given the task here. With no skill on record — or nobody holding it — the choice
    // stays open rather than leaving the picker empty and the task stuck.
    const assignableUsers = users.filter(u => !isDormant(u));
    const skilledUsers = requiredSkillIds.length > 0
        ? assignableUsers.filter(u => (u.skillIds || []).some(id => requiredSkillIds.includes(id)))
        : [];
    const assigneeCandidates = (skilledUsers.length > 0 ? skilledUsers : assignableUsers)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name));
    const assigneesAreSkillFiltered = skilledUsers.length > 0;

    const handleStatusChange = (s: string) => {
        setLocalStatus(s);
        setShowStatusDropdown(false);
        if (onStatusChange) onStatusChange(task.id, s);
    };

    // Picking someone used to change only this component's copy of the task, so the choice was
    // gone by the next refresh. Manual assignment is the answer to a task the round robin could
    // not place, and it has to survive; who did it and when are recorded with it.
    const handleAssign = async (userId?: string) => {
        setLocalAssignedToId(userId);
        task.assignedToId = userId;
        setShowAssigneePicker(false);
        if (!SAVED_TASK_ID.test(task.id)) return;

        const { error } = await supabase.from('tasks').update({
            assignee_id: userId ?? null,
            assigned_by_id: userId ? currentUser.id : null,
            assigned_date: userId ? new Date().toISOString() : null
        }).eq('id', task.id);

        if (error) {
            console.error('Could not save the assignee:', error);
            return;
        }
        refreshTasks();
    };

    const handleMarkComplete = () => {
        const next = localStatus === 'completed' ? 'in_progress' : 'completed';
        handleStatusChange(next);
    };

    const handleRemoveTag = (tagId: string) => {
        setLocalTags(prev => prev.filter(t => t.id !== tagId));
        if (task?.id && !task.id.startsWith('subtask-new')) {
            supabase.from('task_tags').delete().eq('task_id', task.id).eq('tag_id', tagId).then(() => {
                refreshTasks();
            });
        }
    };

    const processTagsInput = async (inputStr: string) => {
        if (!inputStr.trim()) return;
        const tagNames = inputStr.split(',').map(name => name.trim()).filter(Boolean).map(name => name.charAt(0).toUpperCase() + name.slice(1));
        const uniqueTagNames = Array.from(new Set(tagNames));
        
        const existingTags = allTags.filter(t => uniqueTagNames.some(ut => ut.toLowerCase() === t.name.toLowerCase()));
        const existingNamesLower = existingTags.map(t => t.name.toLowerCase());
        
        const tagsToCreate = uniqueTagNames.filter(name => !existingNamesLower.includes(name.toLowerCase()));
        const colorsToUse = getDiverseColors(tagsToCreate.length);
        
        let createdTags: TagType[] = [];
        
        if (tagsToCreate.length > 0) {
            const insertData = tagsToCreate.map((name, idx) => ({
                name,
                color: colorsToUse[idx]
            }));
            
            const { data, error } = await supabase.from('tags').insert(insertData).select();
            if (!error && data) {
                createdTags = data;
            }
        }
        
        const tagsToAssign = [...existingTags, ...createdTags].filter(t => !localTags.some(lt => lt.id === t.id));
        
        if (tagsToAssign.length > 0) {
            setLocalTags([...localTags, ...tagsToAssign]);
            if (task?.id && !task.id.startsWith('subtask-new')) {
                const taskTagsData = tagsToAssign.map(t => ({ task_id: task.id, tag_id: t.id }));
                await supabase.from('task_tags').insert(taskTagsData);
                await refreshTasks();
            }
            await refreshTags();
        }
        setTagSearchQuery('');
        setShowTagInput(false);
    };

    const updateChecklistInDB = async (newList: typeof localChecklist) => {
        setLocalChecklist(newList);
        if (task) {
            await supabase.from('tasks').update({ checklist: newList }).eq('id', task.id);
            refreshTasks();
        }
    };

    const updateSubtaskOrderInDB = async (newIds: string[]) => {
        setLocalSubtaskIds(newIds);
        if (task) {
            await supabase.from('tasks').update({ subtask_ids: newIds }).eq('id', task.id);
            refreshTasks();
        }
    };

    const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setNewComment(val);

        const cursor = e.target.selectionStart;
        const textBeforeCursor = val.slice(0, cursor);
        const match = textBeforeCursor.match(/(?:^|\s)([@#])([a-zA-Z0-9_]*)$/);

        if (match) {
            setMentionState({ type: match[1] as '@' | '#', query: match[2] });
        } else {
            setMentionState(null);
        }
    };

    const insertMention = (mentionText: string) => {
        if (!mentionState) return;
        // In a real app we'd use a ref to the textarea to get the exact cursor, 
        // but since we only have one cursor at the end usually, we'll replace the last match.
        // A simple robust way without refs:
        const match = newComment.match(new RegExp(`(?:^|\\s)([@#])${mentionState.query}$`));
        if (match && match[0]) {
            const replaceStart = newComment.lastIndexOf(match[0]);
            const prefix = newComment.slice(0, replaceStart);
            const newText = prefix + (prefix.length && !prefix.endsWith(' ') ? ' ' : '') + mentionText + ' ';
            setNewComment(newText);
        } else {
            // fallback if cursor moved
            setNewComment(newComment + ' ' + mentionText + ' ');
        }
        setMentionState(null);
    };

    const mentionSuggestions = mentionState
        ? mentionState.type === '@'
            ? users.filter(u => !isDormant(u) && u.name.toLowerCase().includes(mentionState.query.toLowerCase())).slice(0, 5)
            : teams.filter(t => t.name.toLowerCase().includes(mentionState.query.toLowerCase())).slice(0, 5)
        : [];

    const handleAddComment = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newComment.trim()) return;
        const comment: Comment = {
            id: `new-${Date.now()}`,
            taskId: task.id,
            userId: currentUser.id,
            content: newComment,
            createdDate: new Date().toISOString(),
            isInternal: false
        };
        setComments(prev => [...prev, comment]);
        setNewComment('');
        setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    };

    const handleAddSubtask = () => {
        const blank: Task = {
            id: `subtask-new-${Date.now()}`,
            requestId: '',
            title: '',
            description: '',
            categoryId: task.categoryId,
            clientId: task.clientId,
            requesterId: currentUser.id,
            priority: task.priority,
            status: 'new_request',
            estimatedHours: 0,
            dueDate: localDueDate,
            createdDate: new Date().toISOString(),
            teamIds: task.teamIds,
            requiredSkillIds: [],
            subtaskIds: [],
            dependencyIds: [],
            linkedTaskIds: [task.id],
            tags: [],
            isSubtask: true,
            parentTaskId: task.id,
        } as unknown as Task;
        allTasks.push(blank);
        if (task) {
            const newIds = [...(task.subtaskIds || []), blank.id];
            task.subtaskIds = newIds;
            setLocalSubtaskIds(newIds);
        }
        setStackedSubtask(blank);
        setActiveSubtasksCount(1);
        onNestedDepthChange?.(1);
        handleActiveDepthChange(depth + 1);
    };

    const addNewSubtask = () => {
        const blank = {
            id: `subtask-new-${Date.now()}`,
            requestId: '',
            title: '',
            description: '',
            categoryId: task.categoryId,
            clientId: task.clientId,
            requesterId: currentUser.id,
            priority: task.priority,
            status: 'new_request',
            estimatedHours: 0,
            dueDate: undefined,
            createdDate: new Date().toISOString(),
            teamIds: task.teamIds,
            requiredSkillIds: [],
            subtaskIds: [],
            dependencyIds: [],
            linkedTaskIds: [task.id],
            tags: [],
            isSubtask: true,
            parentTaskId: task.id,
            assignedToId: undefined
        } as unknown as Task;
        allTasks.push(blank);
        if (task) {
            const newIds = [...(task.subtaskIds || []), blank.id];
            task.subtaskIds = newIds;
            setLocalSubtaskIds(newIds);
        }
    };

    const renderTextWithMentions = (text: string, isInputOverlay = false) => {
        if (!text) return null;
        const combinedRegex = /((?:https?:\/\/[^\s]+)|(?:[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)|(?:@[a-zA-Z0-9_]+)|(?:#[a-zA-Z0-9_]+))/g;
        const parts = text.split(combinedRegex);
        return parts.map((part, i) => {
            if (!part) return null;
            if (part.startsWith('@')) return <span key={i} className={`text-blue-600 font-medium ${isInputOverlay ? 'bg-transparent' : 'bg-blue-50 px-1 rounded cursor-pointer hover:underline'}`}>{part}</span>;
            if (part.startsWith('#')) return <span key={i} className={`text-purple-600 font-medium ${isInputOverlay ? 'bg-transparent' : 'bg-purple-50 px-1 rounded cursor-pointer hover:underline'}`}>{part}</span>;
            if (part.match(/^https?:\/\//)) {
                if (isInputOverlay) return <span key={i} className="text-blue-500">{part}</span>;
                return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline" onClick={e => e.stopPropagation()}>{part}</a>;
            }
            if (part.match(/^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+$/)) {
                if (isInputOverlay) return <span key={i} className="text-blue-500">{part}</span>;
                return <a key={i} href={`mailto:${part}`} className="text-blue-500 hover:underline" onClick={e => e.stopPropagation()}>{part}</a>;
            }
            return <span key={i} className={isInputOverlay ? 'text-gray-800' : ''}>{part}</span>;
        });
    };

    const isCompleted = localStatus === 'completed';
    const currentStatusObj = ALL_STATUSES.find(s => s.value === localStatus);
    const priorityColor = getPriorityColor(task.priority);
    const hasStackedPanel = stackedSubtask !== null;

    const formatDate = (d: string) => {
        if (!d) return '';
        return new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    };
    const timeAgo = (d: string) => {
        const diff = Date.now() - new Date(d).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
    };

    const renderSearchResults = (type: 'blockedBy' | 'blocks' | 'linked') => {
        if (addingDepType !== type || !depSearch) return null;
        return (
            <div className="border border-gray-200 mt-2 rounded-lg bg-white max-h-48 overflow-y-auto shadow-sm">
                {filteredDepCandidates.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">No tasks found</p>
                ) : filteredDepCandidates.map(t => (
                    <button
                        key={t.id}
                        onClick={() => {
                            if (addingDepType === 'blockedBy') {
                                setLocalBlockedBy(prev => [...prev, t.id]);
                                t.blocksIds = [...(t.blocksIds || []), task.id];
                                task.blockedByIds = [...(task.blockedByIds || []), t.id];
                            }
                            if (addingDepType === 'blocks') {
                                setLocalBlocks(prev => [...prev, t.id]);
                                t.blockedByIds = [...(t.blockedByIds || []), task.id];
                                task.blocksIds = [...(task.blocksIds || []), t.id];
                            }
                            if (addingDepType === 'linked') {
                                setLocalLinked(prev => [...prev, t.id]);
                                t.linkedTaskIds = [...(t.linkedTaskIds || []), task.id];
                                task.linkedTaskIds = [...(task.linkedTaskIds || []), t.id];
                            }
                            setAddingDepType(null);
                            setDepSearch('');
                        }}
                        className="w-full text-left px-3 py-2.5 hover:bg-gray-50 text-[13px] text-gray-700 flex items-center gap-2 transition-colors border-b border-gray-100 last:border-0"
                    >
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusDotColor(t.status)}`} />
                        <span className="flex-1 truncate">{t.title}</span>
                    </button>
                ))}
            </div>
        );
    };

    // Panel width & position — adapts for full-screen and stacking
    const maxDepth = depth + activeSubtasksCount;
    const isMinimizedLeft = depth < currentActiveDepth;
    const isMinimizedRight = depth > currentActiveDepth;
    const panelMinimized = (isMinimizedLeft || isMinimizedRight) && !isFullScreen;

    const panelRightOffset = isFullScreen ? 0 :
        isMinimizedLeft ? (maxDepth - depth - 1) * 48 + 680 :
            isMinimizedRight ? (maxDepth - depth) * 48 :
                (maxDepth - currentActiveDepth) * 48;

    return (
        <>
            {/* Backdrop — only from the outermost panel */}
            <AnimatePresence>
                {isOpen && !isSubPanel && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/20 z-40 backdrop-blur-[1px]"
                        onClick={() => {
                            if (hasStackedPanel) closeStackedSubtask();
                            else onClose();
                        }}
                    />
                )}
            </AnimatePresence>

            {/* ── Minimized strip (when subtask is stacked) ── */}
            <AnimatePresence>
                {isOpen && panelMinimized && (
                    <motion.div
                        layout
                        initial={{ opacity: 0, x: isMinimizedLeft ? -20 : 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: isMinimizedLeft ? -20 : 20 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        className="fixed top-0 h-full bg-white border-l border-r border-gray-200 shadow-lg z-50 flex flex-col items-center cursor-pointer hover:bg-gray-50"
                        style={{ right: `${panelRightOffset}px`, width: '48px' }}
                        onClick={() => handleActiveDepthChange(depth)}
                        title={isMinimizedLeft ? "View parent task" : "View subtask"}
                    >
                        <div className="h-14 flex items-center justify-center w-full border-b border-gray-100">
                            <ChevronDown className={`w-4 h-4 text-gray-400 ${isMinimizedLeft ? '-rotate-90' : 'rotate-90'}`} />
                        </div>
                        <div className="flex-1 flex items-center justify-center py-4 overflow-hidden px-1">
                            <span
                                className="text-xs font-medium text-gray-500 select-none"
                                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', maxHeight: 'calc(100vh - 5rem)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            >
                                {title || 'Untitled Task'}
                            </span>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Main Panel ── */}
            <AnimatePresence>
                {!panelMinimized && (
                    <motion.div
                        layout
                        initial={{ x: '100%' }}
                        animate={{ x: isOpen ? 0 : '100%' }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 30, stiffness: 300, mass: 0.8 }}
                        className={`fixed top-0 h-full bg-white shadow-2xl z-50 flex flex-col border-l border-gray-200`}
                        style={{
                            right: isFullScreen ? 0 : `${panelRightOffset}px`,
                            left: isFullScreen ? 0 : 'auto',
                            width: isFullScreen ? '100%' : '680px',
                        }}
                    >
                        {/* ── Top Bar ── */}
                        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-white flex-shrink-0">
                            {/* Status Dropdown */}
                            <div className="relative" ref={statusRef}>
                                <button
                                    onClick={() => setShowStatusDropdown(v => !v)}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${getStatusBadgeColor(localStatus)} border-transparent hover:opacity-80`}
                                >
                                    <span className={`w-2 h-2 rounded-full ${getStatusDotColor(localStatus)}`} />
                                    {currentStatusObj?.label || formatStatusLabel(localStatus) || localStatus}
                                    <ChevronDown className="w-3.5 h-3.5 opacity-70" />
                                </button>
                                {showStatusDropdown && (
                                    <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-xl shadow-lg border border-gray-200 z-50 py-1 overflow-hidden">
                                        {ALL_STATUSES.map(s => (
                                            <button
                                                key={s.value}
                                                onClick={() => handleStatusChange(s.value)}
                                                className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2.5 transition-colors ${s.value === localStatus ? 'font-semibold text-blue-700 bg-blue-50' : 'text-gray-700'}`}
                                            >
                                                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusDotColor(s.value)}`} />
                                                {s.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                {/* Mark Complete */}
                                <button
                                    onClick={handleMarkComplete}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${isCompleted ? 'bg-green-600 border-green-600 text-white hover:bg-green-700' : 'border-gray-300 text-gray-600 bg-white hover:bg-gray-50'}`}
                                >
                                    <CheckCircle className={`w-4 h-4 ${isCompleted ? 'text-white' : 'text-gray-400'}`} />
                                    {isCompleted ? 'Completed' : 'Mark Complete'}
                                </button>

                                {/* Copy link */}
                                <button
                                    onClick={() => navigator.clipboard?.writeText(window.location.href)}
                                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                    title="Copy link"
                                >
                                    <LinkIcon className="w-4 h-4" />
                                </button>

                                {/* More Menu */}
                                <div className="relative" ref={moreMenuRef}>
                                    <button
                                        onClick={() => setShowMoreMenu(!showMoreMenu)}
                                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors group relative"
                                        title="More"
                                    >
                                        <MoreHorizontal className="w-4 h-4" />
                                        <div className="absolute top-full right-0 mt-1 hidden group-hover:block px-2 py-1 bg-gray-800 text-white text-xs rounded shadow-lg whitespace-nowrap z-50">
                                            More
                                        </div>
                                    </button>

                                    {showMoreMenu && (
                                        <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1 font-sans">
                                            {currentActiveDepth < 3 && (
                                                <button onClick={() => {
                                                    if (!task.subtaskIds?.length) addNewSubtask();
                                                    setShowMoreMenu(false);
                                                }} className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${task.subtaskIds?.length ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'}`}>
                                                    <SubtaskIcon className="w-4 h-4" /> {task.subtaskIds?.length ? 'Remove subtasks' : 'Add subtask'}
                                                </button>
                                            )}
                                            {currentActiveDepth === 0 && (
                                                <button onClick={() => {
                                                    if (!localChecklist?.length) {
                                                        setShowChecklistInput(true);
                                                    } else {
                                                        setLocalChecklist([]);
                                                    }
                                                    setShowMoreMenu(false);
                                                }} className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${localChecklist?.length ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'}`}>
                                                    <AddChecklistIcon className="w-4 h-4" /> {localChecklist?.length ? 'Remove checklist' : 'Add checklist'}
                                                </button>
                                            )}
                                            <button onClick={() => {
                                                if (!localTags?.length) {
                                                    setShowTagInput(true);
                                                } else {
                                                    setLocalTags([]);
                                                }
                                                setShowMoreMenu(false);
                                            }} className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${localTags?.length ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'}`}>
                                                <Tag className="w-4 h-4" /> {localTags?.length ? 'Remove tags' : 'Add tags'}
                                            </button>
                                            <button onClick={() => {
                                                if (!localPriority) {
                                                    setShowPriorityInput(true);
                                                } else {
                                                    setLocalPriority(undefined);
                                                }
                                                setShowMoreMenu(false);
                                            }} className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${localPriority ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'}`}>
                                                <Flag className="w-4 h-4" /> {localPriority ? 'Remove priority' : 'Add priority'}
                                            </button>
                                            <button onClick={() => {
                                                const hasDeps = localBlockedBy?.length || localBlocks?.length || localLinked?.length;
                                                if (!hasDeps) {
                                                    setShowDepPopover(true);
                                                } else {
                                                    setLocalBlockedBy([]);
                                                    setLocalBlocks([]);
                                                    setLocalLinked([]);
                                                }
                                                setShowMoreMenu(false);
                                            }} className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${(localBlockedBy?.length || localBlocks?.length || localLinked?.length) ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'}`}>
                                                <LinkIcon className="w-4 h-4" /> {(localBlockedBy?.length || localBlocks?.length || localLinked?.length) ? 'Remove dependency' : 'Add dependency'}
                                            </button>
                                            <div className="h-px bg-gray-100 my-1" />
                                            <button onClick={async () => {
                                                setShowMoreMenu(false);
                                                const newIsSubtask = !task.isSubtask;
                                                const { error } = await supabase.from('tasks').update({ is_subtask: newIsSubtask, parent_task_id: null }).eq('id', task.id);
                                                if (!error) {
                                                    refreshTasks();
                                                    onClose();
                                                }
                                            }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                                                <span className="w-4 h-4" /> {task.isSubtask ? 'Convert to task' : 'Convert to subtask'}
                                            </button>
                                            <div className="h-px bg-gray-100 my-1" />
                                            {canDeleteTask && (
                                                <button onClick={() => {
                                                    setShowMoreMenu(false);
                                                    confirm('Are you sure you want to delete this task?', async () => {
                                                        const { error } = await supabase.from('tasks').delete().eq('id', task.id);
                                                        if (!error) {
                                                            refreshTasks();
                                                            onClose();
                                                        }
                                                    });
                                                }} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                                                    <Trash2 className="w-4 h-4" /> Delete task
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Full screen toggle */}
                                <button
                                    onClick={() => setIsFullScreen(v => !v)}
                                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                    title={isFullScreen ? 'Exit full screen' : 'Open in full'}
                                >
                                    {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                                </button>

                                <div className="w-px h-5 bg-gray-200 mx-1" />
                                <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* ── Scrollable Body ── */}
                        <div className="flex-1 overflow-y-auto bg-gray-50">
                            <div className="p-5 space-y-4">

                                {/* Priority tag + Task ID */}
                                <div className="flex items-center gap-2">
                                    <span
                                        className="px-2.5 py-0.5 rounded-full text-xs font-semibold text-white"
                                        style={{ backgroundColor: priorityColor }}
                                    >
                                        {task.priority?.toUpperCase()}
                                    </span>
                                    <span className="text-xs text-gray-400 font-mono">#{task.requestId || task.id.slice(0, 8)}</span>
                                </div>

                                {/* ── Title ── */}
                                <textarea
                                    value={title}
                                    onChange={e => setTitle(e.target.value)}
                                    className="w-full text-xl font-semibold text-gray-900 bg-transparent border-0 outline-none resize-none placeholder-gray-300 leading-tight"
                                    placeholder="Task title..."
                                    rows={1}
                                    onInput={e => {
                                        const t = e.target as HTMLTextAreaElement;
                                        t.style.height = 'auto';
                                        t.style.height = t.scrollHeight + 'px';
                                    }}
                                />

                                {/* ── Collaborators ── */}
                                <div>
                                    <SectionLabel>Collaborators</SectionLabel>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {localCollaborators.map(u => (
                                            <div key={u.id} title={u.name} className="relative group cursor-pointer">
                                                <Avatar user={u} size="sm" />
                                                {canManageCollaborators && (
                                                    <button
                                                        onClick={() => setLocalCollaborators(prev => prev.filter(c => c.id !== u.id))}
                                                        className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full hidden group-hover:flex items-center justify-center shadow-sm transition-all"
                                                        title={`Remove ${u.name}`}
                                                    >
                                                        <X className="w-2.5 h-2.5" />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                        {localCollaborators.length === 0 && (
                                            <span className="text-sm text-gray-400 italic">No collaborators</span>
                                        )}

                                        {/* Add collaborator picker */}
                                        {canManageCollaborators && (
                                            <div className="relative" ref={collabPickerRef}>
                                                <button
                                                    onClick={() => { setShowCollabPicker(v => !v); setCollabSearch(''); }}
                                                    className="w-8 h-8 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
                                                    title="Add collaborator"
                                                >
                                                    <Plus className="w-3.5 h-3.5" />
                                                </button>
                                                {showCollabPicker && (
                                                    <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-xl shadow-lg border border-gray-200 z-50 overflow-hidden">
                                                        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
                                                            <Search className="w-3.5 h-3.5 text-gray-400" />
                                                            <input
                                                                autoFocus
                                                                value={collabSearch}
                                                                onChange={e => setCollabSearch(e.target.value)}
                                                                placeholder="Search people..."
                                                                className="flex-1 text-sm outline-none placeholder-gray-400"
                                                            />
                                                        </div>
                                                        <div className="max-h-48 overflow-y-auto py-1">
                                                            {filteredCollabCandidates.length === 0 ? (
                                                                <p className="text-sm text-gray-400 text-center py-4">No users found</p>
                                                            ) : filteredCollabCandidates.map(u => (
                                                                <button
                                                                    key={u.id}
                                                                    onClick={() => {
                                                                        setLocalCollaborators(prev => [...prev, u]);
                                                                        setCollabSearch('');
                                                                        setShowCollabPicker(false);
                                                                    }}
                                                                    className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2.5 transition-colors"
                                                                >
                                                                    <Avatar user={u} size="xs" />
                                                                    <div>
                                                                        <div className="text-sm font-medium text-gray-800">{u.name}</div>
                                                                        <div className="text-xs text-gray-400">{u.role.replace('_', ' ')}</div>
                                                                    </div>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* ── Hours Progress Bar ── */}
                                <div className="bg-white rounded-xl border border-gray-200 p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <Clock className="w-4 h-4 text-gray-400" />
                                            <span className="text-sm font-medium text-gray-700">Hours Tracker</span>
                                        </div>
                                        <div className="text-right">
                                            <span className={`text-sm font-semibold ${isOverBudget ? 'text-red-600' : 'text-gray-900'}`}>
                                                {actual}h
                                            </span>
                                            <span className="text-sm text-gray-400"> / {estimated}h estimated</span>
                                        </div>
                                    </div>
                                    <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all duration-500 ${isOverBudget ? 'bg-red-500' : hoursPercent > 80 ? 'bg-amber-400' : 'bg-blue-500'}`}
                                            style={{ width: `${hoursPercent}%` }}
                                        />
                                    </div>
                                    <div className="flex justify-between mt-1.5">
                                        <span className="text-xs text-gray-400">{hoursPercent.toFixed(0)}% used</span>
                                        {isOverBudget ? (
                                            <span className="text-xs text-red-500 flex items-center gap-1">
                                                <AlertCircle className="w-3 h-3" /> Over budget by {(actual - estimated).toFixed(1)}h
                                            </span>
                                        ) : (
                                            <span className="text-xs text-gray-400">{(estimated - actual).toFixed(1)}h remaining</span>
                                        )}
                                    </div>
                                </div>

                                {/* ── Field Rows ── */}
                                <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                                    {/* Assignee */}
                                    <FieldRow label="Assignee">
                                        <div className="relative" ref={assigneePickerRef}>
                                            <div
                                                className="flex items-center gap-2 cursor-pointer group"
                                                onClick={() => setShowAssigneePicker(!showAssigneePicker)}
                                            >
                                                {assignedUser ? (
                                                    <>
                                                        <Avatar user={assignedUser} size="xs" />
                                                        <span className={`text-sm font-medium transition-colors ${
                                                            isDormant(assignedUser)
                                                                ? 'text-gray-400'
                                                                : 'text-gray-800 group-hover:text-blue-600'
                                                        }`}>
                                                            {assignedUser.name}
                                                        </span>
                                                        {dormantLabel(assignedUser) && (
                                                            <span className="text-[10px] uppercase tracking-wide text-gray-400 border border-gray-200 rounded px-1">
                                                                {dormantLabel(assignedUser)}
                                                            </span>
                                                        )}
                                                    </>
                                                ) : (
                                                    <button className="text-sm text-gray-400 group-hover:text-blue-600 flex items-center gap-1.5 transition-colors">
                                                        <UserIcon className="w-3.5 h-3.5" /> Unassigned
                                                    </button>
                                                )}
                                            </div>
                                            {showAssigneePicker && (
                                                <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-xl shadow-lg border border-gray-200 z-50 overflow-hidden">
                                                    <div className="max-h-48 overflow-y-auto py-1">
                                                        <button
                                                            onClick={() => handleAssign(undefined)}
                                                            className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2.5 transition-colors text-sm text-gray-600"
                                                        >
                                                            <UserIcon className="w-4 h-4 text-gray-400" /> Unassigned
                                                        </button>
                                                        {assigneesAreSkillFiltered && (
                                                            <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wide text-gray-400">
                                                                Has the required skill
                                                            </div>
                                                        )}
                                                        {assigneeCandidates.map(u => (
                                                            <button
                                                                key={u.id}
                                                                onClick={() => handleAssign(u.id)}
                                                                className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2.5 transition-colors"
                                                            >
                                                                <Avatar user={u} size="xs" />
                                                                <div className="text-sm font-medium text-gray-800">{u.name}</div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </FieldRow>

                                    {/* Due Date — start (optional) + end, both editable */}
                                    <FieldRow label="Due date">
                                        <div className="relative" ref={datePickerRef}>
                                            <div
                                                className="flex items-center gap-2 flex-wrap cursor-pointer group"
                                                onClick={(e) => { e.stopPropagation(); setShowDatePicker(true); }}
                                            >
                                                {localStartDate ? (
                                                    <div className="flex items-center gap-1.5">
                                                        <Calendar className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 group-hover:text-blue-600 transition-colors" />
                                                        <span className="text-sm text-gray-600 group-hover:text-blue-600 transition-colors">
                                                            {format(new Date(localStartDate), 'd MMM')}
                                                        </span>
                                                    </div>
                                                ) : null}
                                                {localStartDate && <span className="text-gray-400 text-sm">→</span>}
                                                <div className="flex items-center gap-1.5">
                                                    {!localStartDate && <Calendar className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 group-hover:text-blue-600 transition-colors" />}
                                                    <span className={`text-sm ${localDueDate ? 'text-gray-800 font-medium' : 'text-gray-400'} group-hover:text-blue-600 transition-colors`}>
                                                        {localDueDate ? (localStartDate && new Date(localDueDate).getFullYear() === new Date(localStartDate).getFullYear() ? format(new Date(localDueDate), 'd MMM') : format(new Date(localDueDate), 'd MMM yyyy')) : 'Set due date'}
                                                    </span>
                                                </div>
                                            </div>

                                            {showDatePicker && (
                                                <DateRangePicker
                                                    startDate={localStartDate}
                                                    dueDate={localDueDate}
                                                    onChange={(start, due) => {
                                                        setLocalStartDate(start);
                                                        setLocalDueDate(due);
                                                    }}
                                                    onClose={() => setShowDatePicker(false)}
                                                />
                                            )}
                                        </div>
                                    </FieldRow>

                                    {/* Tags */}
                                    {(localTags.length > 0 || showTagInput) && (
                                        <FieldRow label="Tags" icon={<Tag className="w-4 h-4 text-gray-400" />}>
                                            <div className="relative" ref={tagPopoverRef}>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    {localTags.map((tag, idx) => (
                                                        <span
                                                            key={tag.id || idx}
                                                            className={`px-2.5 py-1 text-sm font-medium rounded-full flex items-center gap-1.5 ${getTagStyle(tag.color).className}`}
                                                            style={getTagStyle(tag.color).style}
                                                        >
                                                            {tag.name}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleRemoveTag(tag.id);
                                                                }}
                                                                className="hover:opacity-75"
                                                            >
                                                                <X className="w-3 h-3" />
                                                            </button>
                                                        </span>
                                                    ))}
                                                    <button
                                                        onClick={() => {
                                                            setShowTagInput(true);
                                                            setTagSearchQuery('');
                                                        }}
                                                        className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-full text-sm font-medium flex items-center transition-colors"
                                                    >
                                                        +1
                                                    </button>
                                                </div>

                                                {/* Tag Popover */}
                                                {showTagInput && (
                                                    <div className="absolute top-full left-0 mt-2 w-72 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden font-sans">
                                                        <div className="p-3 border-b border-gray-100 flex flex-col gap-2">
                                                            <input
                                                                autoFocus
                                                                type="text"
                                                                value={tagSearchQuery}
                                                                onChange={e => {
                                                                    const val = e.target.value;
                                                                    if (val.includes(',')) {
                                                                        processTagsInput(val);
                                                                    } else {
                                                                        setTagSearchQuery(val);
                                                                    }
                                                                }}
                                                                placeholder="Search or create tag..."
                                                                className="w-full text-sm outline-none placeholder-gray-400 py-1"
                                                            />
                                                        </div>

                                                        <div className="p-2">
                                                            <div className="max-h-48 overflow-y-auto">
                                                                {allTags
                                                                    .filter((t: TagType) => !localTags.some((lt: TagType) => lt.id === t.id) && t.name.toLowerCase().includes(tagSearchQuery.toLowerCase()))
                                                                    .map((t: TagType) => (
                                                                        <button
                                                                            key={t.id}
                                                                            onClick={() => {
                                                                                setLocalTags([...localTags, t]);
                                                                                if (task?.id && !task.id.startsWith('subtask-new')) {
                                                                                    supabase.from('task_tags').insert({ task_id: task.id, tag_id: t.id }).then(() => refreshTasks());
                                                                                }
                                                                                setTagSearchQuery('');
                                                                                setShowTagInput(false);
                                                                            }}
                                                                            className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded flex items-center gap-2"
                                                                        >
                                                                            <span className="px-2 py-0.5 text-xs font-medium rounded-full text-white" style={{ backgroundColor: t.color || '#3b82f6' }}>{t.name}</span>
                                                                        </button>
                                                                    ))}

                                                                {tagSearchQuery.trim() && !allTags.some((t: TagType) => t.name.toLowerCase() === tagSearchQuery.trim().toLowerCase()) && (
                                                                    <button
                                                                        onClick={() => processTagsInput(tagSearchQuery)}
                                                                        className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded flex items-center justify-between text-sm text-gray-600"
                                                                    >
                                                                        <span>Create new tag</span>
                                                                        <span className="px-2 py-0.5 text-xs font-medium rounded-full text-blue-700 bg-blue-100">{tagSearchQuery.trim()}</span>
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </FieldRow>
                                    )}

                                    {/* Priority */}
                                    {(localPriority || showPriorityInput) && (
                                        <FieldRow label="Priority">
                                            <div className="relative" ref={priorityRef}>
                                                <button
                                                    onClick={() => setShowPriorityDropdown(v => !v)}
                                                    className="flex items-center gap-1.5 transition-colors group"
                                                >
                                                    {localPriority === 'urgent' ? (
                                                        <><Flag className="w-4 h-4 text-red-600" fill="currentColor" /> <span className="text-sm text-gray-800 font-medium">Urgent</span></>
                                                    ) : localPriority === 'high' ? (
                                                        <><Flag className="w-4 h-4 text-amber-600" fill="currentColor" /> <span className="text-sm text-gray-800 font-medium">High</span></>
                                                    ) : localPriority === 'normal' ? (
                                                        <><Flag className="w-4 h-4 text-blue-600" /> <span className="text-sm text-gray-800 font-medium">Normal</span></>
                                                    ) : localPriority === 'low' ? (
                                                        <><Flag className="w-4 h-4 text-gray-500" /> <span className="text-sm text-gray-800 font-medium">Low</span></>
                                                    ) : (
                                                        <><Flag className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" /> <span className="text-sm text-gray-500 group-hover:text-gray-700 transition-colors">Priority</span></>
                                                    )}
                                                </button>

                                                {showPriorityDropdown && (
                                                    <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-xl shadow-lg border border-gray-200 z-50 py-1 overflow-hidden">
                                                        {[
                                                            { value: 'urgent', label: 'Urgent', icon: <Flag className="w-4 h-4 text-red-600" fill="currentColor" />, colorClass: 'text-red-700 bg-red-50' },
                                                            { value: 'high', label: 'High', icon: <Flag className="w-4 h-4 text-amber-600" fill="currentColor" />, colorClass: 'text-amber-700 bg-amber-50' },
                                                            { value: 'normal', label: 'Normal', icon: <Flag className="w-4 h-4 text-blue-600" />, colorClass: 'text-blue-700 bg-blue-50' },
                                                            { value: 'low', label: 'Low', icon: <Flag className="w-4 h-4 text-gray-500" />, colorClass: 'text-gray-700 bg-gray-50' },
                                                            { value: 'clear', label: 'Clear', icon: <Ban className="w-4 h-4 text-gray-500" />, colorClass: 'text-gray-600 bg-gray-50' }
                                                        ].map(p => (
                                                            <button
                                                                key={p.value}
                                                                onClick={() => {
                                                                    if (p.value === 'clear') {
                                                                        setLocalPriority(undefined);
                                                                        setShowPriorityInput(false);
                                                                    } else {
                                                                        setLocalPriority(p.value as Priority);
                                                                    }
                                                                    setShowPriorityDropdown(false);
                                                                }}
                                                                className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between transition-colors hover:bg-gray-50 ${localPriority === p.value ? p.colorClass + ' font-medium' : 'text-gray-700'}`}
                                                            >
                                                                <div className="flex items-center gap-2.5">
                                                                    {p.icon}
                                                                    {p.label}
                                                                </div>
                                                                {localPriority === p.value && <Check className="w-4 h-4 text-blue-600" />}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </FieldRow>
                                    )}

                                    {/* Dependencies */}
                                    {(totalDeps > 0 || showDepPopover) && (
                                        <FieldRow icon={<LinkIcon className="w-4 h-4" />} label="Dependencies">
                                            <div className="relative group" ref={depPopoverRef}>
                                                <button
                                                    onClick={() => {
                                                        setShowDepPopover(v => !v);
                                                        setAddingDepType(null);
                                                        setDepSearch('');
                                                    }}
                                                    className={`flex items-center gap-1.5 text-sm transition-colors px-3 py-1.5 rounded-lg border ${totalDeps > 0
                                                            ? 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'
                                                            : 'bg-transparent border-transparent text-gray-500 hover:text-blue-600 hover:bg-gray-50'
                                                        }`}
                                                >
                                                    {totalDeps > 0 ? (
                                                        <>
                                                            <LinkIcon className="w-3.5 h-3.5 text-gray-400" />
                                                            {totalDeps} {totalDeps === 1 ? 'Dependency' : 'Dependencies'}
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Plus className="w-3.5 h-3.5" /> Add dependency
                                                        </>
                                                    )}
                                                </button>

                                                {totalDeps > 0 && !showDepPopover && (
                                                    <div className="absolute top-full left-0 mt-2 w-64 bg-gray-900 text-white rounded-lg shadow-xl p-3 text-xs opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[60] pointer-events-none text-left">
                                                        {localBlockedBy.length > 0 && (
                                                            <div className="mb-2 last:mb-0">
                                                                <span className="font-semibold text-amber-400">Blocked by:</span>
                                                                <ul className="list-disc pl-4 mt-1 space-y-0.5 text-gray-200">
                                                                    {localBlockedBy.map(id => (
                                                                        <li key={id} className="truncate">{allTasks.find(t => t.id === id)?.title}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}
                                                        {localBlocks.length > 0 && (
                                                            <div className="mb-2 last:mb-0">
                                                                <span className="font-semibold text-red-400">Blocks:</span>
                                                                <ul className="list-disc pl-4 mt-1 space-y-0.5 text-gray-200">
                                                                    {localBlocks.map(id => (
                                                                        <li key={id} className="truncate">{allTasks.find(t => t.id === id)?.title}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}
                                                        {localLinked.length > 0 && (
                                                            <div className="mb-2 last:mb-0">
                                                                <span className="font-semibold text-blue-300">Linked:</span>
                                                                <ul className="list-disc pl-4 mt-1 space-y-0.5 text-gray-200">
                                                                    {localLinked.map(id => (
                                                                        <li key={id} className="truncate">{allTasks.find(t => t.id === id)?.title}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {showDepPopover && (
                                                    <div className="absolute top-full left-0 mt-2 w-[400px] bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden font-sans">
                                                        {/* Header */}
                                                        <div className="p-4 border-b border-gray-100 flex items-start justify-between bg-white">
                                                            <div>
                                                                <h3 className="text-[15px] font-semibold text-gray-900">Dependencies</h3>
                                                                <p className="text-[13px] text-gray-500 mt-0.5">See what this task depends on and what depends on it.</p>
                                                            </div>
                                                            <button onClick={() => setShowDepPopover(false)} className="p-1 rounded-full hover:bg-gray-100 text-gray-400 flex-shrink-0 transition-colors">
                                                                <X className="w-4 h-4" />
                                                            </button>
                                                        </div>

                                                        {/* Body */}
                                                        <div className="p-4 space-y-5 max-h-[60vh] overflow-y-auto">
                                                            {/* Blocked by */}
                                                            <div>
                                                                <div className="flex items-center gap-2 mb-2">
                                                                    <AlertCircle className="w-4 h-4 text-amber-700" />
                                                                    <span className="text-[13px] font-medium text-amber-700">Blocked by</span>
                                                                </div>
                                                                <div className="ml-2 pl-5 border-l border-gray-100 space-y-1.5">
                                                                    {localBlockedBy.map(id => {
                                                                        const t = allTasks.find(task => task.id === id);
                                                                        if (!t) return null;
                                                                        return (
                                                                            <div key={id} className="flex items-center justify-between text-[13px] text-gray-600 group py-1">
                                                                                <span className="truncate flex-1">{t.title}</span>
                                                                                <button onClick={() => {
                                                                                    setLocalBlockedBy(prev => prev.filter(i => i !== id));
                                                                                    if (t.blocksIds) t.blocksIds = t.blocksIds.filter(i => i !== task.id);
                                                                                    if (task) task.blockedByIds = task.blockedByIds?.filter(i => i !== id);
                                                                                }} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"><X className="w-3.5 h-3.5" /></button>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                    {addingDepType === 'blockedBy' ? (
                                                                        <div className="relative mt-2">
                                                                            <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-gray-400" />
                                                                            <input autoFocus value={depSearch} onChange={e => setDepSearch(e.target.value)} placeholder="Search tasks..." className="w-full text-[13px] pl-7 pr-2 py-1.5 border border-gray-300 rounded-md outline-none focus:border-blue-500" />
                                                                            {renderSearchResults('blockedBy')}
                                                                        </div>
                                                                    ) : (
                                                                        <button onClick={() => { setAddingDepType('blockedBy'); setDepSearch(''); }} className="text-[13px] text-gray-400 hover:text-gray-700 flex items-center gap-1.5 mt-1 transition-colors">
                                                                            <Plus className="w-3.5 h-3.5" /> Add blocked by task
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            {/* Blocks */}
                                                            <div>
                                                                <div className="flex items-center gap-2 mb-2">
                                                                    <div className="w-4 h-4 rounded-full bg-red-600 flex items-center justify-center">
                                                                        <div className="w-2 h-[2px] bg-white rounded-full" />
                                                                    </div>
                                                                    <span className="text-[13px] font-medium text-red-600">Blocks</span>
                                                                </div>
                                                                <div className="ml-2 pl-5 border-l border-gray-100 space-y-1.5">
                                                                    {localBlocks.map(id => {
                                                                        const t = allTasks.find(task => task.id === id);
                                                                        if (!t) return null;
                                                                        return (
                                                                            <div key={id} className="flex items-center justify-between text-[13px] text-gray-600 group py-1">
                                                                                <span className="truncate flex-1">{t.title}</span>
                                                                                <button onClick={() => {
                                                                                    setLocalBlocks(prev => prev.filter(i => i !== id));
                                                                                    if (t.blockedByIds) t.blockedByIds = t.blockedByIds.filter(i => i !== task.id);
                                                                                    if (task) task.blocksIds = task.blocksIds?.filter(i => i !== id);
                                                                                }} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"><X className="w-3.5 h-3.5" /></button>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                    {addingDepType === 'blocks' ? (
                                                                        <div className="relative mt-2">
                                                                            <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-gray-400" />
                                                                            <input autoFocus value={depSearch} onChange={e => setDepSearch(e.target.value)} placeholder="Search tasks..." className="w-full text-[13px] pl-7 pr-2 py-1.5 border border-gray-300 rounded-md outline-none focus:border-blue-500" />
                                                                            {renderSearchResults('blocks')}
                                                                        </div>
                                                                    ) : (
                                                                        <button onClick={() => { setAddingDepType('blocks'); setDepSearch(''); }} className="text-[13px] text-gray-400 hover:text-gray-700 flex items-center gap-1.5 mt-1 transition-colors">
                                                                            <Plus className="w-3.5 h-3.5" /> Add task that blocks
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            {/* Linked */}
                                                            <div>
                                                                <div className="flex items-center gap-2 mb-2">
                                                                    <LinkIcon className="w-4 h-4 text-gray-600" />
                                                                    <span className="text-[13px] font-medium text-gray-700">Linked</span>
                                                                </div>
                                                                <div className="ml-2 pl-5 border-l border-gray-100 space-y-1.5">
                                                                    {localLinked.map(id => {
                                                                        const t = allTasks.find(task => task.id === id);
                                                                        if (!t) return null;
                                                                        return (
                                                                            <div key={id} className="flex items-center justify-between text-[13px] text-gray-600 group py-1">
                                                                                <span className="truncate flex-1">{t.title}</span>
                                                                                <button onClick={() => {
                                                                                    setLocalLinked(prev => prev.filter(i => i !== id));
                                                                                    if (t.linkedTaskIds) t.linkedTaskIds = t.linkedTaskIds.filter(i => i !== task.id);
                                                                                    if (task) task.linkedTaskIds = task.linkedTaskIds?.filter(i => i !== id);
                                                                                }} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"><X className="w-3.5 h-3.5" /></button>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                    {addingDepType === 'linked' ? (
                                                                        <div className="relative mt-2">
                                                                            <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-gray-400" />
                                                                            <input autoFocus value={depSearch} onChange={e => setDepSearch(e.target.value)} placeholder="Search tasks..." className="w-full text-[13px] pl-7 pr-2 py-1.5 border border-gray-300 rounded-md outline-none focus:border-blue-500" />
                                                                            {renderSearchResults('linked')}
                                                                        </div>
                                                                    ) : (
                                                                        <button onClick={() => { setAddingDepType('linked'); setDepSearch(''); }} className="text-[13px] text-gray-400 hover:text-gray-700 flex items-center gap-1.5 mt-1 transition-colors">
                                                                            <Plus className="w-3.5 h-3.5" /> Add linked task
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>

                                                    </div>
                                                )}
                                            </div>
                                        </FieldRow>
                                    )}

                                    {/* Brand / Client */}
                                    <FieldRow label="Brand">
                                        <div className="flex items-center gap-2">
                                            <div className="w-4 h-4 rounded bg-orange-100 flex items-center justify-center">
                                                <div className="w-2 h-2 rounded-sm bg-orange-500" />
                                            </div>
                                            <span className="text-sm text-gray-800">
                                                {client?.name || 'No Brand'}
                                                {task?.department && <span className="text-gray-400 font-normal"> &middot; {task.department}</span>}
                                            </span>
                                        </div>
                                    </FieldRow>

                                    {/* Region */}
                                    {task.regionId && (
                                        <FieldRow label="Region">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm text-gray-800">
                                                    {regions.find(r => r.id === task.regionId)?.flag} {regions.find(r => r.id === task.regionId)?.name || 'Unknown'}
                                                </span>
                                            </div>
                                        </FieldRow>
                                    )}

                                    {/* Answers to the admin-configured fields. Without this the
                                        Customize modal would capture data nobody could ever read. */}
                                    {Object.entries(task.customFields ?? {}).map(([key, value]) => (
                                        <FieldRow
                                            key={key}
                                            label={requestFormFields.find(f => f.fieldKey === key)?.label ?? key}
                                        >
                                            <span className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                                                {formatCustomValue(value)}
                                            </span>
                                        </FieldRow>
                                    ))}

                                    {/* Requested by */}
                                    <FieldRow label="Requested by">
                                        {requester ? (
                                            <div className="flex items-center gap-2">
                                                <Avatar user={requester} size="xs" />
                                                <span className={`text-sm ${isDormant(requester) ? 'text-gray-400' : 'text-gray-800'}`}>
                                                    {requester.name}
                                                </span>
                                                {dormantLabel(requester) && (
                                                    <span className="text-[10px] uppercase tracking-wide text-gray-400 border border-gray-200 rounded px-1">
                                                        {dormantLabel(requester)}
                                                    </span>
                                                )}
                                            </div>
                                        ) : task.requesterName ? (
                                            /* Came in through the public share link, so there is no
                                               account behind it -- name and email are on the task. */
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 text-[10px] font-semibold flex items-center justify-center flex-shrink-0">
                                                    {task.requesterName.charAt(0).toUpperCase()}
                                                </div>
                                                <span className="text-sm text-gray-800">{task.requesterName}</span>
                                                {task.requesterEmail && (
                                                    <a
                                                        href={`mailto:${task.requesterEmail}`}
                                                        className="text-xs text-blue-600 hover:underline"
                                                    >
                                                        {task.requesterEmail}
                                                    </a>
                                                )}
                                                <span className="text-[10px] uppercase tracking-wide text-gray-400 border border-gray-200 rounded px-1 py-0.5">
                                                    External
                                                </span>
                                            </div>
                                        ) : (
                                            <span className="text-sm text-gray-400">Unknown</span>
                                        )}
                                    </FieldRow>
                                </div>

                                {/* ── Description ── */}
                                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                                    <SectionLabel>Description</SectionLabel>
                                    {isEditingDescription ? (
                                        <textarea
                                            autoFocus
                                            value={description}
                                            onChange={e => setDescription(e.target.value)}
                                            onBlur={() => setIsEditingDescription(false)}
                                            className="w-full min-h-[100px] text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-y transition-all placeholder-gray-300"
                                            placeholder="Add a description..."
                                        />
                                    ) : (
                                        <div 
                                            onClick={() => setIsEditingDescription(true)}
                                            className="w-full min-h-[100px] text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded-lg p-3 cursor-text whitespace-pre-wrap hover:border-gray-200 transition-all"
                                        >
                                            {description ? renderTextWithMentions(description) : <span className="text-gray-300">Add a description...</span>}
                                        </div>
                                    )}
                                </div>


                                {/* ── Subtasks ── */}
                                {(localSubtaskIds.length > 0) && (
                                    <div className="mt-8 mb-4">
                                        <div className="flex items-center justify-between mb-2 -mx-6 px-6 group/header">
                                            <div className="flex items-center gap-3">
                                                <ChevronDown className="w-4 h-4 text-gray-500 bg-gray-100 rounded" />
                                                {isEditingSubtasksTitle ? (
                                                    <input 
                                                        autoFocus
                                                        className="text-[15px] font-bold text-gray-900 bg-transparent border-0 p-0 focus:ring-0" 
                                                        value={subtasksTitle} 
                                                        onChange={e => setSubtasksTitle(e.target.value)} 
                                                        onBlur={() => setIsEditingSubtasksTitle(false)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                e.preventDefault();
                                                                setIsEditingSubtasksTitle(false);
                                                            }
                                                        }}
                                                    />
                                                ) : (
                                                    <h3 className="text-[15px] font-bold text-gray-900 cursor-text" onClick={() => setIsEditingSubtasksTitle(true)}>
                                                        {subtasksTitle || 'Subtasks'}
                                                    </h3>
                                                )}
                                                <span className="bg-gray-200/70 text-gray-600 text-xs px-2 py-0.5 rounded font-medium">0 / {localSubtaskIds.length}</span>
                                            </div>
                                            <div className="flex items-center opacity-0 group-hover/header:opacity-100 transition-opacity">
                                                <div className="relative group/menu">
                                                    <button className="p-1 hover:bg-gray-100 rounded text-gray-500 transition-colors">
                                                        <MoreHorizontal className="w-4 h-4" />
                                                    </button>
                                                    <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-xl z-[60] overflow-hidden font-sans opacity-0 invisible group-hover/menu:opacity-100 group-hover/menu:visible transition-all">
                                                        <div className="py-1">
                                                            <button onClick={() => {
                                                                setLocalSubtaskIds([]);
                                                                task.subtaskIds = [];
                                                            }} className="w-full text-left px-4 py-2 hover:bg-red-50 flex items-center gap-2 text-sm text-red-600">
                                                                <Trash2 className="w-4 h-4" /> Delete subtasks
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-[1px]">
                                            {localSubtaskIds.map(sid => {
                                                const sub = allTasks.find(t => t.id === sid);
                                                if (!sub) return null;
                                                const assignee = sub.assignedToId ? users.find(u => u.id === sub.assignedToId) : null;
                                                const assigneeInitials = assignee ? assignee.name.split(' ').map(n => n[0]).join('').toLowerCase() : '';
                                                return (
                                                    <div
                                                        key={sid}
                                                        draggable
                                                        onDragStart={(e) => {
                                                            dragSubtaskId.current = sid;
                                                            setDraggingSubtaskId(sid);
                                                            e.dataTransfer.effectAllowed = 'move';
                                                            // Build a tiny ghost so the whole panel doesn't drag
                                                            const ghost = document.createElement('div');
                                                            ghost.style.cssText = 'position:fixed;top:-9999px;left:-9999px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:4px 12px;font-size:13px;color:#1e40af;white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis;pointer-events:none;';
                                                            ghost.textContent = sub.title || 'Subtask';
                                                            document.body.appendChild(ghost);
                                                            e.dataTransfer.setDragImage(ghost, 0, 12);
                                                            setTimeout(() => document.body.removeChild(ghost), 0);
                                                        }}
                                                        onDragEnd={() => {
                                                            dragSubtaskId.current = null;
                                                            setDraggingSubtaskId(null);
                                                            setDragOverSubtaskId(null);
                                                        }}
                                                        onDragOver={(e) => {
                                                            e.preventDefault();
                                                            e.dataTransfer.dropEffect = 'move';
                                                            if (dragSubtaskId.current && dragSubtaskId.current !== sid) {
                                                                setDragOverSubtaskId(sid);
                                                            }
                                                        }}
                                                        onDragLeave={() => setDragOverSubtaskId(null)}
                                                        onDrop={(e) => {
                                                            e.preventDefault();
                                                            const fromId = dragSubtaskId.current;
                                                            if (!fromId || fromId === sid || !task.subtaskIds) return;
                                                            const ids = [...localSubtaskIds];
                                                            const fromIdx = ids.indexOf(fromId);
                                                            const toIdx = ids.indexOf(sid);
                                                            if (fromIdx === -1 || toIdx === -1) return;
                                                            ids.splice(fromIdx, 1);
                                                            ids.splice(toIdx, 0, fromId);
                                                            task.subtaskIds = ids;
                                                            updateSubtaskOrderInDB(ids);
                                                            setDragOverSubtaskId(null);
                                                            dragSubtaskId.current = null;
                                                        }}
                                                        onContextMenu={(e) => {
                                                            e.preventDefault();
                                                            setSubtaskContextMenu({ sid, x: e.clientX, y: e.clientY });
                                                        }}
                                                        className={`flex items-center group transition-colors border-y -mx-6 px-6 py-1.5 cursor-default ${dragOverSubtaskId === sid
                                                                ? 'bg-blue-100 border-blue-300'
                                                                : draggingSubtaskId === sid
                                                                    ? 'opacity-30 border-transparent bg-blue-50/30'
                                                                    : 'bg-blue-50/30 hover:bg-blue-50/70 border-transparent hover:border-gray-200'
                                                            }`}
                                                    >
                                                        {/* Left side */}
                                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                                            <GripVertical
                                                                className="w-4 h-4 text-gray-300 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing flex-shrink-0 -ml-1"
                                                                onMouseDown={(e) => e.stopPropagation()}
                                                            />

                                                            <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${sub.status === 'completed' ? 'bg-green-100 border border-green-200' : 'bg-orange-100/80 border border-orange-200/80'}`}>
                                                                {sub.status === 'completed' ? (
                                                                    <Check className="w-3.5 h-3.5 text-green-600" />
                                                                ) : (
                                                                    <span className="text-[10px] font-bold text-orange-600">O</span>
                                                                )}
                                                            </div>

                                                            <input
                                                                className={`text-[14px] flex-1 min-w-0 bg-transparent outline-none placeholder-gray-400 ${sub.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-800'}`}
                                                                value={sub.title}
                                                                placeholder="Task name"
                                                                autoFocus={!sub.title}
                                                                onClick={(e) => e.stopPropagation()}
                                                                onChange={(e) => {
                                                                    sub.title = e.target.value;
                                                                    setLocalLinked([...localLinked]);
                                                                }}
                                                                onBlur={(e) => {
                                                                    setTimeout(() => {
                                                                        setLocalSubtaskIds(prev => {
                                                                            if (openSubtaskDatePickerId === sid) return prev;
                                                                            const currentSub = allTasks.find(t => t.id === sid);
                                                                            if (currentSub && !currentSub.title.trim() && !currentSub.dueDate && !currentSub.assignedToId) {
                                                                                if (task) task.subtaskIds = task.subtaskIds?.filter(id => id !== sid);
                                                                                return prev.filter(id => id !== sid);
                                                                            }
                                                                            return prev;
                                                                        });
                                                                    }, 200);
                                                                }}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter' || e.key === 'Escape') {
                                                                        e.currentTarget.blur();
                                                                    }
                                                                }}
                                                            />
                                                        </div>

                                                        {/* Right side */}
                                                        <div className={`flex items-center gap-3 flex-shrink-0 transition-opacity`} onMouseDown={(e) => e.preventDefault()}>
                                                            <div className="relative">
                                                                <div 
                                                                    className="cursor-pointer flex items-center gap-1.5"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setOpenSubtaskDatePickerId(sid);
                                                                    }}
                                                                >
                                                                    {sub.proposedStartDate && sub.dueDate ? (
                                                                        <span className={`text-[13px] hover:text-blue-600 transition-colors ${sub.status === 'completed' ? 'text-gray-400 line-through' : new Date(sub.dueDate) < new Date() ? 'text-red-600' : 'text-gray-600'}`}>
                                                                            {format(new Date(sub.proposedStartDate), 'd MMM')} → {format(new Date(sub.dueDate), 'd MMM')}
                                                                        </span>
                                                                    ) : sub.dueDate ? (
                                                                        <span className={`text-[13px] hover:text-blue-600 transition-colors ${sub.status === 'completed' ? 'text-gray-400 line-through' : new Date(sub.dueDate) < new Date() ? 'text-red-600' : 'text-gray-600'}`}>
                                                                            {format(new Date(sub.dueDate), 'd MMM')}
                                                                        </span>
                                                                    ) : (
                                                                        <Calendar className="w-3.5 h-3.5 text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                                    )}
                                                                </div>
                                                                {openSubtaskDatePickerId === sid && (
                                                                    <DateRangePicker
                                                                        align="right"
                                                                        startDate={sub.proposedStartDate || ''}
                                                                        dueDate={sub.dueDate || ''}
                                                                        onChange={(start, due) => {
                                                                            sub.proposedStartDate = start;
                                                                            sub.dueDate = due;
                                                                            setLocalLinked([...localLinked]);
                                                                        }}
                                                                        onClose={() => {
                                                                            setOpenSubtaskDatePickerId(null);
                                                                            if (!sub.title.trim() && !sub.dueDate && !sub.assignedToId) {
                                                                                setLocalSubtaskIds(prev => prev.filter(id => id !== sid));
                                                                                if (task) task.subtaskIds = task.subtaskIds?.filter(id => id !== sid);
                                                                            }
                                                                        }}
                                                                    />
                                                                )}
                                                            </div>

                                                            <div className="relative group/picker ml-1">
                                                                <div className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                                                                    {assignee ? (
                                                                        <div className="w-6 h-6 rounded-full bg-yellow-400 flex items-center justify-center text-yellow-900 text-[11px] font-medium border border-yellow-500/30">
                                                                            {assigneeInitials}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="w-6 h-6 rounded-full border border-dashed border-gray-400 flex items-center justify-center text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                            <UserIcon className="w-3.5 h-3.5" />
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-xl z-[60] overflow-hidden font-sans opacity-0 invisible group-hover/picker:opacity-100 group-hover/picker:visible transition-all">
                                                                    <div className="max-h-48 overflow-y-auto p-1">
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                sub.assignedToId = undefined;
                                                                                if (!sub.title.trim() && !sub.dueDate) {
                                                                                    setLocalSubtaskIds(prev => prev.filter(id => id !== sid));
                                                                                    if (task) task.subtaskIds = task.subtaskIds?.filter(id => id !== sid);
                                                                                } else {
                                                                                    setLocalLinked([...localLinked]);
                                                                                }
                                                                            }}
                                                                            className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded flex items-center gap-2 text-sm text-gray-600"
                                                                        >
                                                                            <UserIcon className="w-4 h-4" /> Unassigned
                                                                        </button>
                                                                        {users.map(u => (
                                                                            <button
                                                                                key={u.id}
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    sub.assignedToId = u.id;
                                                                                    setLocalLinked([...localLinked]);
                                                                                }}
                                                                                className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded flex items-center gap-2 text-sm text-gray-800"
                                                                            >
                                                                                <Avatar user={u} size="xs" /> {u.name}
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <button 
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setStackedSubtask(sub);
                                                                    setActiveSubtasksCount(1);
                                                                    onNestedDepthChange?.(1);
                                                                    handleActiveDepthChange(depth + 1);
                                                                }}
                                                                className="p-1 hover:bg-gray-100 rounded cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                                            >
                                                                <ChevronRight className="w-4 h-4 text-gray-400" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            {/* Add subtask text button */}
                                            {depth < 4 && (
                                                <div className="-mx-6 px-6 py-2 group">
                                                    <button
                                                        onClick={addNewSubtask}
                                                        className="text-[13px] text-gray-500 group-hover:text-gray-700 ml-[36px] font-medium transition-colors"
                                                    >
                                                        Add subtask
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}


                                {/* ── Checklist ── */}
                                {(localChecklist.length > 0 || showChecklistInput) && (
                                    <div className="mt-8 mb-4">
                                        <div className="flex items-center justify-between mb-3 -mx-6 px-6 group/header">
                                            <div className="flex items-center gap-3">
                                                <ChevronDown className="w-4 h-4 text-gray-500 bg-gray-100 rounded" />
                                                <h3 className="text-[15px] font-bold text-gray-900">Checklists</h3>
                                                <span className="text-gray-400 text-sm font-medium">{localChecklist.filter(c => c.completed).length} complete</span>
                                                <div className="w-8 h-[3px] bg-gray-200 rounded-full overflow-hidden">
                                                    <div className="h-full bg-gray-800 rounded-full" style={{ width: `${localChecklist.length ? (localChecklist.filter(c => c.completed).length / localChecklist.length) * 100 : 0}%` }}></div>
                                                </div>
                                            </div>
                                            <div className="flex items-center opacity-0 group-hover/header:opacity-100 transition-opacity">
                                                <div className="relative group/menu">
                                                    <button className="p-1 hover:bg-gray-100 rounded text-gray-500 transition-colors">
                                                        <MoreHorizontal className="w-4 h-4" />
                                                    </button>
                                                    <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-xl z-[60] overflow-hidden font-sans opacity-0 invisible group-hover/menu:opacity-100 group-hover/menu:visible transition-all">
                                                        <div className="py-1">
                                                            <button onClick={() => updateChecklistInDB([])} className="w-full text-left px-4 py-2 hover:bg-red-50 flex items-center gap-2 text-sm text-red-600">
                                                                <Trash2 className="w-4 h-4" /> Delete checklist
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="bg-white rounded-xl border border-gray-200 p-5">


                                            <div className="space-y-3">
                                                {localChecklist.filter(item => !hideCompletedChecklistItems || !item.completed).map((item, idx) => (
                                                    <div key={item.id} className="flex items-center gap-3 group relative">
                                                        <button
                                                            onClick={() => {
                                                                const newC = [...localChecklist];
                                                                // Find the actual index in the unfiltered array
                                                                const realIdx = localChecklist.findIndex(c => c.id === item.id);
                                                                if (realIdx !== -1) {
                                                                    newC[realIdx].completed = !newC[realIdx].completed;
                                                                    setLocalChecklist(newC);
                                                                }
                                                            }}
                                                            className={`flex-shrink-0 transition-colors ${item.completed ? 'text-blue-500' : 'text-gray-300 hover:text-blue-400'}`}
                                                        >
                                                            {item.completed ? (
                                                                <CheckCircle className="w-5 h-5 fill-current text-white" />
                                                            ) : (
                                                                <div className="w-5 h-5 rounded-full border-2 border-current"></div>
                                                            )}
                                                        </button>

                                                        <input
                                                            type="text"
                                                            value={item.text}
                                                            onChange={(e) => {
                                                                const newC = [...localChecklist];
                                                                const realIdx = localChecklist.findIndex(c => c.id === item.id);
                                                                if (realIdx !== -1) {
                                                                    newC[realIdx].text = e.target.value;
                                                                    setLocalChecklist(newC);
                                                                }
                                                            }}
                                                            className={`flex-1 text-[14px] bg-transparent border-0 p-0 focus:ring-0 ${item.completed ? 'text-gray-500 line-through' : 'text-gray-800'}`}
                                                        />

                                                        {/* Checklist Assignee Picker */}
                                                        <div className="relative group/picker ml-auto flex-shrink-0">
                                                            <div className="flex items-center justify-center w-7 h-7 rounded-full hover:bg-gray-100 cursor-pointer">
                                                                {item.assigneeId && users.find(u => u.id === item.assigneeId) ? (
                                                                    <Avatar user={users.find(u => u.id === item.assigneeId)!} size="xs" />
                                                                ) : (
                                                                    <UserPlus className="w-4 h-4 text-gray-400 hover:text-gray-600 transition-colors" />
                                                                )}
                                                            </div>
                                                            <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-xl z-[60] overflow-hidden font-sans opacity-0 invisible group-hover/picker:opacity-100 group-hover/picker:visible transition-all">
                                                                <div className="max-h-48 overflow-y-auto p-1">
                                                                    <button
                                                                        onClick={() => {
                                                                            const newC = [...localChecklist];
                                                                            const realIdx = localChecklist.findIndex(c => c.id === item.id);
                                                                            if (realIdx !== -1) {
                                                                                newC[realIdx].assigneeId = undefined;
                                                                                setLocalChecklist(newC);
                                                                            }
                                                                        }}
                                                                        className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded flex items-center gap-2 text-sm text-gray-600"
                                                                    >
                                                                        <UserIcon className="w-4 h-4" /> Unassigned
                                                                    </button>
                                                                    {users.map(u => (
                                                                        <button
                                                                            key={u.id}
                                                                            onClick={() => {
                                                                                const newC = [...localChecklist];
                                                                                const realIdx = localChecklist.findIndex(c => c.id === item.id);
                                                                                if (realIdx !== -1) {
                                                                                    newC[realIdx].assigneeId = u.id;
                                                                                    setLocalChecklist(newC);
                                                                                }
                                                                            }}
                                                                            className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded flex items-center gap-2 text-sm text-gray-800"
                                                                        >
                                                                            <Avatar user={u} size="xs" /> {u.name}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Delete button (shows on hover) */}
                                                        <button
                                                            onClick={() => setLocalChecklist(localChecklist.filter(c => c.id !== item.id))}
                                                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity flex-shrink-0"
                                                        >
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                ))}

                                                {/* Add Item Row */}
                                                <div className="flex items-center gap-3 pt-2">
                                                    <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                                                        <Plus className="w-4 h-4 text-gray-400" />
                                                    </div>
                                                    <input
                                                        type="text"
                                                        value={newChecklistItem}
                                                        onChange={(e) => setNewChecklistItem(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' && newChecklistItem.trim()) {
                                                                setLocalChecklist([...localChecklist, { id: `chk-${Date.now()}`, text: newChecklistItem.trim(), completed: false, assigneeId: newChecklistAssigneeId }]);
                                                                setNewChecklistItem('');
                                                                setNewChecklistAssigneeId(undefined);
                                                            }
                                                        }}
                                                        onBlur={() => {
                                                            if (newChecklistItem.trim()) {
                                                                setLocalChecklist([...localChecklist, { id: `chk-${Date.now()}`, text: newChecklistItem.trim(), completed: false, assigneeId: newChecklistAssigneeId }]);
                                                                setNewChecklistItem('');
                                                                setNewChecklistAssigneeId(undefined);
                                                            }
                                                        }}
                                                        placeholder="Add item"
                                                        className="flex-1 text-[14px] bg-transparent border-0 border-transparent p-0 focus:ring-0 focus:outline-none focus:border-transparent text-gray-800 placeholder-gray-400"
                                                    />
                                                    <div className="relative group/picker ml-auto flex-shrink-0">
                                                        <div className="flex items-center justify-center w-7 h-7 rounded-full hover:bg-gray-100 cursor-pointer">
                                                            {newChecklistAssigneeId && users.find(u => u.id === newChecklistAssigneeId) ? (
                                                                <Avatar user={users.find(u => u.id === newChecklistAssigneeId)!} size="xs" />
                                                            ) : (
                                                                <UserPlus className="w-4 h-4 text-gray-300 hover:text-gray-600 transition-colors" />
                                                            )}
                                                        </div>
                                                        <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-xl z-[60] overflow-hidden font-sans opacity-0 invisible group-hover/picker:opacity-100 group-hover/picker:visible transition-all">
                                                            <div className="max-h-48 overflow-y-auto p-1">
                                                                <button
                                                                    onMouseDown={(e) => { e.preventDefault(); setNewChecklistAssigneeId(undefined); }}
                                                                    className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded flex items-center gap-2 text-sm text-gray-600"
                                                                >
                                                                    <UserIcon className="w-4 h-4" /> Unassigned
                                                                </button>
                                                                {users.map(u => (
                                                                    <button
                                                                        key={u.id}
                                                                        onMouseDown={(e) => { e.preventDefault(); setNewChecklistAssigneeId(u.id); }}
                                                                        className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded flex items-center gap-2 text-sm text-gray-800"
                                                                    >
                                                                        <Avatar user={u} size="xs" /> {u.name}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="w-6 h-6 flex-shrink-0"></div> {/* Spacer for delete button alignment */}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}


                                {/* Optional Fields Action Bar */}
                                {((!localChecklist.length && !showChecklistInput && !task.isSubtask && depth === 0) ||
                                    (!(task.subtaskIds && task.subtaskIds.length > 0) && depth < 3) ||
                                    (!localPriority && !showPriorityInput) ||
                                    (totalDeps === 0 && !showDepPopover)) && (
                                        <div className="flex items-center gap-3">
                                            {(!localPriority && !showPriorityInput) && (
                                                <button onClick={() => setShowPriorityInput(true)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors font-medium bg-white border border-gray-200 px-3 py-1.5 rounded-lg hover:border-blue-200 hover:bg-blue-50">
                                                    <Flag className="w-3.5 h-3.5" /> Add priority
                                                </button>
                                            )}
                                            {(!localChecklist.length && !showChecklistInput) && (
                                                <button onClick={() => setShowChecklistInput(true)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors font-medium bg-white border border-gray-200 px-3 py-1.5 rounded-lg hover:border-blue-200 hover:bg-blue-50">
                                                    <AddChecklistIcon className="w-3.5 h-3.5" /> Add checklist
                                                </button>
                                            )}
                                            {(!(task.subtaskIds && task.subtaskIds.length > 0) && depth < 3) && (
                                                <button onClick={addNewSubtask} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors font-medium bg-white border border-gray-200 px-3 py-1.5 rounded-lg hover:border-blue-200 hover:bg-blue-50">
                                                    <SubtaskIcon className="w-3.5 h-3.5" /> Add subtask
                                                </button>
                                            )}
                                            {(totalDeps === 0 && !showDepPopover) && (
                                                <button onClick={() => setShowDepPopover(true)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors font-medium bg-white border border-gray-200 px-3 py-1.5 rounded-lg hover:border-blue-200 hover:bg-blue-50">
                                                    <LinkIcon className="w-3.5 h-3.5" /> Add dependency
                                                </button>
                                            )}
                                        </div>
                                    )}

                                {/* ── Activity & Comments ── */}
                                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                                    {/* Tab Bar */}
                                    <div className="flex border-b border-gray-200 bg-gray-50/50">
                                        <button
                                            onClick={() => setActiveTab('activity')}
                                            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${activeTab === 'activity' ? 'border-blue-600 text-blue-700 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                                        >
                                            <Clock className="w-4 h-4" /> All Activity
                                        </button>
                                        <button
                                            onClick={() => setActiveTab('comments')}
                                            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${activeTab === 'comments' ? 'border-blue-600 text-blue-700 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                                        >
                                            <MessageSquare className="w-4 h-4" /> Comments
                                            {comments.length > 0 && (
                                                <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5 font-semibold">{comments.length}</span>
                                            )}
                                        </button>
                                    </div>

                                    <div className="p-4 space-y-4">
                                        {/* ── Activity events (only on "All Activity" tab) ── */}
                                        {activeTab === 'activity' && (
                                            <>
                                                {/* Request submitted */}
                                                <div className="flex gap-3">
                                                    <div className="w-7 h-7 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                                                        <LinkIcon className="w-3.5 h-3.5 text-indigo-400" />
                                                    </div>
                                                    <div className="flex-1 pt-0.5">
                                                        <p className="text-sm text-gray-600">
                                                            <span className="font-medium text-gray-900">{requester?.name || task.requesterName || 'Unknown'}</span>
                                                            {' '}submitted this request
                                                        </p>
                                                        <p className="text-xs text-gray-400 mt-0.5">{task.createdDate ? formatDate(task.createdDate) : '—'}</p>
                                                    </div>
                                                </div>

                                                {/* Converted to task */}
                                                {task.assignedDate && (
                                                    <div className="flex gap-3">
                                                        <div className="w-7 h-7 rounded-full bg-green-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                                                            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                                                        </div>
                                                        <div className="flex-1 pt-0.5">
                                                            <p className="text-sm text-gray-600">
                                                                Request converted to task
                                                                {assignedByUser && (
                                                                    <> by <span className="font-medium text-gray-900">{assignedByUser.name}</span></>
                                                                )}
                                                            </p>
                                                            <p className="text-xs text-gray-400 mt-0.5">{formatDate(task.assignedDate)}</p>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Assigned to */}
                                                {task.assignedDate && assignedUser && (
                                                    <div className="flex gap-3">
                                                        <div className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                                                            <UserIcon className="w-3.5 h-3.5 text-blue-500" />
                                                        </div>
                                                        <div className="flex-1 pt-0.5">
                                                            <p className="text-sm text-gray-600">
                                                                Task assigned to{' '}
                                                                <span className="font-medium text-gray-900">{assignedUser.name}</span>
                                                            </p>
                                                            <p className="text-xs text-gray-400 mt-0.5">{formatDate(task.assignedDate)}</p>
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        )}

                                        {/* ── Comments (both tabs show comments) ── */}
                                        {comments.map(comment => {
                                            const author = users.find(u => u.id === comment.userId);
                                            return (
                                                <div key={comment.id} className="flex gap-3">
                                                    <Avatar user={author} size="sm" />
                                                    <div className="flex-1">
                                                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                                                            <div className="flex items-center justify-between mb-1.5">
                                                                <span className="flex items-center gap-1.5">
                                                                    <span className={`text-sm font-semibold ${isDormant(author) ? 'text-gray-400' : 'text-gray-900'}`}>
                                                                        {author?.name || 'Unknown'}
                                                                    </span>
                                                                    {dormantLabel(author) && (
                                                                        <span className="text-[10px] uppercase tracking-wide text-gray-400 border border-gray-200 rounded px-1">
                                                                            {dormantLabel(author)}
                                                                        </span>
                                                                    )}
                                                                </span>
                                                                <span className="text-xs text-gray-400">{timeAgo(comment.createdDate)}</span>
                                                            </div>
                                                            <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                                                                {renderTextWithMentions(comment.content)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {activeTab === 'comments' && comments.length === 0 && (
                                            <p className="text-sm text-gray-400 text-center py-2">No comments yet</p>
                                        )}

                                        <div ref={commentsEndRef} />
                                    </div>
                                </div>

                                {/* bottom padding */}
                                <div className="h-2" />
                            </div>
                        </div>

                        {/* ── Comment Input Footer ── */}
                        <div className="flex-shrink-0 border-t border-gray-200 bg-white p-4">
                            <div className="flex gap-3 items-start">
                                <Avatar user={currentUser} size="sm" />
                                <form onSubmit={handleAddComment} className="flex-1">
                                    <div className="relative border border-gray-200 rounded-xl bg-white focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/10 transition-all">
                                        {mentionState && mentionSuggestions.length > 0 && (
                                            <div className="absolute bottom-full mb-1 left-0 w-64 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-50">
                                                {mentionSuggestions.map(s => {
                                                    const isUser = mentionState.type === '@';
                                                    const text = isUser ? `@${(s as User).name.replace(/\s+/g, '')}` : `#${(s as Team).name.replace(/\s+/g, '')}`;
                                                    const label = isUser ? (s as User).name : (s as Team).name;
                                                    return (
                                                        <div
                                                            key={s.id}
                                                            className="px-3 py-2 hover:bg-gray-50 cursor-pointer flex items-center gap-2"
                                                            onClick={() => insertMention(text)}
                                                        >
                                                            {isUser ? <Avatar user={s as User} size="xs" /> : <div className="w-5 h-5 rounded bg-purple-100 flex items-center justify-center"><Hash className="w-3 h-3 text-purple-600" /></div>}
                                                            <span className="text-sm text-gray-700">{label}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                        <div className="relative">
                                            <div 
                                                className="absolute inset-0 pointer-events-none p-3 text-sm whitespace-pre-wrap break-words min-h-[40px] max-h-[120px] overflow-hidden"
                                                aria-hidden="true"
                                            >
                                                {!newComment ? (
                                                    <span className="text-gray-400">Write a comment... Use @ to mention, # for teams</span>
                                                ) : (
                                                    renderTextWithMentions(newComment, true)
                                                )}
                                                {newComment.endsWith('\n') ? <br /> : null}
                                            </div>
                                            <textarea
                                                value={newComment}
                                                onChange={handleCommentChange}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                        e.preventDefault();
                                                        handleAddComment(e);
                                                    }
                                                }}
                                                className="w-full text-sm p-3 bg-transparent border-none outline-none resize-none min-h-[40px] max-h-[120px] text-transparent caret-gray-800 relative z-10"
                                                rows={1}
                                                onScroll={(e) => {
                                                    const overlay = e.currentTarget.previousElementSibling as HTMLElement;
                                                    if (overlay) {
                                                        overlay.scrollTop = e.currentTarget.scrollTop;
                                                    }
                                                }}
                                                onInput={e => {
                                                    const t = e.target as HTMLTextAreaElement;
                                                    t.style.height = 'auto';
                                                    t.style.height = Math.min(t.scrollHeight, 120) + 'px';
                                                }}
                                            />
                                        </div>
                                        <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100">
                                            <div className="flex gap-1 text-gray-400">
                                                <button type="button" onClick={() => { const prefix = newComment && !newComment.endsWith(' ') ? ' ' : ''; setNewComment(prev => prev + prefix + '@'); setMentionState({ type: '@', query: '' }); }} className="p-1.5 hover:bg-gray-100 rounded-lg hover:text-blue-600 transition-colors" title="Mention user">
                                                    <AtSign className="w-4 h-4" />
                                                </button>
                                                <button type="button" onClick={() => { const prefix = newComment && !newComment.endsWith(' ') ? ' ' : ''; setNewComment(prev => prev + prefix + '#'); setMentionState({ type: '#', query: '' }); }} className="p-1.5 hover:bg-gray-100 rounded-lg hover:text-purple-600 transition-colors" title="Tag team">
                                                    <Hash className="w-4 h-4" />
                                                </button>
                                            </div>
                                            <button
                                                type="submit"
                                                disabled={!newComment.trim()}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                            >
                                                <Send className="w-3.5 h-3.5" /> Send
                                            </button>
                                        </div>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Nested Subtask Panel ── */}
            {stackedSubtask && (
                <TaskDetailsPanel
                    task={stackedSubtask}
                    isOpen={true}
                    onClose={closeStackedSubtask}
                    currentUser={currentUser}
                    onStatusChange={onStatusChange}
                    isSubPanel={true}
                    parentTitle={task.title}
                    depth={depth + 1}
                    onNestedDepthChange={handleSubtaskDepthChange}
                    activeDepth={currentActiveDepth}
                    onActiveDepthChange={handleActiveDepthChange}
                />
            )}

            {/* Subtask right-click context menu */}
            {subtaskContextMenu && (() => {
                const ctxSub = allTasks.find(t => t.id === subtaskContextMenu.sid);
                return (
                    <div
                        className="fixed bg-white border border-gray-200 rounded-xl shadow-xl py-1 z-[9999] w-48"
                        style={{ top: subtaskContextMenu.y, left: subtaskContextMenu.x }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Duplicate */}
                        <button
                            onMouseDown={(e) => {
                                e.stopPropagation();
                                if (ctxSub) {
                                    const dup: Task = {
                                        ...ctxSub,
                                        id: `subtask-dup-${Date.now()}`,
                                        title: ctxSub.title + ' (copy)',
                                        createdDate: new Date().toISOString(),
                                    };
                                    allTasks.push(dup);
                                    const idx = localSubtaskIds.indexOf(subtaskContextMenu.sid);
                                    const newIds = [...localSubtaskIds];
                                    newIds.splice(idx + 1, 0, dup.id);
                                    setLocalSubtaskIds(newIds);
                                    task.subtaskIds = newIds;
                                }
                                setSubtaskContextMenu(null);
                            }}
                            className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center gap-2 text-sm text-gray-700"
                        >
                            <Copy className="w-4 h-4 text-gray-400" /> Duplicate subtask
                        </button>
                        <div className="border-t border-gray-100 my-1" />
                        {/* Delete */}
                        <button
                            onMouseDown={(e) => {
                                e.stopPropagation();
                                const newIds = localSubtaskIds.filter(id => id !== subtaskContextMenu.sid);
                                setLocalSubtaskIds(newIds);
                                task.subtaskIds = newIds;
                                setSubtaskContextMenu(null);
                            }}
                            className="w-full text-left px-4 py-2 hover:bg-red-50 flex items-center gap-2 text-sm text-red-600"
                        >
                            <Trash2 className="w-4 h-4" /> Delete subtask
                        </button>
                    </div>
                );
            })()}
        </>
    );
}
