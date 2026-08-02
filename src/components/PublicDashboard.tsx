import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import OrganizationDashboard from './OrganizationDashboard';
import { DataContext, DataContextType } from '../contexts/DataContext';
import { supabase } from '../lib/supabaseClient';
import { Client, Region, Tag, Task, Team, User } from '../types/types';
import { Logo } from './Logo';

/**
 * What the shareable link from "Share Dashboard" opens: /public/dashboard/<token>.
 *
 * Nobody here is signed in, so there is no DataContext worth reading — every table is closed
 * to the anon key. get_public_dashboard(token) is the whole data source, and it hands back
 * only what the charts plot: statuses, dates, volumes, and the names of teams, brands,
 * regions and tags. No task titles and no people.
 *
 * That payload is then re-provided as a DataContext so OrganizationDashboard, which is the
 * same component the signed-in dashboard renders, needs to know none of this.
 */

interface PublicPayload {
    ok: boolean;
    reason?: 'not_found' | 'closed';
    publicAccess?: boolean;
    teams?: { id: string; name: string; color: string; memberIds: string[] }[];
    members?: { id: string; dailyCapacity: number }[];
    clients?: Client[];
    regions?: Region[];
    tags?: Tag[];
    tasks?: {
        id: string;
        status: string;
        createdDate: string;
        dueDate: string;
        estimatedHours: number;
        assigned: boolean;
        clientId: string | null;
        regionId: string | null;
        tagIds: string[];
        teamIds: string[];
    }[];
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
            const { data, error: rpcError } = await supabase.rpc('get_public_dashboard', { p_token: token });
            if (cancelled) return;
            if (rpcError) setError(rpcError.message);
            else setPayload(data as PublicPayload);
            setLoading(false);
        })();

        return () => { cancelled = true; };
    }, [token]);

    const noop = useCallback(async () => {}, []);

    // The shapes the dashboard reads, filled from the payload and left empty everywhere else:
    // a signed-out visitor gets no comments, no skills and no leave, and the page plots none
    // of them. Members carry an id and a capacity and nothing else, which is all the team
    // capacity bars are summing.
    const value = useMemo<DataContextType>(() => ({
        users: (payload?.members || []).map(m => ({
            id: m.id,
            name: '',
            email: '',
            role: 'team_member',
            skillIds: [],
            clientIds: [],
            regionIds: [],
            teamIds: [],
            dailyCapacity: m.dailyCapacity,
            isActive: true,
            onboardingCompleted: true,
            deletedAt: null,
        })) as unknown as User[],
        teams: (payload?.teams || []).map(t => ({
            id: t.id,
            name: t.name,
            color: t.color,
            memberIds: t.memberIds || [],
            skillIds: [],
        })) as unknown as Team[],
        skills: [],
        workCategories: [],
        clients: payload?.clients || [],
        tasks: (payload?.tasks || []).map(t => ({
            ...t,
            // Only ever read as "is this assigned to anybody", and the answer arrived as a
            // boolean precisely so the identity never left the database.
            assignedToId: t.assigned ? 'assigned' : undefined,
            tags: (t.tagIds || [])
                .map(id => (payload?.tags || []).find(g => g.id === id))
                .filter(Boolean),
        })) as unknown as Task[],
        leaves: [],
        assignments: [],
        notifications: [],
        comments: [],
        allTags: payload?.tags || [],
        regions: payload?.regions || [],
        loading: false,
        refreshTasks: noop,
        refreshTeams: noop,
        refreshTags: noop,
        refreshRegions: noop,
        refreshClients: noop,
        refreshSkills: noop,
        refreshUsers: noop,
    }), [payload, noop]);

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
                    <OrganizationDashboard currentUser={null as any} isPublic={true} />
                </div>
            </div>
        </DataContext.Provider>
    );
}
