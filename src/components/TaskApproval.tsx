import React, { useMemo, useState } from 'react';
import { Assignment, Task, User } from '../types/types';
import { useData } from '../contexts/DataContext';
import { supabase, inTestSandbox } from '../lib/supabaseClient';
import { CheckCircle, XCircle, Clock, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';
import { getPriorityColor, getStatusBadgeColor, formatStatusLabel } from '../utils/capacityCalculations';
import AcceptTaskModal from './AcceptTaskModal';

/**
 * What is waiting on this person before it becomes theirs.
 *
 * This screen used to run on src/data/mockData: it listed invented tasks, and its two buttons
 * wrote a line to the console. The assignments table it should always have been reading now
 * has rows in it, and the buttons answer them.
 */

interface Props {
    currentUser: User;
    hideHeader?: boolean;
}

const formatDateTime = (value?: string) =>
    value
        ? new Date(value).toLocaleDateString('en-GB', {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
          })
        : '—';

const formatDay = (value?: string) =>
    value
        ? new Date(value).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
        : '—';

export default function TaskApproval({ currentUser, hideHeader }: Props) {
    const { tasks, assignments, clients, workCategories, users, refreshTasks, refreshAssignments } = useData();

    const [accepting, setAccepting] = useState<{ task: Task; assignment: Assignment } | null>(null);
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // An offer is a row in assignments; the task is what it is an offer of. Pairing them here
    // means a pending row whose task has since been deleted drops out rather than rendering a
    // card with nothing on it.
    const pending = useMemo(() => {
        return assignments
            .filter(a => a.userId === currentUser.id && a.status === 'pending')
            .map(assignment => ({ assignment, task: tasks.find(t => t.id === assignment.taskId) }))
            .filter((pair): pair is { assignment: Assignment; task: Task } => Boolean(pair.task))
            .sort((a, b) => new Date(b.assignment.assignedDate).getTime() - new Date(a.assignment.assignedDate).getTime());
    }, [assignments, tasks, currentUser.id]);

    const closeReject = () => {
        setRejectingId(null);
        setReason('');
    };

    const handleReject = async (assignment: Assignment) => {
        if (!reason.trim()) {
            toast.error('Say why, so whoever assigned it can place it somewhere better.');
            return;
        }

        if (inTestSandbox()) {
            toast('Answering an assignment is switched off in the test environment.', { icon: '🧪' });
            closeReject();
            return;
        }

        setSubmitting(true);
        try {
            const { error } = await supabase.rpc('reject_assignment', {
                p_assignment_id: assignment.id,
                p_reason: reason.trim()
            });
            if (error) throw error;

            toast.success('Sent back for reassignment.');
            closeReject();
            await Promise.all([refreshTasks(), refreshAssignments()]);
        } catch (err: any) {
            toast.error(err?.message || 'Could not send this back.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-6">
            {!hideHeader && (
                <div>
                    <h1 className="text-2xl font-semibold text-gray-900">Task Approvals</h1>
                    <p className="text-sm text-gray-600 mt-1">Review and accept tasks assigned to you</p>
                </div>
            )}

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-yellow-600" />
                    <span className="text-sm font-medium text-yellow-900">
                        You have {pending.length} task{pending.length !== 1 ? 's' : ''} waiting for your approval
                    </span>
                </div>
            </div>

            {pending.length === 0 ? (
                <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle className="w-8 h-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">All caught up!</h3>
                    <p className="text-sm text-gray-500">You don't have any pending task assignments</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {pending.map(({ task, assignment }) => {
                        const client = clients.find(c => c.id === task.clientId);
                        const category = workCategories.find(c => c.id === task.categoryId);
                        const assigner = assignment.assignedById
                            ? users.find(u => u.id === assignment.assignedById)
                            : null;
                        const isRejecting = rejectingId === assignment.id;

                        return (
                            <div key={assignment.id} className="bg-white rounded-lg border-2 border-yellow-300 shadow-sm">
                                <div className="p-6">
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-2">
                                                <div
                                                    className="w-3 h-3 rounded-full"
                                                    style={{ backgroundColor: getPriorityColor(task.priority || 'normal') }}
                                                ></div>
                                                <h3 className="text-lg font-semibold text-gray-900">{task.title}</h3>
                                                <span className={`text-xs px-2 py-1 rounded ${getStatusBadgeColor(task.status)}`}>
                                                    {formatStatusLabel(task.status)}
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-600">{task.description}</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-4 gap-4 mb-6 p-4 bg-gray-50 rounded-lg">
                                        <div>
                                            <div className="text-xs text-gray-500 mb-1">Brand</div>
                                            <div className="text-sm font-medium text-gray-900">{client?.name || '—'}</div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500 mb-1">Category</div>
                                            <div className="text-sm font-medium text-gray-900">{category?.name || '—'}</div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500 mb-1">Estimated Hours</div>
                                            <div className="text-sm font-medium text-gray-900">
                                                {assignment.estimatedHours ?? task.estimatedHours
                                                    ? `${assignment.estimatedHours ?? task.estimatedHours} hours`
                                                    : 'Not set'}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500 mb-1">Due Date</div>
                                            <div className="text-sm font-medium text-gray-900">
                                                {task.dueDate
                                                    ? new Date(task.dueDate).toLocaleDateString('en-GB', {
                                                          day: 'numeric', month: 'short', year: 'numeric'
                                                      })
                                                    : 'Not set'}
                                            </div>
                                        </div>
                                    </div>

                                    {(assignment.proposedStartDate || assignment.proposedEndDate) && (
                                        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Calendar className="w-4 h-4 text-blue-600" />
                                                <span className="text-sm font-medium text-blue-900">Proposed Schedule</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <div className="text-xs text-blue-700 mb-1">Start Date</div>
                                                    <div className="text-sm font-medium text-blue-900">
                                                        {formatDay(assignment.proposedStartDate)}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-xs text-blue-700 mb-1">End Date</div>
                                                    <div className="text-sm font-medium text-blue-900">
                                                        {formatDay(assignment.proposedEndDate)}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="mb-6">
                                        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium" style={{
                                            backgroundColor: `${getPriorityColor(task.priority || 'normal')}20`,
                                            color: getPriorityColor(task.priority || 'normal')
                                        }}>
                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getPriorityColor(task.priority || 'normal') }}></div>
                                            {(task.priority || 'normal').toUpperCase()} PRIORITY
                                        </span>
                                    </div>

                                    {isRejecting ? (
                                        <div className="space-y-3">
                                            <label className="block text-sm font-medium text-gray-700">
                                                Why does this need reassigning?
                                            </label>
                                            <textarea
                                                value={reason}
                                                onChange={e => setReason(e.target.value)}
                                                rows={3}
                                                autoFocus
                                                placeholder="Already at capacity this week, or this needs a skill I don't have…"
                                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                            <div className="flex items-center gap-3">
                                                <button
                                                    onClick={() => handleReject(assignment)}
                                                    disabled={submitting || !reason.trim()}
                                                    className="px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                                                >
                                                    {submitting ? 'Sending…' : 'Send back'}
                                                </button>
                                                <button
                                                    onClick={closeReject}
                                                    disabled={submitting}
                                                    className="px-4 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-3">
                                            <button
                                                onClick={() => setAccepting({ task, assignment })}
                                                className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 flex items-center justify-center gap-2 transition-colors"
                                            >
                                                <CheckCircle className="w-5 h-5" />
                                                Accept Assignment
                                            </button>
                                            <button
                                                onClick={() => { setRejectingId(assignment.id); setReason(''); }}
                                                className="flex-1 px-4 py-3 bg-white border-2 border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 flex items-center justify-center gap-2 transition-colors"
                                            >
                                                <XCircle className="w-5 h-5" />
                                                Request Reassignment
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
                                    Assigned {assigner ? `by ${assigner.name} ` : ''}on {formatDateTime(assignment.assignedDate)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

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
