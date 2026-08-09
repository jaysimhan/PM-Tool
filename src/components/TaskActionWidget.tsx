import React, { useMemo, useState } from 'react';
import { User, Task, Assignment } from '../types/types';
import { useData } from '../contexts/DataContext';
import { supabase, inTestSandbox } from '../lib/supabaseClient';
import { CheckCircle, XCircle, Clock, AlertTriangle, ChevronRight, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { getPriorityColor, formatStatusLabel, getStatusBadgeColor } from '../utils/capacityCalculations';
import AcceptTaskModal from './AcceptTaskModal';
import { useAppNavigate, useOpenTask } from '../lib/appNav';

interface Props {
    currentUser: User;
}

export default function TaskActionWidget({ currentUser }: Props) {
    const { tasks, assignments, clients, users, refreshTasks, refreshAssignments } = useData();
    const navigate = useAppNavigate();
    const openTask = useOpenTask();

    const pendingApprovals = useMemo(() => {
        return assignments
            .filter(a => a.userId === currentUser.id && a.status === 'pending')
            .map(assignment => ({ assignment, task: tasks.find(t => t.id === assignment.taskId) }))
            .filter((pair): pair is { assignment: Assignment; task: Task } => Boolean(pair.task))
            .sort((a, b) => new Date(b.assignment.assignedDate).getTime() - new Date(a.assignment.assignedDate).getTime());
    }, [assignments, tasks, currentUser.id]);

    const tasksNeedingAssignment = useMemo(() => {
        if (!['team_leader', 'manager', 'admin', 'super_admin'].includes(currentUser.role)) return [];
        return tasks.filter(t => t.status === 'manager_review_required');
    }, [tasks, currentUser.role]);

    const [accepting, setAccepting] = useState<{ task: Task; assignment: Assignment } | null>(null);

    const handleReject = async (assignment: Assignment) => {
        if (inTestSandbox()) {
            toast('Answering an assignment is switched off in the test environment.', { icon: '🧪' });
            return;
        }
        try {
            const { error } = await supabase.rpc('reject_assignment', {
                p_assignment_id: assignment.id,
                p_reason: 'Rejected from dashboard widget'
            });
            if (error) throw error;
            toast.success('Sent back for reassignment.');
            await Promise.all([refreshTasks(), refreshAssignments()]);
        } catch (err: any) {
            toast.error(err?.message || 'Could not send this back.');
        }
    };

    const hasActions = pendingApprovals.length > 0 || tasksNeedingAssignment.length > 0;

    if (!hasActions) {
        return (
            <div className="bg-white rounded-lg border border-gray-200 p-6 h-full flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mb-3">
                    <CheckCircle className="w-6 h-6 text-green-500" />
                </div>
                <h3 className="text-sm font-medium text-gray-900">All caught up!</h3>
                <p className="text-xs text-gray-500 mt-1 mb-4">No pending approvals or tasks needing review.</p>
                <button
                    onClick={() => navigate('/action-items')}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                    View Action Items Page →
                </button>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg border border-gray-200 flex flex-col h-[400px]">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-lg">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-orange-500" />
                    Action Items
                </h3>
                <button
                    onClick={() => navigate('/action-items')}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center"
                >
                    View All <ChevronRight className="w-4 h-4 ml-1" />
                </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {pendingApprovals.map(({ task, assignment }) => {
                    const client = clients.find(c => c.id === task.clientId);
                    return (
                        <div key={assignment.id} className="border border-yellow-200 bg-yellow-50 rounded-lg p-3">
                            <div className="flex justify-between items-start mb-2">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xs font-medium bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded">Approval Needed</span>
                                    </div>
                                    <h4 className="text-sm font-medium text-gray-900">{task.title}</h4>
                                    <p className="text-xs text-gray-500">{client?.name || 'Unknown client'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 mt-3">
                                <button
                                    onClick={() => setAccepting({ task, assignment })}
                                    className="flex-1 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-md hover:bg-green-700 transition-colors flex items-center justify-center gap-1"
                                >
                                    <CheckCircle className="w-3.5 h-3.5" /> Accept
                                </button>
                                <button
                                    onClick={() => handleReject(assignment)}
                                    className="flex-1 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-50 transition-colors flex items-center justify-center gap-1"
                                >
                                    <XCircle className="w-3.5 h-3.5" /> Reject
                                </button>
                            </div>
                        </div>
                    );
                })}

                {tasksNeedingAssignment.map(task => {
                    const client = clients.find(c => c.id === task.clientId);
                    return (
                        <div key={task.id} className="border border-orange-200 bg-orange-50 rounded-lg p-3">
                            <div className="flex justify-between items-start mb-2">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xs font-medium bg-orange-100 text-orange-800 px-1.5 py-0.5 rounded">Needs Assignment</span>
                                    </div>
                                    <h4 className="text-sm font-medium text-gray-900">{task.title}</h4>
                                    <p className="text-xs text-gray-500">{client?.name || 'Unknown client'}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => openTask(task.id)}
                                className="w-full mt-2 px-3 py-1.5 bg-white border border-orange-300 text-orange-700 text-xs font-medium rounded-md hover:bg-orange-100 transition-colors flex items-center justify-center gap-1"
                            >
                                <UserCheck className="w-3.5 h-3.5" /> Assign Task
                            </button>
                        </div>
                    );
                })}
            </div>

            {accepting && (
                <AcceptTaskModal
                    task={accepting.task}
                    assignment={accepting.assignment}
                    isOpen={true}
                    onClose={() => setAccepting(null)}
                />
            )}
        </div>
    );
}
