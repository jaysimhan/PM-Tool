import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { supabase, sessionPersistenceExpired, clearSessionPersistence } from '../lib/supabaseClient';
import { User } from '../types/types';

interface AuthContextType {
    session: Session | null;
    user: SupabaseUser | null;
    profile: User | null;
    loading: boolean;
    mfaRequired: boolean;
    recoveryMode: boolean;
    clearRecoveryMode: () => void;
    signOut: () => Promise<void>;
    updateProfile: (updates: Partial<User>) => Promise<void>;
    refreshProfile: () => Promise<void>;
    checkMfa: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** When the access token in hand was issued, in ms. Null if it cannot be read. */
const tokenIssuedAt = (accessToken?: string | null): number | null => {
    if (!accessToken) return null;
    try {
        const payload = accessToken.split('.')[1];
        const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
        return typeof claims.iat === 'number' ? claims.iat * 1000 : null;
    } catch {
        return null;
    }
};

// Reconciles one of the person-to-thing join tables against the exact set of ids they picked.
// Diffed rather than deleted-and-reinserted so a save that only adds one row does not churn
// the rest, and so a failed insert cannot leave somebody with nothing.
async function saveUserLinks(table: string, column: string, userId: string, ids: string[]) {
    const { data: existingRows, error: readError } = await supabase
        .from(table)
        .select(column)
        .eq('user_id', userId);
    if (readError) throw readError;

    const desired = new Set(ids);
    const existing = new Set((existingRows || []).map((r: any) => r[column]));
    const toAdd = [...desired].filter(id => !existing.has(id));
    const toRemove = [...existing].filter(id => !desired.has(id));

    if (toRemove.length > 0) {
        const { error } = await supabase
            .from(table)
            .delete()
            .eq('user_id', userId)
            .in(column, toRemove);
        if (error) throw error;
    }

    if (toAdd.length > 0) {
        const { error } = await supabase
            .from(table)
            .insert(toAdd.map(id => ({ user_id: userId, [column]: id })));
        if (error) throw error;
    }
}

// All three are shared with onboarding, which writes them before a profile is in context.
export const saveUserSkills = (userId: string, skillIds: string[]) =>
    saveUserLinks('user_skills', 'skill_id', userId, skillIds);

// The brands and regions someone wants work from. Round-robin assignment reads these.
export const saveUserClients = (userId: string, clientIds: string[]) =>
    saveUserLinks('user_clients', 'client_id', userId, clientIds);

export const saveUserRegions = (userId: string, regionIds: string[]) =>
    saveUserLinks('user_regions', 'region_id', userId, regionIds);

/**
 * True unless the account behind the session in hand has been deleted.
 *
 * A JWT keeps working after its user is gone: it is signed, unexpired and parses fine, so
 * getSession() hands it back and the app carries on as somebody who no longer exists. Nothing
 * shows until a write is attempted, and then GoTrue answers "User from sub claim in JWT does not
 * exist" -- which arrives at whichever form was submitted, so the screen reports it as a failure
 * to save rather than as a session that has to end. Onboarding is where it hurt: an invitee whose
 * first account was deleted and who was then re-invited still held the first session, and every
 * attempt to set a password failed on a dead sub, with no way out of the screen.
 *
 * getUser() is the check, because unlike getSession() it asks the server. Only a definite "that
 * user is not here" counts: a network blip must not sign people out.
 */
const sessionUserWasDeleted = async (): Promise<boolean> => {
    const { error } = await supabase.auth.getUser();
    // Only an explicit "that user is not here" ends a session. Anything vaguer -- a timeout, a
    // 500, an answer we do not recognise -- leaves it alone: wrongly signing everyone out is a
    // far worse failure than leaving one dead session to be caught at the next write.
    if (!error) return false;

    const message = (error.message || '').toLowerCase();
    const code = ((error as { code?: string }).code || '').toLowerCase();
    return (
        code === 'user_not_found' ||
        message.includes('sub claim') ||
        message.includes('user not found') ||
        message.includes('user from sub claim')
    );
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<SupabaseUser | null>(null);
    const [profile, setProfile] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [mfaRequired, setMfaRequired] = useState(false);
    // True from the moment a password-reset link is opened until the reset is finished or
    // abandoned. It is the only thing that lets Security Settings ask for a new password
    // without asking for the old one first -- the person following that link does not have it.
    const [recoveryMode, setRecoveryMode] = useState(false);
    // users.sessions_revoked_at, as of the last profile load. Set when an admin removes
    // somebody from their team or deactivates them.
    const [sessionsRevokedAt, setSessionsRevokedAt] = useState<string | null>(null);
    // The account id whose existence has already been confirmed with the server. See adopt().
    const validatedUserId = useRef<string | null>(null);

    useEffect(() => {
        // Nothing is put in front of a session until the account behind it is known to still
        // exist. A local sign-out is enough and is deliberate: the server has no session to end
        // for a user it does not have, and asking it to would fail on the same dead sub.
        //
        // Checked once per account rather than per event: onAuthStateChange also fires on every
        // hourly token refresh, and an account cannot come back from deletion, so re-asking buys
        // nothing and costs a request each time.
        const adopt = async (session: Session | null) => {
            const uid = session?.user?.id;
            const unchecked = uid && uid !== validatedUserId.current;
            if (unchecked && await sessionUserWasDeleted()) {
                await supabase.auth.signOut({ scope: 'local' });
                clearSessionPersistence();
                setSession(null);
                setUser(null);
                setProfile(null);
                setMfaRequired(false);
                setLoading(false);
                return;
            }

            if (uid) validatedUserId.current = uid;
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                await checkMfa();
                fetchProfile(session.user.id);
            } else {
                setProfile(null);
                setMfaRequired(false);
                setLoading(false);
            }
        };

        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => adopt(session));

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            // Fired when supabase-js consumes the token out of a reset link. It is the only
            // signal that distinguishes "arrived here from their email" from "signed in".
            if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
            if (event === 'SIGNED_OUT') setRecoveryMode(false);

            // A sign-out we just performed ourselves needs no re-checking, and re-checking it
            // would ask GoTrue about a user we already know is gone.
            if (event === 'SIGNED_OUT' || !session) {
                setSession(null);
                setUser(null);
                setProfile(null);
                setMfaRequired(false);
                setLoading(false);
                return;
            }

            await adopt(session);
        });

        return () => subscription.unsubscribe();
    }, []);

    // Two ways a session should stop being one, both checked when the tab is looked at.
    //
    // The 30 days are enforced by the storage adapter, which only gets consulted when the
    // session is read back -- a tab left open for a month would otherwise sail past the
    // deadline on the copy it already holds in memory.
    //
    // A revocation is the admin end of it: being removed from a team or deactivated deletes
    // the rows in auth.sessions, but the access token already issued stays valid until it
    // expires. Comparing the revocation against the moment this token was issued closes that
    // window, and only for tokens older than the revocation -- so signing in afterwards
    // works normally instead of being bounced straight back out.
    useEffect(() => {
        if (!session) return;

        const endExpiredSession = () => {
            if (document.visibilityState !== 'visible') return;
            if (sessionPersistenceExpired()) {
                supabase.auth.signOut();
                return;
            }
            const issuedAt = tokenIssuedAt(session.access_token);
            if (sessionsRevokedAt && issuedAt && issuedAt < new Date(sessionsRevokedAt).getTime()) {
                supabase.auth.signOut();
            }
        };

        endExpiredSession();
        document.addEventListener('visibilitychange', endExpiredSession);
        window.addEventListener('focus', endExpiredSession);
        return () => {
            document.removeEventListener('visibilitychange', endExpiredSession);
            window.removeEventListener('focus', endExpiredSession);
        };
    }, [session, sessionsRevokedAt]);

    // Whether the session in hand still owes a second factor: it was issued at aal1 and the
    // account has a verified factor that would take it to aal2. Only ever called with a
    // session already in hand.
    const checkMfa = async () => {
        try {
            const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
            if (error) throw error;
            setMfaRequired(data.nextLevel === 'aal2' && data.currentLevel === 'aal1');
        } catch (err) {
            // Fail closed. Leaving the flag alone on an error waves a half-authenticated
            // session straight past the code prompt, which is the one thing it must not do.
            // The way out is "Sign in as different user" on the login screen.
            console.error('Error checking MFA:', err);
            setMfaRequired(true);
        }
    };

    const fetchProfile = async (userId: string) => {
        try {
            const [
                { data, error },
                { data: teamRows },
                { data: skillRows },
                { data: clientRows },
                { data: regionRows }
            ] = await Promise.all([
                // maybeSingle, not single: an invited user who has authenticated but not yet
                // finished onboarding has no profile row, and that is not an error -- it is
                // what sends them to /welcome.
                supabase.from('users')
                    .select('id, name, email, role, daily_capacity, avatar, is_active, onboarding_completed, deleted_at, sessions_revoked_at')
                    .eq('id', userId)
                    .maybeSingle(),
                supabase.from('team_members').select('team_id').eq('user_id', userId).throwOnError(),
                supabase.from('user_skills').select('skill_id').eq('user_id', userId).throwOnError(),
                supabase.from('user_clients').select('client_id').eq('user_id', userId).throwOnError(),
                supabase.from('user_regions').select('region_id').eq('user_id', userId).throwOnError()
            ]);

            if (error) throw error;

            if (data) {
                // Map snake_case to camelCase
                const userProfile: User = {
                    id: data.id,
                    name: data.name,
                    email: data.email,
                    role: data.role,
                    dailyCapacity: data.daily_capacity,
                    avatar: data.avatar,
                    isActive: data.is_active,
                    onboardingCompleted: data.onboarding_completed === true,
                    teamIds: (teamRows || []).map((t: any) => t.team_id),
                    skillIds: (skillRows || []).map((s: any) => s.skill_id),
                    clientIds: (clientRows || []).map((c: any) => c.client_id),
                    regionIds: (regionRows || []).map((r: any) => r.region_id),
                    deletedAt: data.deleted_at || null
                };
                setProfile(userProfile);
                setSessionsRevokedAt(data.sessions_revoked_at || null);
            } else {
                setProfile(null);
                setSessionsRevokedAt(null);
            }
        } catch (error) {
            console.error('Error fetching user profile:', error);
        } finally {
            setLoading(false);
        }
    };

    const updateProfile = async (updates: Partial<User>) => {
        if (!user) return;
        
        try {
            // Map camelCase back to snake_case for Supabase
            const dbUpdates: any = {};
            if (updates.name !== undefined) dbUpdates.name = updates.name;
            if (updates.avatar !== undefined) dbUpdates.avatar = updates.avatar;
            if (updates.dailyCapacity !== undefined) dbUpdates.daily_capacity = updates.dailyCapacity;

            if (Object.keys(dbUpdates).length > 0) {
                const { error } = await supabase
                    .from('users')
                    .update(dbUpdates)
                    .eq('id', user.id);

                if (error) throw error;
            }

            // Skills and the brand/region preferences live in their own join tables, so they
            // are diffed rather than overwritten.
            if (updates.skillIds !== undefined) {
                await saveUserSkills(user.id, updates.skillIds);
            }
            if (updates.clientIds !== undefined) {
                await saveUserClients(user.id, updates.clientIds);
            }
            if (updates.regionIds !== undefined) {
                await saveUserRegions(user.id, updates.regionIds);
            }

            // Refresh profile
            await fetchProfile(user.id);
        } catch (error) {
            console.error('Error updating user profile:', error);
            throw error;
        }
    };

    const refreshProfile = async () => {
        if (!user) return;
        await fetchProfile(user.id);
    };

    // Called once the reset is done with, so the screen goes back to asking for the old
    // password and a stale flag cannot hold the door open on the next visit.
    const clearRecoveryMode = () => setRecoveryMode(false);

    const signOut = async () => {
        await supabase.auth.signOut();
        // Leaving the deadline behind would cut short whoever signs in next on this browser.
        clearSessionPersistence();
    };

    return (
        <AuthContext.Provider value={{ session, user, profile, loading, mfaRequired, recoveryMode, clearRecoveryMode, signOut, updateProfile, refreshProfile, checkMfa }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
