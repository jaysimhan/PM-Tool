import { supabase } from './supabaseClient';

/**
 * The dashboard's numbers, as the database now counts them.
 *
 * These shapes are deliberately the ones the chart components already take, so the charts
 * did not have to change when the counting moved server-side. `StageCounts` is what
 * DistributionChart draws a stacked bar from; `stages` on the whole org is what
 * StatusComparisonChart plots.
 *
 * Everything here comes from one row per metric in daily_kpi_snapshots. The aggregation that
 * writes them is the single definition of what each number means -- see
 * supabase/migrations/20260809140000_daily_kpi_snapshots.sql.
 */

export interface StageCounts {
    NewRequests: number;
    Planning: number;
    InProgress: number;
    InReview: number;
    OnHold: number;
    Completed: number;
    Total: number;
}

export const EMPTY_STAGES: StageCounts = {
    NewRequests: 0, Planning: 0, InProgress: 0, InReview: 0, OnHold: 0, Completed: 0, Total: 0,
};

export interface TeamCapacity {
    memberCount: number;
    totalCapacity: number;
    taskCount: number;
    scheduledHours: number;
}

export interface DashboardStats {
    totalRequests: number;
    newRequests: number;
    activeTasks: number;
    unassignedTasks: number;
    inReview: number;
    overdueTasks: number;
    dueSoon: number;
    completed: number;
    totalEstimatedHours: number;
    blockedTasks: number;
    awaitingAcceptance: number;
    createdThatDay: number;
    completedThatDay: number;
}

export interface DashboardSnapshot {
    /** The day these numbers describe. Null when no complete snapshot exists yet. */
    asOf: string | null;
    stats: DashboardStats;
    stages: StageCounts;
    byClient: Record<string, StageCounts>;
    byRegion: Record<string, StageCounts>;
    byTag: Record<string, StageCounts>;
    byTeam: Record<string, StageCounts>;
    teamCapacity: Record<string, TeamCapacity>;
    statusDistribution: Record<string, number>;
    priorityDistribution: Record<string, number>;
}

/** One row of the snapshot table, in either the table's shape or the public RPC's. */
export interface MetricRow {
    value: number;
    metadata?: Record<string, unknown> | null;
}

export type MetricMap = Record<string, MetricRow>;

export const EMPTY_STATS: DashboardStats = {
    totalRequests: 0, newRequests: 0, activeTasks: 0, unassignedTasks: 0, inReview: 0,
    overdueTasks: 0, dueSoon: 0, completed: 0, totalEstimatedHours: 0,
    blockedTasks: 0, awaitingAcceptance: 0, createdThatDay: 0, completedThatDay: 0,
};

export const EMPTY_SNAPSHOT: DashboardSnapshot = {
    asOf: null,
    stats: EMPTY_STATS,
    stages: EMPTY_STAGES,
    byClient: {}, byRegion: {}, byTag: {}, byTeam: {},
    teamCapacity: {}, statusDistribution: {}, priorityDistribution: {},
};

// numeric comes back from PostgREST as a string; every read of a metric goes through this.
const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
};

const readStages = (raw: unknown): StageCounts => {
    const o = (raw || {}) as Record<string, unknown>;
    return {
        NewRequests: num(o.NewRequests),
        Planning: num(o.Planning),
        InProgress: num(o.InProgress),
        InReview: num(o.InReview),
        OnHold: num(o.OnHold),
        Completed: num(o.Completed),
        Total: num(o.Total),
    };
};

const readStageMap = (raw: unknown): Record<string, StageCounts> => {
    const out: Record<string, StageCounts> = {};
    for (const [id, counts] of Object.entries((raw || {}) as Record<string, unknown>)) {
        out[id] = readStages(counts);
    }
    return out;
};

const readNumberMap = (raw: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries((raw || {}) as Record<string, unknown>)) out[k] = num(v);
    return out;
};

