import React, { createContext, useContext, useEffect, useState } from 'react';
import { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
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

// Reconciles public.user_skills for one person against the exact set of skills they
// picked. Shared with onboarding, which writes skills before a profile is in context.
export async function saveUserSkills(userId: string, skillIds: string[]) {
    const { data: existingRows, error: readError } = await supabase
        .from('user_skills')
        .select('skill_id')
        .eq('user_id', userId);
    if (readError) throw readError;

    const desired = new Set(skillIds);
    const existing = new Set((existingRows || []).map((r: any) => r.skill_id));
    const toAdd = [...desired].filter(id => !existing.has(id));
    const toRemove = [...existing].filter(id => !desired.has(id));

    if (toRemove.length > 0) {
        const { error } = await supabase
            .from('user_skills')
            .delete()
            .eq('user_id', userId)
            .in('skill_id', toRemove);
        if (error) throw error;
    }

    if (toAdd.length > 0) {
        const { error } = await supabase
            .from('user_skills')
            .insert(toAdd.map(skillId => ({ user_id: userId, skill_id: skillId })));
        if (error) throw error;
    }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<SupabaseUser | null>(null);
    const [profile, setProfile] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [mfaRequired, setMfaRequired] = useState(false);

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
            const [{ data, error }, { data: teamRows }, { data: skillRows }] = await Promise.all([
                // maybeSingle, not single: an invited user who has authenticated but not yet
                // finished onboarding has no profile row, and that is not an error -- it is
                // what sends them to /welcome.
                supabase.from('users').select('*').eq('id', userId).maybeSingle(),
                supabase.from('team_members').select('team_id').eq('user_id', userId),
                supabase.from('user_skills').select('skill_id').eq('user_id', userId)
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
                    skillIds: (skillRows || []).map((s: any) => s.skill_id)
                };
                setProfile(userProfile);
            } else {
                setProfile(null);
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

            // Skills live in their own join table, so they are diffed rather than overwritten.
            if (updates.skillIds !== undefined) {
                await saveUserSkills(user.id, updates.skillIds);
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
