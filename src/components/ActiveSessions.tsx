import React, { useCallback, useEffect, useState } from 'react';
import { Globe, Laptop, Loader2, LogOut, Monitor, Smartphone, Tablet } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useConfirm } from '../contexts/ConfirmContext';
import toast from 'react-hot-toast';

/**
 * Everywhere this account is signed in, and the means to end any of it.
 *
 * The rows come from auth.sessions through list_my_sessions(), which is scoped to the caller
 * -- there is no way to ask about anybody else. "Last active" is when that session last
 * refreshed its access token, which the client does roughly hourly while a tab is open, so it
 * is a real heartbeat rather than the sign-in time repeated back.
 *
 * The IP is shown as recorded and not resolved to a place. Turning one into a city means
 * handing it to a geo-IP service, and sending every employee's address to a third party is a
 * poor trade for a label -- the device and the last-active time are what actually identify a
 * session you do not recognise.
 */

interface Session {
    id: string;
    isCurrent: boolean;
    createdAt: string | null;
    lastActiveAt: string | null;
    userAgent: string | null;
    ip: string | null;
    aal: string | null;
}

/** Enough of a user-agent parse to recognise your own devices in a list. */
function describeDevice(userAgent: string | null): { label: string; kind: 'desktop' | 'mobile' | 'tablet' } {
    if (!userAgent) return { label: 'Unknown device', kind: 'desktop' };

    const ua = userAgent;
    const browser =
        /Edg\//.test(ua) ? 'Edge'
        : /OPR\/|Opera/.test(ua) ? 'Opera'
        : /Chrome\//.test(ua) && !/Chromium/.test(ua) ? 'Chrome'
        : /Firefox\//.test(ua) ? 'Firefox'
        : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari'
        : null;

    const os =
        /iPhone|iPod/.test(ua) ? 'iPhone'
        : /iPad/.test(ua) ? 'iPad'
        : /Android/.test(ua) ? 'Android'
        : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
        : /Windows NT/.test(ua) ? 'Windows'
        : /CrOS/.test(ua) ? 'ChromeOS'
        : /Linux/.test(ua) ? 'Linux'
        : null;

    const kind: 'desktop' | 'mobile' | 'tablet' =
        /iPad|Tablet/.test(ua) ? 'tablet'
        : /Mobile|iPhone|iPod|Android/.test(ua) ? 'mobile'
        : 'desktop';

    const label = browser && os ? `${browser} on ${os}` : browser || os || 'Unknown device';
    return { label, kind };
}

