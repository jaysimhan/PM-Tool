import React, { createContext, useContext, useEffect, useState } from 'react';
import { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import { User } from '../types/types';

interface AuthContextType {
    session: Session | null;
    user: SupabaseUser | null;
    profile: User | null;
    loading: boolean;
    signOut: () => Promise<void>;
    updateProfile: (updates: Partial<User>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<SupabaseUser | null>(null);
    const [profile, setProfile] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) fetchProfile(session.user.id);
            else setLoading(false);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchProfile(session.user.id);
            } else {
                setProfile(null);
                setLoading(false);
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    const fetchProfile = async (userId: string) => {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', userId)
                .single();
            
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
                    teamIds: data.team_ids || [],
                    skillIds: data.skill_ids || []
                };
                setProfile(userProfile);
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
            
            if (Object.keys(dbUpdates).length === 0) return;

            const { error } = await supabase
                .from('users')
                .update(dbUpdates)
                .eq('id', user.id);
            
            if (error) throw error;
            
            // Refresh profile
            await fetchProfile(user.id);
        } catch (error) {
            console.error('Error updating user profile:', error);
            throw error;
        }
    };

    const signOut = async () => {
        await supabase.auth.signOut();
    };

    return (
        <AuthContext.Provider value={{ session, user, profile, loading, signOut, updateProfile }}>
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
