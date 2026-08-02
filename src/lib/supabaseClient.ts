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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { storage: authStorage },
});

const supabaseServiceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

/**
 * Admin calls only (invites). It must not touch the session store: supabase-js derives the
 * storage key from the project URL alone, so without this both clients share
 * `sb-<ref>-auth-token` -- and both run an auto-refresh ticker against the same rotating
 * refresh token. Whichever one loses that race gets "Invalid Refresh Token: Already Used",
 * which auth-js treats as fatal and answers by clearing the session. That is a signed-in
 * user being logged out at random, and no "remember me" setting survives it.
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey || 'service-role-key', {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'pmweb-admin-no-session',
    },
});