function relativeTime(value: string | null): string {
    if (!value) return 'Unknown';
    const then = new Date(value).getTime();
    if (Number.isNaN(then)) return 'Unknown';

    const seconds = Math.round((Date.now() - then) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} d ago`;
    return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function absoluteTime(value: string | null): string {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

const DeviceIcon = ({ kind }: { kind: 'desktop' | 'mobile' | 'tablet' }) => {
    const Icon = kind === 'mobile' ? Smartphone : kind === 'tablet' ? Tablet : Laptop;
    return <Icon className="w-5 h-5 text-gray-500" />;
};

export function ActiveSessions() {
    const { confirm } = useConfirm();
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [endingAll, setEndingAll] = useState(false);

    const load = useCallback(async () => {
        setError(null);
        const { data, error: rpcError } = await supabase.rpc('list_my_sessions');
        if (rpcError) {
            setError(rpcError.message);
            setLoading(false);
            return;
        }
        setSessions((data || []) as Session[]);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const endSession = (session: Session) => {
        const { label } = describeDevice(session.userAgent);
        confirm(
            session.isCurrent
                ? 'End this session? You are using it right now, so you will be signed out.'
                : `End the session on ${label}? That device will have to sign in again.`,
            async () => {
                setBusyId(session.id);
                try {
                    const { data, error: rpcError } = await supabase.rpc('revoke_my_session', {
                        p_session_id: session.id,
                    });
                    if (rpcError) {
                        toast.error(rpcError.message || 'Could not end that session.');
                        return;
                    }
                    if (data?.wasCurrent) {
                        await supabase.auth.signOut();
                        return;
                    }
                    setSessions(prev => prev.filter(s => s.id !== session.id));
                    toast.success('Session ended.');
                } finally {
                    setBusyId(null);
                }
            },
        );
    };

    const endAll = (keepCurrent: boolean) => {
        confirm(
            keepCurrent
                ? 'Sign out every other device? This one stays signed in.'
                : 'Sign out everywhere, including this device? You will have to sign in again.',
            async () => {
                setEndingAll(true);
                try {
                    const { data, error: rpcError } = await supabase.rpc('revoke_my_sessions', {
                        p_keep_current: keepCurrent,
                    });
                    if (rpcError) {
                        toast.error(rpcError.message || 'Could not end those sessions.');
                        return;
                    }
                    if (!keepCurrent) {
                        await supabase.auth.signOut();
                        return;
                    }
                    toast.success(
                        data?.ended === 1 ? '1 other session ended.' : `${data?.ended ?? 0} other sessions ended.`,
                    );
                    load();
                } finally {
                    setEndingAll(false);
                }
            },
        );
    };

    const otherCount = sessions.filter(s => !s.isCurrent).length;

    return (
        <div className="bg-white md:p-8 md:rounded-xl md:shadow-sm md:border md:border-gray-200">
            <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <Monitor className="w-5 h-5" />
                        Active Sessions
                    </h2>
                    <p className="text-xs text-gray-500 mt-1">
                        Everywhere this account is signed in. End anything you do not recognise.
                    </p>
                </div>
                {sessions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 justify-end">
                        {otherCount > 0 && (
                            <button
                                onClick={() => endAll(true)}
                                disabled={endingAll}
                                className="px-3 py-1.5 whitespace-nowrap text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 shadow-sm disabled:opacity-50"
                            >
                                End other sessions ({otherCount})
                            </button>
                        )}
                        <button
                            onClick={() => endAll(false)}
                            disabled={endingAll}
                            className="px-3 py-1.5 whitespace-nowrap text-sm font-medium rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50 shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                        >
                            {endingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                            End all sessions
                        </button>
                    </div>
                )}
            </div>

            {error && (
                <div className="mb-4 bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm border border-red-100">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading your sessions...
                </div>
            ) : sessions.length === 0 ? (
                <div className="text-sm text-gray-500 py-6 text-center border border-dashed border-gray-200 rounded-lg">
                    No active sessions found.
                </div>
            ) : (
                <div className="space-y-3">
                    {sessions.map(session => {
                        const { label, kind } = describeDevice(session.userAgent);

                        return (
                            <div
                                key={session.id}
                                className={`rounded-lg border p-4 ${
                                    session.isCurrent ? 'border-blue-200 bg-blue-50/40' : 'border-gray-200 bg-white'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex items-start gap-3 min-w-0">
                                        <div className="mt-0.5"><DeviceIcon kind={kind} /></div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h4 className="text-sm font-medium text-gray-900">{label}</h4>
                                                {session.isCurrent && (
                                                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-100 text-blue-700">
                                                        This device
                                                    </span>
                                                )}
                                                {session.aal === 'aal2' && (
                                                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-700">
                                                        2FA
                                                    </span>
                                                )}
                                            </div>

                                            <div className="mt-1.5 space-y-1 text-xs text-gray-600">
                                                <div className="flex items-center gap-1.5">
                                                    <Globe className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                                    {session.ip ? (
                                                        <span className="font-mono">{session.ip}</span>
                                                    ) : (
                                                        <span className="text-gray-400">Address not recorded</span>
                                                    )}
                                                </div>
                                                <div>
                                                    Last active {relativeTime(session.lastActiveAt)}
                                                    <span className="text-gray-400"> · {absoluteTime(session.lastActiveAt)}</span>
                                                </div>
                                                <div className="text-gray-400">
                                                    Signed in {absoluteTime(session.createdAt)}
                                                </div>
                                            </div>

                                            {session.userAgent && (
                                                <details className="mt-2">
                                                    <summary className="text-[11px] text-gray-400 cursor-pointer hover:text-gray-600">
                                                        Device details
                                                    </summary>
                                                    <p className="mt-1 text-[11px] text-gray-500 font-mono break-all">
                                                        {session.userAgent}
                                                    </p>
                                                </details>
                                            )}
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => endSession(session)}
                                        disabled={busyId === session.id}
                                        className="px-3 py-1.5 whitespace-nowrap shrink-0 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-red-50 hover:text-red-600 hover:border-red-200 shadow-sm disabled:opacity-50"
                                    >
                                        {busyId === session.id
                                            ? <Loader2 className="w-4 h-4 animate-spin" />
                                            : session.isCurrent ? 'Sign out' : 'End session'}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
