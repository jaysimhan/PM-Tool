import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Clock, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Assignment, Task } from '../types/types';
import { supabase, inTestSandbox } from '../lib/supabaseClient';
import { useData } from '../contexts/DataContext';
import { SingleDatePicker } from './SingleDatePicker';
import { useModalFocusTrap } from '../lib/useModalFocusTrap';

/**
 * Confirming a piece of work before taking it on.
 *
 * The deadline and the hours arrive filled in from whatever the requester or the assigner put
 * there, and both are editable -- the person who will do the work is the one who knows how
 * long it takes, which is the reason they are being asked at all. What they submit here is
 * what the task carries from now on.
 *
 * Opened from two places (the approvals page and the task details panel), which is why it
 * lives on its own rather than inside either of them.
 */

interface Props {
    task: Task;
    assignment: Assignment;
    isOpen: boolean;
    onClose: () => void;
    /** Fired after the database has agreed, before the refreshes settle. */
    onAccepted?: () => void;
}

/** A timestamp from the database, or an empty string, as the yyyy-MM-dd the picker speaks. */
const toDateInput = (value?: string | null): string => {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    // Local parts, not toISOString: a due date stored at 00:00 in a timezone behind UTC comes
    // back as the previous day otherwise, and the deadline quietly moves.
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${parsed.getFullYear()}-${month}-${day}`;
};

const prettyDate = (value: string): string =>
    value
        ? new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', {
              day: 'numeric', month: 'short', year: 'numeric'
          })
        : 'Pick a date';

function DateField({
    label, value, onChange, required, optional
}: {
    label: string;
    value: string;
    onChange: (next: string) => void;
    required?: boolean;
    optional?: boolean;
}) {
    const [open, setOpen] = useState(false);

    return (
        <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
                {label}
                {required && <span className="text-red-500 ml-0.5">*</span>}
                {optional && <span className="text-gray-400 font-normal ml-1">optional</span>}
            </label>
            <div className="relative">
                <button
                    type="button"
                    onClick={() => setOpen(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                >
                    <span className={value ? 'text-gray-900' : 'text-gray-400'}>{prettyDate(value)}</span>
                    <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0" />
                </button>
                {open && (
                    <SingleDatePicker
                        date={value}
                        onChange={onChange}
                        onClose={() => setOpen(false)}
                    />
                )}
            </div>
        </div>
    );
}

export default function AcceptTaskModal({ task, assignment, isOpen, onClose, onAccepted }: Props) {
    const dialogRef = useRef<HTMLDivElement>(null);
    useModalFocusTrap(isOpen, onClose, dialogRef);
    const { refreshTasks, refreshAssignments } = useData();

    const [deadline, setDeadline] = useState('');
    const [hours, setHours] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Reset to what is on record each time it opens, so a cancelled edit does not persist
    // into the next task somebody reviews.
    useEffect(() => {
        if (!isOpen) return;
        setDeadline(toDateInput(task.dueDate));
        const preset = assignment.estimatedHours ?? task.estimatedHours;
        setHours(preset && preset > 0 ? String(preset) : '');
        setStartDate(toDateInput(assignment.proposedStartDate || task.proposedStartDate));
        setEndDate(toDateInput(assignment.proposedEndDate || task.proposedEndDate));
    }, [isOpen, task, assignment]);

    // What was asked for, held separately from what is in the boxes, so the modal can say
    // plainly that it is about to change it. The database records the same comparison; this is
    // so nobody is surprised by the entry that shows up in the history afterwards.
    const requested = useMemo(() => ({
        dueDate: toDateInput(task.dueDate),
        hours: task.estimatedHours && task.estimatedHours > 0 ? task.estimatedHours : null
    }), [task.dueDate, task.estimatedHours]);

    const hoursValue = Number(hours);
    const movedDate = !!requested.dueDate && deadline !== requested.dueDate;
    const movedHours = requested.hours !== null && Number.isFinite(hoursValue) && hoursValue !== requested.hours;

    const problem = useMemo(() => {
        if (!deadline) return 'Set a deadline.';
        if (!hours.trim()) return 'Set the hours you expect this to take.';
        if (!Number.isFinite(hoursValue) || hoursValue <= 0) return 'Hours must be greater than zero.';
        if (startDate && endDate && endDate < startDate) return 'The end date cannot fall before the start date.';
        return null;
    }, [deadline, hours, hoursValue, startDate, endDate]);

    if (!isOpen) return null;

    const handleSubmit = async () => {
        if (problem) {
            toast.error(problem);
            return;
        }

        // The sandbox stubs rpc() out and answers with a success it did not perform. Saying so
        // beats a toast claiming the task was accepted while the card stays where it was.
        if (inTestSandbox()) {
            toast('Accepting a task is switched off in the test environment.', { icon: '🧪' });
            onClose();
            return;
        }

        setSubmitting(true);
        try {
            const { error } = await supabase.rpc('accept_assignment', {
                p_assignment_id: assignment.id,
                p_deadline: deadline,
                p_estimated_hours: hoursValue,
                p_start_date: startDate || null,
                p_end_date: endDate || null
            });
            if (error) throw error;

            toast.success('Task accepted.');
            onAccepted?.();
            onClose();
            await Promise.all([refreshTasks(), refreshAssignments()]);
        } catch (err: any) {
            toast.error(err?.message || 'Could not accept this task.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="accept-task-title" tabIndex={-1} className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                <div className="flex items-start justify-between p-5 border-b border-gray-100">
                    <div className="pr-4">
                        <h2 id="accept-task-title" className="text-lg font-semibold text-gray-900">Accept this task</h2>
                        <p className="text-sm text-gray-500 mt-0.5">{task.title}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    <p className="text-sm text-gray-600">
                        Confirm the deadline and how long you expect this to take. These are the
                        figures the task will carry, so change them if they are wrong.
                    </p>

                    <div className="grid grid-cols-2 gap-4">
                        <DateField label="Deadline" value={deadline} onChange={setDeadline} required />

                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                Estimated hours<span className="text-red-500 ml-0.5">*</span>
                            </label>
                            <div className="relative">
                                <Clock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                                <input
                                    type="number"
                                    min={0.5}
                                    step={0.5}
                                    value={hours}
                                    onChange={e => setHours(e.target.value)}
                                    placeholder="0.0"
                                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <DateField label="Proposed start" value={startDate} onChange={setStartDate} optional />
                        <DateField label="Proposed end" value={endDate} onChange={setEndDate} optional />
                    </div>

                    <p className="text-xs text-gray-500">
                        Giving a start or end date schedules the task. Leave them blank to accept
                        it without committing to dates yet.
                    </p>

                    {(movedDate || movedHours) && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                            <p className="text-xs font-medium text-amber-900">
                                This changes what was requested, and will be noted in the task's history.
                            </p>
                            <ul className="mt-1 space-y-0.5">
                                {movedHours && (
                                    <li className="text-xs text-amber-800">
                                        Hours requested: <span className="font-medium">{requested.hours}</span>
                                        {' → '}you are agreeing to <span className="font-medium">{hours}</span>
                                    </li>
                                )}
                                {movedDate && (
                                    <li className="text-xs text-amber-800">
                                        Due date requested: <span className="font-medium">{prettyDate(requested.dueDate)}</span>
                                        {' → '}you are agreeing to <span className="font-medium">{prettyDate(deadline)}</span>
                                    </li>
                                )}
                            </ul>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-3 px-5 py-4 bg-gray-50 border-t border-gray-100">
                    <button
                        onClick={onClose}
                        disabled={submitting}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={submitting || !!problem}
                        title={problem || undefined}
                        className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                    >
                        {submitting ? 'Accepting…' : 'Accept task'}
                    </button>
                </div>
            </div>
        </div>
    );
}
