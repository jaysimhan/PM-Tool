import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { captureOperationalError, recordOperationalTiming } from '../lib/observability';
import { useParams } from 'react-router-dom';
import OrganizationDashboard from './OrganizationDashboard';
import { DataContext, DataContextType } from '../contexts/DataContext';
import { supabase } from '../lib/supabaseClient';
import { Client, Region, Tag, Team, User } from '../types/types';
import { toSnapshot, type MetricMap, type SnapshotWindow } from '../lib/dashboardStats';
import { Logo } from './Logo';

/**
 * What the shareable link from "Share Dashboard" opens: /public/dashboard/<token>.
 *
 * Nobody here is signed in, so there is no DataContext worth reading — every table is closed
 * to the anon key. get_public_dashboard_cached(token) is the whole data source.
 *
 * It used to be get_public_dashboard, which aggregated the entire tasks table live and shipped
 * every task — id, status, dates, hours, brand, region, tags, teams — to the browser to be
 * counted there. That ran per visitor, on a URL whose only credential is a token that may have
 * been forwarded to anyone, with a cost that grew with the organisation. The cached function
 * returns last night's counts instead: a few dozen numbers and the names to label them, a
 * fixed size no matter how much work the organisation is doing, and not one task row.
 *
 * The names still go through a DataContext because OrganizationDashboard reads teams, brands,
 * regions and tags from there for its axes. The numbers are passed as a prop.
 */

interface PublicPayload {
    ok: boolean;
    reason?: 'not_found' | 'closed';
    publicAccess?: boolean;
    /** True when the nightly job has not produced a complete day yet. */
    pending?: boolean;
    asOf?: string;
    metrics?: MetricMap;
    teams?: { id: string; name: string; color: string }[];
    clients?: Client[];
    regions?: Region[];
    tags?: Tag[];
}

const PageLoader = () => (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
);

const Unavailable = ({ title, message }: { title: string; message: string }) => (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 max-w-md w-full text-center">
            <div className="flex justify-center mb-5">
                <Logo className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">{title}</h1>
            <p className="text-sm text-gray-500">{message}</p>
        </div>
    </div>
);

export default function PublicDashboard() {
    const { token } = useParams<{ token: string }>();
    const [payload, setPayload] = useState<PublicPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!token) {
            setLoading(false);
            return;
        }
        let cancelled = false;

        (async () => {
            const startedAt = performance.now();
            const { data, error: rpcError } = await supabase.rpc('get_public_dashboard_cached', { p_token: token });
            recordOperationalTiming('dashboard_rpc', performance.now() - startedAt, { rpc: 'cached_public_dashboard' });
            if (cancelled) return;
            if (rpcError) {
                captureOperationalError('dashboard_rpc', rpcError, { rpc: 'cached_public_dashboard' });
                setError(rpcError.message);
            }
            else setPayload(data as PublicPayload);
            setLoading(false);
        })();

        return () => { cancelled = true; };
    }, [token]);

    const noop = useCallback(async () => {}, []);

    // Labels only. There are no users and no tasks in this payload any more — the team
    // capacity bars read their member counts and hours out of the snapshot instead, so a
    // signed-out visitor never receives a person's id at all, not even an opaque one.
    const value = useMemo<DataContextType>(() => ({
        users: [] as User[],
        teams: (payload?.teams || []).map(t => ({
            id: t.id,
            name: t.name,
            color: t.color,
            memberIds: [],
            skillIds: [],
        })) as unknown as Team[],
        skills: [],
        workCategories: [],
        clients: payload?.clients || [],
        tasks: [],
        leaves: [],
        assignments: [],
        notifications: [],
        comments: [],
        allTags: payload?.tags || [],
        regions: payload?.regions || [],
        loading: false,
        loadIssues: [],
        retryDataLoad: noop,
        hasMoreTasks: false,
        loadingMoreTasks: false,
        loadMoreTasks: noop,
        refreshTasks: noop,
        refreshTeams: noop,
        refreshTags: noop,
        refreshRegions: noop,
        refreshClients: noop,
        refreshSkills: noop,
        refreshUsers: noop,
        refreshAssignments: noop,
        refreshNotifications: noop,
    }), [payload, noop]);

    // The numbers, in the same shape the signed-in dashboard reads from the snapshot table.
    // One day only: a shared link is a headline, not an analysis tool, so there is no range
    // control and no trend series behind it.
    const snapshotWindow = useMemo<SnapshotWindow>(() => ({
        latest: toSnapshot(payload?.asOf || null, payload?.metrics || {}),
        series: [],
        pending: payload?.pending === true,
    }), [payload]);

    if (loading) return <PageLoader />;

    // The old untokenised /public/dashboard, and anything else that arrives without a
    // credential. It used to render an empty dashboard, which read as "the org has no work".
    if (!token) {
        return (
            <Unavailable
                title="This dashboard link is out of date"
                message="Dashboard links now carry a token. Ask an admin to send you a fresh one from Share Dashboard."
            />
        );
    }

    if (error) {
        return <Unavailable title="Could not load this dashboard" message={error} />;
    }

    if (!payload?.ok) {
        return payload?.reason === 'closed'
            ? <Unavailable
                title="This dashboard is not shared right now"
                message="An admin has turned off public access to it."
              />
            : <Unavailable
                title="This dashboard link is not valid"
                message="Check the link, or ask whoever sent it for a current one."
              />;
    }

    return (
        <DataContext.Provider value={value}>
            <div className="min-h-screen bg-gray-50 p-8">
                <div className="max-w-7xl mx-auto">
                    {/* An admin previewing a link they have switched off, so the page does not
                        pretend to be live. */}
                    {payload.publicAccess === false && (
                        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                            Public access to this dashboard is off. You are seeing it because you
                            are signed in as an admin; the link shows nothing to anyone else.
                        </div>
                    )}
                    <OrganizationDashboard currentUser={null as any} isPublic={true} snapshot={snapshotWindow} />
                </div>
            </div>
        </DataContext.Provider>
    );
}
