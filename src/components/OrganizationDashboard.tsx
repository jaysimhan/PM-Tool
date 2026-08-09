import React, { useState, useMemo, useEffect, useRef } from 'react';
import { User, Task } from '../types/types';
import { useData } from '../contexts/DataContext';
import { supabase } from '../lib/supabaseClient';
import { AlertCircle, CheckCircle, Clock, TrendingUp, Users as UsersIcon, Briefcase, Tag, Globe, Grid, Share2 } from 'lucide-react';
import { getStatusBadgeColor, formatStatusLabel, getPriorityColor, isTaskOverdue, isTaskDueSoon } from '../utils/capacityCalculations';
import toast from 'react-hot-toast';
import DistributionChart from './DistributionChart';
import StatusComparisonChart from './StatusComparisonChart';
import TrendChart from './TrendChart';
import AdminEmergentNeeds from './AdminEmergentNeeds';
import TaskActionWidget from './TaskActionWidget';
import {
    fetchSnapshotWindow, EMPTY_SNAPSHOT, EMPTY_STAGES,
    type SnapshotWindow, type TimeRange, type StageCounts,
} from '../lib/dashboardStats';

interface Props {
    currentUser: User;
    isPublic?: boolean;
    /**
     * Supplied by PublicDashboard, which gets the same figures from get_public_dashboard_cached
     * because a signed-out visitor cannot read daily_kpi_snapshots directly. When absent the
     * component reads the table itself.
     */
    snapshot?: SnapshotWindow;
}

const RANGE_LABELS: Record<TimeRange, string> = {
    week: 'Past week',
    month: 'Past month',
    quarter: 'Past quarter',
    year: 'Past year',
    lifetime: 'All time',
};

// Public dashboard shows a rolling window of teams: one slot swaps out at a time
// so every team gets airtime without the card growing past four rows.
const VISIBLE_TEAM_SLOTS = 4;
const TEAM_ROTATE_INTERVAL_MS = 4500;
const TEAM_SWAP_EXIT_MS = 400;

