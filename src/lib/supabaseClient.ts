import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables');
}

/**
 * "Keep me signed in for 30 days".
 *
 * supabase-js keeps the session wherever its `storage` says, and it has no notion of one
 * that should last only as long as the browser is open, or that should expire on a
 * deadline. So the choice is made here: ticked, the session goes to localStorage and is
 * thrown away 30 days after sign-in; unticked, it goes to sessionStorage and dies with the
 * tab.
 *
 * The preference itself has to live in localStorage -- it is read before any session is, on
 * every page load, including the ones where sessionStorage is empty.
 *
 * A missing preference means localStorage. Anyone already signed in when this ships keeps
 * their session (with no deadline until their next sign-in) rather than being logged out by
 * the fix for being logged out.
 */
export const REMEMBER_ME_DAYS = 30;

const PERSISTENCE_KEY = 'pmweb.auth.persistence';   // 'local' | 'session'
const EXPIRES_AT_KEY = 'pmweb.auth.expires-at';     // epoch ms, only while persisting

const storageAvailable = () => {
    try {
        return typeof window !== 'undefined' && !!window.localStorage && !!window.sessionStorage;
    } catch {
        // Safari with cookies blocked throws on the property access itself.
        return false;
    }
};

const activeStore = (): Storage =>
    window.localStorage.getItem(PERSISTENCE_KEY) === 'session' ? window.sessionStorage : window.localStorage;

// supabase-js derives its own key from the project URL (sb-<ref>-auth-token). Matching the
// shape rather than hardcoding the ref keeps this working if the project ever moves.
const isAuthKey = (key: string) => /^sb-.*-auth-token/.test(key);

const clearAuthKeys = (store: Storage) => {
    for (const key of Object.keys(store)) {
        if (isAuthKey(key)) store.removeItem(key);
    }
};

/** True once the 30 days are up. No deadline set means it never expires on its own. */
export const sessionPersistenceExpired = (): boolean => {
    if (!storageAvailable()) return false;
    const raw = window.localStorage.getItem(EXPIRES_AT_KEY);
    if (!raw) return false;
    const expiresAt = Number(raw);
    return Number.isFinite(expiresAt) && Date.now() > expiresAt;
};

/** Call before signing in: it decides where the session about to be created will land. */
export const setSessionPersistence = (remember: boolean) => {
    if (!storageAvailable()) return;

    // Whichever store we are leaving must not keep a copy, or signing in with the box
    // unticked would still leave a session sitting in localStorage.
    clearAuthKeys(remember ? window.sessionStorage : window.localStorage);

    window.localStorage.setItem(PERSISTENCE_KEY, remember ? 'local' : 'session');
    if (remember) {
        window.localStorage.setItem(EXPIRES_AT_KEY, String(Date.now() + REMEMBER_ME_DAYS * 24 * 60 * 60 * 1000));
    } else {
        window.localStorage.removeItem(EXPIRES_AT_KEY);
    }
};

/** What the checkbox should show when the login screen loads. */
export const getSessionPersistence = (): boolean =>
    storageAvailable() && window.localStorage.getItem(PERSISTENCE_KEY) !== 'session';

/** Drops the deadline on sign-out so it cannot cut short the next person's session. */
export const clearSessionPersistence = () => {
    if (!storageAvailable()) return;
    window.localStorage.removeItem(EXPIRES_AT_KEY);
    clearAuthKeys(window.localStorage);
    clearAuthKeys(window.sessionStorage);
};

const authStorage = {
    getItem: (key: string): string | null => {
        if (!storageAvailable()) return null;
        if (isAuthKey(key) && sessionPersistenceExpired()) {
            clearSessionPersistence();
            return null;
        }
        return activeStore().getItem(key);
    },
    setItem: (key: string, value: string) => {
        if (storageAvailable()) activeStore().setItem(key, value);
    },
    removeItem: (key: string) => {
        if (!storageAvailable()) return;
        // Both: the session may have been written under the other preference.
        window.localStorage.removeItem(key);
        window.sessionStorage.removeItem(key);
    },
};

/** The real connection. Everything goes out through the guarded `supabase` export below. */
const liveClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { storage: authStorage },
});

// ── Test-environment guard ───────────────────────────────────────────────────
//
// The pages under /test run on invented data (src/data/testFixtures.ts). The rule that makes
// that a test environment rather than a second way into production is this one: while the
// browser is on a /test path, nothing that would change the real product is allowed onto the
// wire. Writes are intercepted here, at the only client in the app, so no page has to
// remember to opt out -- including pages nobody has thought about yet.
//
// Reads are left alone. Auth needs them (the profile behind the session is a real row), and
// the sandbox's ids all start with `test-`, so a query that goes out keyed on one matches
// nothing. What the pages actually display comes from the fixtures, not from here.

const TEST_PATH = /^\/test(\/|$)/;

/** True while the browser is somewhere under /test. */
export const inTestSandbox = () =>
    typeof window !== 'undefined' && TEST_PATH.test(window.location.pathname);

