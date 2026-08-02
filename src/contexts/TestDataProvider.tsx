import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DataContext, DataContextType } from './DataContext';
import { useAuth } from './AuthContext';
import { useTestEnvironment } from '../lib/testEnvironment';
import { onSandboxWrite, SandboxWrite } from '../lib/supabaseClient';
import { buildTestDataset } from '../data/testFixtures';
import { Task } from '../types/types';

/**
 * Feeds every page under /test from the fixtures instead of the database. Outside the test
 * environment it does nothing at all — children see the real DataProvider above it.
 *
 * Edits made in the sandbox are applied to this copy and nowhere else. The write itself was
 * already stopped at the client (see supabaseClient's test-environment guard); this only
 * picks up what it swallowed, so the screen agrees with what the person just did. Reload and
 * the fixtures are back.
 */

/** The task columns worth reflecting back — the ones the pages let you change. */
const TASK_COLUMN_MAP: Record<string, keyof Task> = {
    title: 'title',
    description: 'description',
    status: 'status',
    priority: 'priority',
    estimated_hours: 'estimatedHours',
    actual_hours: 'actualHours',
    due_date: 'dueDate',
    assignee_id: 'assignedToId',
    assigned_to_id: 'assignedToId',
    proposed_start_date: 'proposedStartDate',
    proposed_end_date: 'proposedEndDate',
    client_id: 'clientId',
    region_id: 'regionId',
    category_id: 'categoryId',
    completed_date: 'completedDate',
};

const applyTaskUpdate = (task: Task, values: any): Task => {
    const next: any = { ...task };
    Object.entries(values || {}).forEach(([column, value]) => {
        const field = TASK_COLUMN_MAP[column];
        if (field) next[field] = value;
    });
    return next as Task;
};

/** The ids an intercepted write was aimed at, from its .eq('id', …) / .in('id', […]). */
const targetIds = (write: SandboxWrite): string[] =>
    write.filters
        .filter(f => f.column === 'id')
        .flatMap(f => (Array.isArray(f.value) ? f.value : [f.value]))
        .map(String);

export function TestDataProvider({ children }: { children: React.ReactNode }) {
    const { profile } = useAuth();
    const inSandbox = useTestEnvironment(profile);
    const [dataset, setDataset] = useState(buildTestDataset);

    const applyWrite = useCallback((write: SandboxWrite) => {
        if (write.table !== 'tasks') return; // Everything else is swallowed and forgotten.
        const ids = targetIds(write);

        setDataset(prev => {
            if (write.op === 'update') {
                if (ids.length === 0) return prev;
                return { ...prev, tasks: prev.tasks.map(t => (ids.includes(t.id) ? applyTaskUpdate(t, write.values) : t)) };
            }
            if (write.op === 'delete') {
                if (ids.length === 0) return prev;
                return { ...prev, tasks: prev.tasks.filter(t => !ids.includes(t.id)) };
            }
            if (write.op === 'insert' || write.op === 'upsert') {
                const added = write.rows.map(row =>
                    applyTaskUpdate(
                        {
                            id: row.id,
                            requestId: row.request_id || row.id,
                            title: '',
                            description: '',
                            categoryId: '',
                            clientId: '',
                            requesterId: profile?.id || '',
                            status: 'new_request',
                            estimatedHours: 0,
                            dueDate: '',
                            createdDate: new Date().toISOString(),
                            teamIds: [],
                            requiredSkillIds: [],
                            subtaskIds: [],
                            dependencyIds: [],
                            linkedTaskIds: [],
                            tags: [],
                            isSubtask: false,
                        },
                        row
                    )
                );
                return { ...prev, tasks: [...added, ...prev.tasks] };
            }
            return prev;
        });
    }, [profile?.id]);

    useEffect(() => {
        if (!inSandbox) return;
        return onSandboxWrite(applyWrite);
    }, [inSandbox, applyWrite]);

    // Refreshing means re-reading the copy in hand; there is nothing to fetch.
    const noop = useCallback(async () => {}, []);

    const value = useMemo<DataContextType>(() => ({
        ...dataset,
        loading: false,
        refreshTasks: noop,
        refreshTeams: noop,
        refreshTags: noop,
        refreshRegions: noop,
        refreshClients: noop,
        refreshSkills: noop,
        refreshUsers: noop,
    }), [dataset, noop]);

    if (!inSandbox) return <>{children}</>;

    return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