export default function OrganizationDashboard({ currentUser, isPublic, snapshot: providedSnapshot }: Props) {
    // Teams, brands, regions and tags are still read from the context: they are the labels on
    // the axes, they are small, and they are the same for everybody. What is NOT read here any
    // more is `tasks` -- this page used to count every task in the organisation on every
    // render, for every viewer, and that is now done once a night by aggregate_daily_kpis.
    const { teams, clients, regions, allTags } = useData();
    const [timeRange, setTimeRange] = useState<TimeRange>('month');
    const [sharing, setSharing] = useState(false);

    // The public dashboard is this same component behind a token, and it gets its numbers
    // from the cached RPC rather than from the table, so it passes them in.
    const [fetched, setFetched] = useState<SnapshotWindow | null>(null);
    const [loading, setLoading] = useState(!providedSnapshot);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        if (providedSnapshot) return;
        let cancelled = false;
        setLoading(true);
        setLoadError(null);

        fetchSnapshotWindow(timeRange)
            .then(result => { if (!cancelled) setFetched(result); })
            .catch(err => {
                if (cancelled) return;
                setLoadError(err?.message || 'Could not load the dashboard figures.');
            })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [timeRange, providedSnapshot]);

    const window_ = providedSnapshot || fetched;
    const snapshot = window_?.latest || EMPTY_SNAPSHOT;
    const series = window_?.series || [];
    const pending = window_?.pending ?? false;
    const stats = snapshot.stats;

    // The link is minted server-side and the token in it is the credential a signed-out
    // visitor arrives with, so the URL cannot be assembled here -- the first admin to press
    // this is the one who creates it. Anyone else gets the link that already exists, and is
    // told plainly when there is none.
    const shareDashboard = async () => {
        setSharing(true);
        try {
            const { data, error } = await supabase.rpc('get_or_create_dashboard_link');
            if (error) throw error;

            const url = `${window.location.origin}/public/dashboard/${data.token}`;
            await navigator.clipboard.writeText(url);
            toast.success(
                data.public_access
                    ? 'Public dashboard link copied to clipboard!'
                    : 'Link copied — but public access to it is currently off.'
            );
        } catch (err: any) {
            toast.error(err?.message || 'Could not create the dashboard link.');
        } finally {
            setSharing(false);
        }
    };

    // Team utilisation, read from the snapshot rather than recomputed. The arithmetic behind
    // it is unchanged -- outstanding hours against a week of the team's capacity -- it just
    // happens in aggregate_daily_kpis now, where it runs once instead of per viewer.
    const teamWorkload = useMemo(() => teams.map(team => {
        const capacity = snapshot.teamCapacity[team.id];
        const weekly = (capacity?.totalCapacity || 0) * 5;
        return {
            team,
            taskCount: capacity?.taskCount || 0,
            memberCount: capacity?.memberCount || 0,
            utilization: weekly > 0 ? ((capacity?.scheduledHours || 0) / weekly) * 100 : 0,
        };
    }), [teams, snapshot.teamCapacity]);

    // Rolling window of teams (rotates automatically if there are more than VISIBLE_TEAM_SLOTS)
    const rotateTeams = teamWorkload.length > VISIBLE_TEAM_SLOTS;
    const teamIdsKey = teamWorkload.map(({ team }) => team.id).join('|');
    const teamIdsRef = useRef<string[]>([]);
    teamIdsRef.current = teamWorkload.map(({ team }) => team.id);

    const [visibleTeamIds, setVisibleTeamIds] = useState<string[]>([]);
    const [exitingSlot, setExitingSlot] = useState<number | null>(null);

    // Keep the window in sync with the available teams (never repeating a team)
    useEffect(() => {
        const ids = teamIdsRef.current;
        const slotCount = Math.min(VISIBLE_TEAM_SLOTS, ids.length);
        setVisibleTeamIds(prev => {
            const kept = prev.filter(id => ids.includes(id)).slice(0, slotCount);
            const pool = ids.filter(id => !kept.includes(id));
            return [...kept, ...pool.slice(0, slotCount - kept.length)];
        });
    }, [teamIdsKey]);

    // Swap one random slot for a team that isn't currently on screen
    useEffect(() => {
        if (!rotateTeams) {
            setExitingSlot(null);
            return;
        }

        let swapTimer: ReturnType<typeof setTimeout>;
        const rotateTimer = setInterval(() => {
            const slot = Math.floor(Math.random() * VISIBLE_TEAM_SLOTS);
            setExitingSlot(slot);
            swapTimer = setTimeout(() => {
                setVisibleTeamIds(prev => {
                    const pool = teamIdsRef.current.filter(id => !prev.includes(id));
                    if (pool.length === 0 || slot >= prev.length) return prev;
                    const next = [...prev];
                    next[slot] = pool[Math.floor(Math.random() * pool.length)];
                    return next;
                });
                setExitingSlot(null);
            }, TEAM_SWAP_EXIT_MS);
        }, TEAM_ROTATE_INTERVAL_MS);

        return () => {
            clearInterval(rotateTimer);
            clearTimeout(swapTimer);
            setExitingSlot(null);
        };
    }, [rotateTeams, teamIdsKey]);

    const displayedTeamWorkload = rotateTeams
        ? visibleTeamIds
            .map(id => teamWorkload.find(({ team }) => team.id === id))
            .filter((entry): entry is typeof teamWorkload[number] => Boolean(entry))
        : teamWorkload;

    // The five stages, per dimension member. These used to be four passes over every task per
    // dimension -- clients × tasks, regions × tasks, tags × tasks, teams × tasks, on every
    // render -- and are now a lookup into the snapshot the database already grouped.
    //
    // task_stage() in the migration holds the same status groupings this component used to
    // define inline, so the buckets are identical; the definition just lives in one place now.
    const stagesFor = (map: Record<string, StageCounts>, id: string): StageCounts =>
        map[id] || EMPTY_STAGES;

    const statusData = useMemo(() => [
        { name: 'New Request', count: snapshot.stages.NewRequests, color: '#9CA3AF' },
        { name: 'Planning', count: snapshot.stages.Planning, color: '#A855F7' },
        { name: 'In Progress', count: snapshot.stages.InProgress, color: '#3B82F6' },
        { name: 'In Review', count: snapshot.stages.InReview, color: '#EAB308' },
        { name: 'On Hold', count: snapshot.stages.OnHold, color: '#EF4444' },
        { name: 'Completed', count: snapshot.stages.Completed, color: '#10B981' },
    ], [snapshot.stages]);

    const brandData = useMemo(
        () => clients.slice(0, 8).map(client => ({
            name: client.name, favicon: (client as any).favicon, ...stagesFor(snapshot.byClient, client.id),
        })),
        [clients, snapshot.byClient]
    );

    const regionData = useMemo(
        () => regions.slice(0, 8).map(region => ({
            name: region.name, flag: region.flag, ...stagesFor(snapshot.byRegion, region.id),
        })),
        [regions, snapshot.byRegion]
    );

    const tagsData = useMemo(
        () => allTags.slice(0, 8).map(tag => ({
            name: tag.name, color: tag.color, ...stagesFor(snapshot.byTag, tag.id),
        })),
        [allTags, snapshot.byTag]
    );

    const teamsData = useMemo(
        () => teams.slice(0, 8).map(team => ({
            name: team.name, color: team.color, ...stagesFor(snapshot.byTeam, team.id),
        })),
        [teams, snapshot.byTeam]
    );

    const asOfLabel = snapshot.asOf
        ? new Date(`${snapshot.asOf}T00:00:00`).toLocaleDateString('en-GB', {
            weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
        })
        : null;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-start">
                <div>
                    <h1 className="text-2xl font-semibold text-gray-900">Organization Dashboard</h1>
                    <p className="text-sm text-gray-600 mt-1">Overview of all teams, tasks, and capacity</p>
                    {/* Said plainly, because these are yesterday's numbers and somebody acting
                        on them needs to know that without having to be told twice. */}
                    {asOfLabel && (
                        <p className="text-xs text-gray-400 mt-1.5">
                            Data as of {asOfLabel} · taken nightly
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-4">
                    {/* The range no longer filters a task list by creation date — there is no
                        task list here any more. It picks how many nightly snapshots to read,
                        so the cards show the latest day and the trend shows the window. */}
                    {!isPublic && (
                        <select
                            value={timeRange}
                            onChange={(e) => setTimeRange(e.target.value as TimeRange)}
                            className="pl-3 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer"
                        >
                            {Object.entries(RANGE_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                            ))}
                        </select>
                    )}
                    {!isPublic && (
                        <button
                            onClick={shareDashboard}
                            disabled={sharing}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Share2 className="w-4 h-4" /> {sharing ? 'Preparing link…' : 'Share Dashboard'}
                        </button>
                    )}
                </div>
            </div>

            {/* Live, admin-only, and absent entirely when there is nothing wrong. Above the
                snapshot cards because it is the only thing on this page that is happening now. */}
            {!isPublic && currentUser && <AdminEmergentNeeds currentUser={currentUser} />}

            {loadError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    {loadError}
                </div>
            )}

            {/* The nightly job has not produced a complete day yet — which is the normal state
                for the first day after this ships. Zeros would read as "there is no work". */}
            {!loading && !loadError && pending && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    No daily snapshot has been taken yet. The first one runs tonight at 23:59;
                    until then these figures will read as zero.
                </div>
            )}

            {/* Key Metrics */}
            <div className={`grid grid-cols-4 gap-4 ${loading ? 'opacity-50' : ''}`}>
                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-gray-600">Total Requests</div>
                            <div className="text-2xl font-semibold text-gray-900 mt-1">{stats.totalRequests}</div>
                        </div>
                        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                            <Briefcase className="w-6 h-6 text-blue-600" />
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-gray-600">Active Tasks</div>
                            <div className="text-2xl font-semibold text-blue-600 mt-1">{stats.activeTasks}</div>
                        </div>
                        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                            <TrendingUp className="w-6 h-6 text-blue-600" />
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-gray-600">In Review</div>
                            <div className="text-2xl font-semibold text-orange-600 mt-1">{stats.inReview}</div>
                        </div>
                        <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                            <AlertCircle className="w-6 h-6 text-orange-600" />
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-gray-600">Overdue</div>
                            <div className="text-2xl font-semibold text-red-600 mt-1">{stats.overdueTasks}</div>
                        </div>
                        <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                            <Clock className="w-6 h-6 text-red-600" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Additional Stats Row */}
            <div className="grid grid-cols-4 gap-4">
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="text-sm text-gray-600">New Requests</div>
                    <div className="text-xl font-semibold text-gray-900 mt-1">{stats.newRequests}</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="text-sm text-gray-600">Unassigned</div>
                    <div className="text-xl font-semibold text-gray-900 mt-1">{stats.unassignedTasks}</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="text-sm text-gray-600">Due Soon (3 days)</div>
                    <div className="text-xl font-semibold text-yellow-600 mt-1">{stats.dueSoon}</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="text-sm text-gray-600">Completed</div>
                    <div className="text-xl font-semibold text-green-600 mt-1">{stats.completed}</div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
                {/* Team Capacity Overview */}
                <div className={`bg-white rounded-lg border border-gray-200 p-6 flex flex-col h-[400px] ${isPublic ? 'col-span-2' : ''}`}>
                    <div className="flex items-center justify-between mb-4 flex-shrink-0">
                        <h2 className="text-lg font-semibold text-gray-900">Team Capacity Overview</h2>
                        {rotateTeams && (
                            <span className="text-xs text-gray-400">
                                Showing {displayedTeamWorkload.length} of {teamWorkload.length} teams
                            </span>
                        )}
                    </div>
                    <div className={`flex-1 overflow-hidden ${isPublic ? 'grid grid-cols-2 gap-x-10 gap-y-4' : 'space-y-4'}`}>
                        {displayedTeamWorkload.map(({ team, taskCount, memberCount, utilization }, index) => (
                            <div key={rotateTeams ? `slot-${index}` : team.id}>
                                <div
                                    key={team.id}
                                    className={rotateTeams ? (exitingSlot === index ? 'team-slot-exit' : 'team-slot-enter') : undefined}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <div
                                                className="w-3 h-3 rounded"
                                                style={{ backgroundColor: team.color }}
                                            ></div>
                                            <span className="text-sm font-medium text-gray-900">{team.name}</span>
                                            <span className="text-xs text-gray-500">({memberCount} members)</span>
                                        </div>
                                        <div className="text-sm text-gray-600">{taskCount} active tasks</div>
                                    </div>
                                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full rounded-full transition-[width] duration-700 ease-out"
                                            style={{
                                                width: `${Math.min(100, utilization)}%`,
                                                backgroundColor: utilization >= 80 ? '#EF4444' : utilization >= 50 ? '#F59E0B' : '#10B981'
                                            }}
                                        ></div>
                                    </div>
                                    <div className="text-xs text-gray-500 mt-1">
                                        {utilization.toFixed(0)}% utilized
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Combined Task Approval and Review Widget */}
                {!isPublic && currentUser && (
                    <div className="h-full">
                        <TaskActionWidget currentUser={currentUser} />
                    </div>
                )}
            </div>

            {/* How the numbers moved over the selected range. */}
            <div className="mt-6">
                <TrendChart series={series} title={`Trend · ${RANGE_LABELS[timeRange]}`} />
            </div>

            {/* Status Comparison Chart */}
            <div className="mt-6">
                <StatusComparisonChart data={statusData} title="Task Status Comparison" />
            </div>

            <div className="grid grid-cols-2 gap-6 mt-6">
                {/* Work Distribution by Brand */}
                <div className="h-full">
                    <DistributionChart data={brandData} title="Work Distribution by Brand" />
                </div>

                {/* Work Distribution by Region */}
                <div className="h-full">
                    <DistributionChart data={regionData} title="Work Distribution by Region" />
                </div>

                {/* Work Distribution by Tags */}
                <div className="h-full">
                    <DistributionChart data={tagsData} title="Work Distribution by Tags" />
                </div>

                {/* Work Distribution by Teams */}
                <div className="h-full">
                    <DistributionChart data={teamsData} title="Work Distribution by Teams" />
                </div>
            </div>
        </div>
    );
}
