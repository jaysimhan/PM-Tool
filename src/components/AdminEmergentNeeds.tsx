import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { User } from '../types/types';
import { supabase, inTestSandbox } from '../lib/supabaseClient';
import { useData } from '../contexts/DataContext';
import { useAppPath } from '../lib/appNav';
import { startOfToday, getStatusBadgeColor, formatStatusLabel } from '../utils/capacityCalculations';

/**
 * The work that is going wrong right now.
 *
 * Everything else on this dashboard is yesterday's snapshot, which is the right resolution for
 * "how are we doing" and the wrong one for "what is on fire". This block is the exception: it
 * queries live and stays subscribed, because a task that has been blocked since this morning
 * is not something anyone should hear about tomorrow night.
 *
 * It is deliberately the ONLY live thing on the page. Keeping the exception small is what makes
 * the rest of the page cheap.
 *
 * When nothing is wrong it renders nothing at all — not an empty card, not an "all clear".
 * A block that is always present stops being read; one that only appears when it means
 * something is worth looking at.
 */

const EMERGENT_LIMIT = 12;
const STALE_ACCEPTANCE_HOURS = 48;

interface Props {
    currentUser: User;
}

interface EmergentTask {
    id: string;
    title: string;
    status: string;
    priority: string | null;
    dueDate: string | null;
    assigneeId: string | null;
    assignedDate: string | null;
    clientId: string | null;
    reasons: string[];
}

const ADMIN_ROLES = ['super_admin', 'admin'];

export default function AdminEmergentNeeds({ currentUser }: Props) {
    const { users, clients } = useData();
    const appPath = useAppPath();
    const [items, setItems] = useState<EmergentTask[]>([]);
    const [loaded, setLoaded] = useState(false);
    const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const isAdmin = ADMIN_ROLES.includes(currentUser?.role);

    const load = useCallback(async () => {
        if (!isAdmin || inTestSandbox()) return;

        const today = startOfToday().toISOString();
        const staleBefore = new Date(Date.now() - STALE_ACCEPTANCE_HOURS * 60 * 60 * 1000).toISOString();

        // One request, four conditions. Doing this as four queries — or by pulling every task
        // and filtering here — is what this whole change is moving away from.
        const { data, error } = await supabase
            .from('tasks')
            .select('id, title, status, priority, due_date, assignee_id, assigned_date, client_id')
            .or([
                'status.eq.blocked',
                `and(status.eq.awaiting_employee_approval,assigned_date.lt.${staleBefore})`,
                'and(priority.eq.urgent,assignee_id.is.null)',
                `and(due_date.lt.${today},status.not.in.(completed,cancelled))`,
            ].join(','))
            .order('due_date', { ascending: true, nullsFirst: false })
            .limit(EMERGENT_LIMIT);

        if (error) {
            // Quiet on purpose. This is a supplementary block on a page that works without it;
            // a toast here would fire on every reconnect for something nobody asked for.
            console.error('Could not load emergent work:', error.message);
            setLoaded(true);
            return;
        }

        const now = startOfToday().getTime();
        setItems((data || []).map((t: any) => {
            const reasons: string[] = [];
            if (t.due_date && new Date(t.due_date).getTime() < now
                && !['completed', 'cancelled'].includes(t.status)) reasons.push('Overdue');
            if (t.status === 'blocked') reasons.push('Blocked');
            if (t.priority === 'urgent' && !t.assignee_id) reasons.push('Urgent and unassigned');
            if (t.status === 'awaiting_employee_approval'
                && t.assigned_date
                && new Date(t.assigned_date).getTime() < Date.now() - STALE_ACCEPTANCE_HOURS * 3600_000) {
                reasons.push('Unaccepted for 48h');
            }
            return {
                id: t.id, title: t.title, status: t.status, priority: t.priority,
                dueDate: t.due_date, assigneeId: t.assignee_id, assignedDate: t.assigned_date,
                clientId: t.client_id,
                reasons: reasons.length ? reasons : ['Needs attention'],
            };
        }));
        setLoaded(true);
    }, [isAdmin]);

    useEffect(() => { load(); }, [load]);

    // Any task change can move a task into or out of this list — a due date edit, an
    // assignment, a status change — so this listens broadly and refetches rather than trying
    // to patch rows in place from the payload. Debounced, because a bulk edit arrives as a
    // burst and one refetch covers all of it.
    useEffect(() => {
        if (!isAdmin || inTestSandbox()) return;

        const channel = supabase
            .channel('emergent-tasks')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
                if (refetchTimer.current) clearTimeout(refetchTimer.current);
                refetchTimer.current = setTimeout(load, 1500);
            })
            .subscribe();

        return () => {
            if (refetchTimer.current) clearTimeout(refetchTimer.current);
            supabase.removeChannel(channel);
        };
    }, [isAdmin, load]);

    if (!isAdmin) return null;
    if (!loaded || items.length === 0) return null;

    return (
        <div className="bg-white rounded-xl border-2 border-red-200 p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
                <span className="relative flex h-2.5 w-2.5" title="Live">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                </span>
                <AlertTriangle className="w-5 h-5 text-red-500" />
                <h2 className="text-lg font-semibold text-gray-900">Needs attention now</h2>
                <span className="text-xs text-gray-500">
                    {items.length}{items.length === EMERGENT_LIMIT ? '+' : ''} item{items.length === 1 ? '' : 's'} · live
                </span>
            </div>

            <div className="space-y-2">
                {items.map(task => {
                    const assignee = task.assigneeId ? users.find(u => u.id === task.assigneeId) : null;
                    const client = task.clientId ? clients.find(c => c.id === task.clientId) : null;

                    return (
                        <div
                            key={task.id}
                            className="flex items-start justify-between gap-4 border border-gray-200 rounded-lg p-3 hover:border-red-300 transition-colors"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h3 className="text-sm font-medium text-gray-900 truncate">{task.title}</h3>
                                    <span className={`text-xs px-2 py-0.5 rounded ${getStatusBadgeColor(task.status)}`}>
                                        {formatStatusLabel(task.status)}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    {task.reasons.map(reason => (
                                        <span key={reason} className="text-xs font-medium text-red-700 bg-red-50 border border-red-100 rounded px-1.5 py-0.5">
                                            {reason}
                                        </span>
                                    ))}
                                    {client && <span className="text-xs text-gray-500">{client.name}</span>}
                                    <span className="text-xs text-gray-500">
                                        {assignee ? assignee.name : 'Unassigned'}
                                    </span>
                                </div>
                            </div>

                            <Link
                                to={appPath(`/tasks?task=${task.id}`)}
                                className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                            >
                                Take action
                            </Link>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