export type SandboxWrite = {
    table: string;
    op: 'insert' | 'update' | 'upsert' | 'delete' | 'rpc' | 'invoke';
    values: any;
    /** The .eq()/.match() narrowing the caller asked for, in the order it was given. */
    filters: { column: string; value: any }[];
    /** What the caller is handed back, so optimistic UI has something to work with. */
    rows: any[];
};

let sandboxSink: ((write: SandboxWrite) => void) | null = null;

/**
 * Watch the writes the sandbox swallowed. The test data provider uses this to apply them to
 * its in-memory copy, so editing something in /test looks like it worked -- which it did,
 * for as long as the tab is open.
 */
export const onSandboxWrite = (handler: (write: SandboxWrite) => void) => {
    sandboxSink = handler;
    return () => {
        if (sandboxSink === handler) sandboxSink = null;
    };
};

let sandboxRowCounter = 0;

/** Stands in for a PostgREST builder: chains like one, resolves without a request. */
function sandboxQuery(table: string, op: SandboxWrite['op'], values: any) {
    const filters: SandboxWrite['filters'] = [];
    const incoming = Array.isArray(values) ? values : values == null ? [] : [values];
    let wantsSingle = false;
    let settled: Promise<any> | null = null;

    const settle = () => {
        if (!settled) {
            // Callers routinely read the result back — `.insert(...).select().single()` and
            // then `.id` is everywhere — so the write is echoed. An update keeps the id it
            // was aimed at; an insert gets a fresh one, in the same `test-` namespace as the
            // fixtures so it can never be mistaken for a real row.
            const targetId = filters.find(f => f.column === 'id')?.value;
            const rows = incoming.map(row => ({
                id: op === 'insert' ? `test-${table}-${++sandboxRowCounter}` : targetId ?? `test-${table}-${++sandboxRowCounter}`,
                ...row,
            }));

            sandboxSink?.({ table, op, values, filters, rows });
            settled = Promise.resolve({
                // A stored procedure returns whatever it likes; nothing is a safer answer
                // than an echo of its arguments.
                data: op === 'rpc' ? null : wantsSingle ? rows[0] ?? null : rows,
                error: null,
                count: rows.length,
                status: 200,
                statusText: 'OK (test sandbox)',
            });
        }
        return settled;
    };

    const builder: any = new Proxy(
        {},
        {
            get(_target, prop) {
                if (prop === 'then') return (...args: any[]) => settle().then(...args);
                if (prop === 'catch') return (...args: any[]) => settle().catch(...args);
                if (prop === 'finally') return (...args: any[]) => settle().finally(...args);
                if (prop === 'single' || prop === 'maybeSingle') {
                    return () => {
                        wantsSingle = true;
                        return builder;
                    };
                }
                // eq('id', x), match({...}) and friends: remembered, then chained past.
                return (...args: any[]) => {
                    if (typeof args[0] === 'string' && args.length >= 2) {
                        filters.push({ column: args[0], value: args[1] });
                    } else if (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
                        Object.entries(args[0]).forEach(([column, value]) => filters.push({ column, value }));
                    }
                    return builder;
                };
            },
        }
    );

    return builder;
}

const sandboxFrom = (table: string) =>
    new Proxy(
        {},
        {
            get(_target, prop) {
                if (prop === 'insert' || prop === 'upsert') {
                    return (values: any) => sandboxQuery(table, prop as 'insert' | 'upsert', values);
                }
                if (prop === 'update') return (values: any) => sandboxQuery(table, 'update', values);
                if (prop === 'delete') return () => sandboxQuery(table, 'delete', undefined);

                const real = liveClient.from(table) as any;
                const value = real[prop];
                return typeof value === 'function' ? value.bind(real) : value;
            },
        }
    );

// A stored procedure is opaque from here -- match_skills only reads, delete_user_account very
// much does not -- so under /test they are all treated as writes and none of them run. Edge
// functions likewise: the invite and confirmation ones send real email.
const sandboxRpc = (fn: string, args?: any) => sandboxQuery(fn, 'rpc', args ? [args] : []);
const sandboxFunctions = {
    invoke: (fn: string, options?: any) => {
        sandboxSink?.({ table: fn, op: 'invoke', values: options?.body, filters: [], rows: [] });
        return Promise.resolve({ data: null, error: null });
    },
};

/**
 * The only client in the app, and it holds the anon key -- which is public by design and
 * carries no authority of its own.
 *
 * There used to be a second one here on the service role key, for the admin invite endpoints.
 * A `VITE_`-prefixed variable is inlined into the bundle at build time, so that key was being
 * served to every visitor: it bypasses RLS, reads every table and can mint a session for any
 * account. Those calls now go through the admin-invite Edge Function, which keeps the key on
 * the server and checks the caller's role before it does anything. See src/lib/adminInvite.ts.
 */
export const supabase: typeof liveClient = new Proxy(liveClient, {
    get(target, prop) {
        if (inTestSandbox()) {
            if (prop === 'from') return sandboxFrom;
            if (prop === 'rpc') return sandboxRpc;
            if (prop === 'functions') return sandboxFunctions;
        }
        const value = Reflect.get(target, prop);
        // Bound to the real client: these are class methods reaching for private state, and
        // handing them `this === proxy` breaks them.
        return typeof value === 'function' ? value.bind(target) : value;
    },
});
