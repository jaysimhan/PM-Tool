import React, { createContext, useContext, useEffect, useState } from 'react';
import { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { supabase, sessionPersistenceExpired, clearSessionPersistence } from '../lib/supabaseClient';
import { User } from '../types/types';

interface AuthContextType {
    session: Session | null;
    user: SupabaseUser | null;
    profile: User | null;
    loading: boolean;
    mfaRequired: boolean;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<SupabaseUser | null>(null);
    const [profile, setProfile] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [mfaRequired, setMfaRequired] = useState(false);
    // users.sessions_revoked_at, as of the last profile load. Set when an admin removes
    // somebody from their team or deactivates them.
    const [sessionsRevokedAt, setSessionsRevokedAt] = useState<string | null>(null);

    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(async ({ data: { session } }) => {
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                await checkMfa();
                fetchProfile(session.user.id);
            }
            else setLoading(false);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
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

    const checkMfa = async () => {
        try {
            const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
            if (!error && data) {
                setMfaRequired(data.nextLevel === 'aal2' && data.currentLevel === 'aal1');
            }
        } catch (err) {
            console.error('Error checking MFA:', err);
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
                supabase.from('users').select('*').eq('id', userId).maybeSingle(),
                supabase.from('team_members').select('team_id').eq('user_id', userId),
                supabase.from('user_skills').select('skill_id').eq('user_id', userId),
                supabase.from('user_clients').select('client_id').eq('user_id', userId),
                supabase.from('user_regions').select('region_id').eq('user_id', userId)
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

    const signOut = async () => {
        await supabase.auth.signOut();
        // Leaving the deadline behind would cut short whoever signs in next on this browser.
        clearSessionPersistence();
    };

    return (
        <AuthContext.Provider value={{ session, user, profile, loading, mfaRequired, signOut, updateProfile, refreshProfile, checkMfa }}>
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