/** Turn the metric rows into the shape the dashboard renders. */
export function toSnapshot(asOf: string | null, metrics: MetricMap): DashboardSnapshot {
    const v = (name: string) => num(metrics[name]?.value);
    const meta = (name: string) => metrics[name]?.metadata;

    const teamCapacity: Record<string, TeamCapacity> = {};
    for (const [id, raw] of Object.entries((meta('team_capacity') || {}) as Record<string, any>)) {
        teamCapacity[id] = {
            memberCount: num(raw?.memberCount),
            totalCapacity: num(raw?.totalCapacity),
            taskCount: num(raw?.taskCount),
            scheduledHours: num(raw?.scheduledHours),
        };
    }

    return {
        asOf,
        stats: {
            totalRequests: v('total_requests'),
            newRequests: v('new_requests'),
            activeTasks: v('active_tasks'),
            unassignedTasks: v('unassigned_tasks'),
            inReview: v('in_review'),
            overdueTasks: v('overdue_tasks'),
            dueSoon: v('due_soon'),
            completed: v('completed_tasks'),
            totalEstimatedHours: v('total_estimated_hours'),
            blockedTasks: v('blocked_tasks'),
            awaitingAcceptance: v('awaiting_acceptance'),
            createdThatDay: v('created_that_day'),
            completedThatDay: v('completed_that_day'),
        },
        stages: readStages(meta('overall_stage_counts')),
        byClient: readStageMap(meta('client_stage_counts')),
        byRegion: readStageMap(meta('region_stage_counts')),
        byTag: readStageMap(meta('tag_stage_counts')),
        byTeam: readStageMap(meta('team_stage_counts')),
        teamCapacity,
        statusDistribution: readNumberMap(meta('status_distribution')),
        priorityDistribution: readNumberMap(meta('priority_distribution')),
    };
}

/** How many days back each range reaches. Used to pick the window of snapshots to read. */
export const RANGE_DAYS: Record<string, number> = {
    week: 7,
    month: 30,
    quarter: 90,
    year: 365,
    lifetime: 3650,
};

export type TimeRange = keyof typeof RANGE_DAYS;

export interface SnapshotWindow {
    /** The most recent complete day in range — what the cards show. */
    latest: DashboardSnapshot;
    /** Every complete day in range, oldest first — what the trend line plots. */
    series: { date: string; stats: DashboardStats }[];
    /** True when the nightly job has never produced a complete day yet. */
    pending: boolean;
}

/**
 * Read a window of daily snapshots.
 *
 * Only days carrying `snapshot_complete` are considered. backfill_daily_kpis reconstructs the
 * two metrics that can honestly be recovered for past days, and a day holding only those
 * would otherwise be picked as "the latest" and render a dashboard of zeros.
 *
 * Today is excluded: its snapshot is not written until 23:59, so it would be empty for most
 * of the day. Yesterday is the newest thing worth showing.
 */
export async function fetchSnapshotWindow(range: TimeRange): Promise<SnapshotWindow> {
    const days = RANGE_DAYS[range] ?? RANGE_DAYS.month;

    const end = new Date();
    end.setDate(end.getDate() - 1);
    const start = new Date(end);
    start.setDate(start.getDate() - days);

    const asDate = (d: Date) => d.toISOString().slice(0, 10);

    const { data, error } = await supabase
        .from('daily_kpi_snapshots')
        .select('snapshot_date, metric_name, metric_value, metadata')
        .gte('snapshot_date', asDate(start))
        .lte('snapshot_date', asDate(end))
        .order('snapshot_date', { ascending: true });

    if (error) throw error;

    // Group by date, then keep only the days the nightly job actually measured.
    const byDate = new Map<string, MetricMap>();
    for (const row of data || []) {
        const date = (row as any).snapshot_date as string;
        if (!byDate.has(date)) byDate.set(date, {});
        byDate.get(date)![(row as any).metric_name] = {
            value: num((row as any).metric_value),
            metadata: (row as any).metadata,
        };
    }

    const completeDates = [...byDate.keys()]
        .filter(d => byDate.get(d)!['snapshot_complete'] !== undefined)
        .sort();

    if (completeDates.length === 0) {
        return { latest: EMPTY_SNAPSHOT, series: [], pending: true };
    }

    const latestDate = completeDates[completeDates.length - 1];
    const latest = toSnapshot(latestDate, byDate.get(latestDate)!);

    const series = completeDates.map(date => ({
        date,
        stats: toSnapshot(date, byDate.get(date)!).stats,
    }));

    return { latest, series, pending: false };
}
